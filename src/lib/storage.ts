/**
 * storage.ts — everything about reading and writing files for Paper Days.
 *
 * The whole app is "just files in a folder." This module is the only place
 * that talks to the disk, so the rest of the app stays simple. It uses Tauri's
 * official file-system and dialog plugins (added in Step 2).
 *
 * Two locations matter:
 *   1. The JOURNAL ROOT — the folder YOU pick (e.g. ~/Documents/PaperDays).
 *      Everything human-readable lives here: settings.json, entries/, library/.
 *   2. A tiny POINTER file in the app's own config folder, which just
 *      remembers which folder you chose so we don't have to ask every launch.
 */

import { open } from "@tauri-apps/plugin-dialog";
import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { appConfigDir, documentDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";

/** The shape of settings.json. Kept small and obvious on purpose. */
export type Settings = {
  /** Absolute path to the journal root folder. */
  journalRoot: string;
  /** Visual theme. Wired up for real in a later step. */
  theme: "light" | "night";
  /** Font choices, matching the design notes in CLAUDE.md. */
  fonts: { ui: string; handwriting: string; quote: string };
  /** Whether to show the gentle daily quote at the bottom of a page. */
  showDailyQuote: boolean;
};

/** Sensible defaults used the first time we create settings.json. */
export function defaultSettings(journalRoot: string): Settings {
  return {
    journalRoot,
    theme: "light",
    fonts: { ui: "system-ui", handwriting: "Caveat", quote: "serif" },
    showDailyQuote: true,
  };
}

/** The filename of the little pointer that remembers the journal location. */
const POINTER_FILE = "location.json";

// --------------------------------------------------------------------------
// The pointer: "where did the user put their journal?"
// --------------------------------------------------------------------------

/** Returns the remembered journal-root path, or null if this is a first run. */
export async function getRememberedRoot(): Promise<string | null> {
  try {
    const dir = await appConfigDir();
    const pointer = await join(dir, POINTER_FILE);
    if (!(await exists(pointer))) return null;
    const data = JSON.parse(await readTextFile(pointer));
    return typeof data.journalRoot === "string" ? data.journalRoot : null;
  } catch {
    // If anything goes wrong reading the pointer, just treat it as first run.
    return null;
  }
}

/** Saves the chosen journal-root path so future launches remember it. */
export async function rememberRoot(journalRoot: string): Promise<void> {
  const dir = await appConfigDir();
  await mkdir(dir, { recursive: true }); // make sure the config folder exists
  const pointer = await join(dir, POINTER_FILE);
  await writeTextFile(pointer, JSON.stringify({ journalRoot }, null, 2));
}

// --------------------------------------------------------------------------
// The journal folder itself
// --------------------------------------------------------------------------

/** The default suggested location: ~/Documents/PaperDays. */
export async function defaultJournalPath(): Promise<string> {
  return join(await documentDir(), "PaperDays");
}

/** Opens the native folder picker. Returns the chosen path, or null if cancelled. */
export async function pickJournalFolder(): Promise<string | null> {
  const chosen = await open({
    directory: true,
    multiple: false,
    title: "Choose where your Paper Days journal lives",
    defaultPath: await documentDir(),
  });
  return typeof chosen === "string" ? chosen : null;
}

/** Creates the journal folder and its starter subfolders if they don't exist. */
export async function ensureJournalStructure(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await mkdir(await join(root, "entries"), { recursive: true });
  await mkdir(await join(root, "library", "washi"), { recursive: true });
  await mkdir(await join(root, "library", "stickers"), { recursive: true });
}

/**
 * Loads settings.json from the journal root. If it doesn't exist yet (or is
 * unreadable), creates a fresh one with defaults and returns that.
 */
export async function loadOrCreateSettings(root: string): Promise<Settings> {
  const file = await join(root, "settings.json");
  if (await exists(file)) {
    try {
      const parsed = JSON.parse(await readTextFile(file)) as Partial<Settings>;
      // Merge with defaults so missing fields are filled in safely, and always
      // trust the actual folder we loaded from for journalRoot.
      return { ...defaultSettings(root), ...parsed, journalRoot: root };
    } catch {
      // Corrupt or unreadable — fall through and recreate it below.
    }
  }
  const fresh = defaultSettings(root);
  await saveSettings(fresh);
  return fresh;
}

/** Writes settings back to settings.json in the journal root. */
export async function saveSettings(settings: Settings): Promise<void> {
  const file = await join(settings.journalRoot, "settings.json");
  await writeTextFile(file, JSON.stringify(settings, null, 2));
}

// --------------------------------------------------------------------------
// A day's page — the heart of the journal (Step 3: text elements only)
// --------------------------------------------------------------------------

/** The kinds of things you can place on a page. Only "text" is used so far. */
export type ElementType = "text" | "image" | "video" | "sticker" | "washi";

/** Fields every element shares: position, size, rotation, stacking order. */
export type BaseElement = {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
};

/** A text note: a base element plus its words and a little styling. */
export type TextElement = BaseElement & {
  type: "text";
  text: string;
  color?: string;
  fontSize?: number;
};

/**
 * Anything shown from a file: a photo/video (src = a filename inside that day's
 * media folder) or a sticker/washi (src = a path inside library/, like
 * "stickers/heart.svg"). Keeping the journal self-contained either way.
 */
export type MediaElement = BaseElement & {
  type: "image" | "video" | "sticker" | "washi";
  src: string;
};

/** A page element is either a text note or a piece of media. */
export type PageElement = TextElement | MediaElement;

/** One day's page: which day it is, and the list of elements on it. */
export type DayPage = {
  date: string; // "YYYY-MM-DD"
  elements: PageElement[];
};

/** Zero-pad a number to two digits (e.g. 6 -> "06"). */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Turn a Date into our "YYYY-MM-DD" key (in the user's local time). */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Build the path to a given day's JSON file: entries/YYYY/MM/YYYY-MM-DD.json */
async function dayJsonPath(root: string, key: string): Promise<string> {
  const [year, month] = key.split("-");
  return join(root, "entries", year, month, `${key}.json`);
}

/** Load a day's page from disk. Returns an empty page if none exists yet. */
export async function loadDay(root: string, key: string): Promise<DayPage> {
  const file = await dayJsonPath(root, key);
  if (await exists(file)) {
    try {
      const parsed = JSON.parse(await readTextFile(file)) as Partial<DayPage>;
      return {
        date: key,
        elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      };
    } catch {
      // Unreadable file — start fresh rather than crashing.
    }
  }
  return { date: key, elements: [] };
}

/** Save a day's page to disk, creating the year/month folders as needed. */
export async function saveDay(root: string, page: DayPage): Promise<void> {
  const [year, month] = page.date.split("-");
  const monthDir = await join(root, "entries", year, month);
  await mkdir(monthDir, { recursive: true });
  const file = await join(monthDir, `${page.date}.json`);
  await writeTextFile(file, JSON.stringify(page, null, 2));
}

// --------------------------------------------------------------------------
// Media (Step 5): photos & video copied into each day's own folder
// --------------------------------------------------------------------------

/** The folder that holds a day's media: entries/YYYY/MM/YYYY-MM-DD/ */
async function dayMediaDir(root: string, key: string): Promise<string> {
  const [year, month] = key.split("-");
  return join(root, "entries", year, month, key);
}

/**
 * Ask the user to pick a photo or video, copy it into the day's media folder
 * (so the journal is self-contained), and return the new file's name to store
 * in the element's `src`. Returns null if the user cancels.
 */
export async function importMediaFile(
  root: string,
  key: string,
  kind: "image" | "video",
): Promise<string | null> {
  const filters =
    kind === "image"
      ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic"] }]
      : [{ name: "Videos", extensions: ["mp4", "mov", "m4v", "webm", "ogg"] }];

  const picked = await open({
    multiple: false,
    directory: false,
    title: kind === "image" ? "Choose a photo" : "Choose a video",
    filters,
  });
  if (typeof picked !== "string") return null;

  // Build a fresh, safe filename so imports never clobber each other.
  const ext = picked.split(".").pop()?.toLowerCase() ?? "";
  const prefix = kind === "image" ? "photo" : "clip";
  const name = `${prefix}-${crypto.randomUUID().slice(0, 8)}${ext ? "." + ext : ""}`;

  const dir = await dayMediaDir(root, key);
  await mkdir(dir, { recursive: true });
  await copyFile(picked, await join(dir, name));
  return name;
}

/**
 * Turn a stored media `src` (just a filename) into a URL the <img>/<video>
 * tag can actually load, using Tauri's safe asset channel.
 */
export async function mediaAssetUrl(
  root: string,
  key: string,
  src: string,
): Promise<string> {
  const dir = await dayMediaDir(root, key);
  return convertFileSrc(await join(dir, src));
}

// --------------------------------------------------------------------------
// Month overview (Step 7): which days have entries, for the calendar
// --------------------------------------------------------------------------

/** A quick summary of one day, used to draw calendar markers. */
export type DaySummary = {
  date: string;
  count: number; // how many elements are on the page
  thumbUrl?: string; // first photo on the page, if any
};

/**
 * Scan a month's folder and summarize each day that has a page. Returns a
 * map from "YYYY-MM-DD" to its summary. `month` is 1–12.
 */
export async function getMonthSummaries(
  root: string,
  year: number,
  month: number,
): Promise<Record<string, DaySummary>> {
  const dir = await join(root, "entries", String(year), pad2(month));
  const out: Record<string, DaySummary> = {};
  if (!(await exists(dir))) return out;

  const entries = await readDir(dir);
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith(".json")) continue;
    const key = entry.name.replace(/\.json$/, "");
    try {
      const page = JSON.parse(
        await readTextFile(await join(dir, entry.name)),
      ) as DayPage;
      const els = Array.isArray(page.elements) ? page.elements : [];
      const firstImage = els.find((el) => el.type === "image") as
        | MediaElement
        | undefined;
      out[key] = {
        date: key,
        count: els.length,
        thumbUrl: firstImage
          ? await mediaAssetUrl(root, key, firstImage.src)
          : undefined,
      };
    } catch {
      // Skip any unreadable day file.
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Library (Step 6): stickers & washi tape
// --------------------------------------------------------------------------

/** Which extensions count as a library image. */
const IMAGE_RE = /\.(svg|png|jpe?g|gif|webp|bmp)$/i;

/** A library category maps to a folder name under library/. */
export type LibraryKind = "stickers" | "washi";

/** Turn a library `src` (e.g. "stickers/heart.svg") into a displayable URL. */
export async function libraryAssetUrl(
  root: string,
  src: string,
): Promise<string> {
  return convertFileSrc(await join(root, "library", src));
}

/** List the images available in a library folder, with display URLs. */
export async function listLibrary(
  root: string,
  kind: LibraryKind,
): Promise<{ src: string; url: string }[]> {
  const dir = await join(root, "library", kind);
  await mkdir(dir, { recursive: true });
  const entries = await readDir(dir);
  const items: { src: string; url: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory && IMAGE_RE.test(entry.name)) {
      items.push({
        src: `${kind}/${entry.name}`,
        url: convertFileSrc(await join(dir, entry.name)),
      });
    }
  }
  return items;
}

/** Import the user's own image into a library folder; returns its new src. */
export async function importToLibrary(
  root: string,
  kind: LibraryKind,
): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    title: kind === "stickers" ? "Import a sticker" : "Import washi tape",
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
    ],
  });
  if (typeof picked !== "string") return null;

  const ext = picked.split(".").pop()?.toLowerCase() ?? "png";
  const prefix = kind === "stickers" ? "sticker" : "washi";
  const name = `${prefix}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const dir = await join(root, "library", kind);
  await mkdir(dir, { recursive: true });
  await copyFile(picked, await join(dir, name));
  return `${kind}/${name}`;
}

/**
 * Write a friendly starter set of stickers and washi into the library the
 * first time (only if the folder has no images yet). They're plain SVG files,
 * so the user can open, edit, delete, or add their own freely.
 */
export async function ensureStarterLibrary(root: string): Promise<void> {
  await seedFolder(await join(root, "library", "stickers"), STARTER_STICKERS);
  await seedFolder(await join(root, "library", "washi"), STARTER_WASHI);
}

async function seedFolder(dir: string, files: Record<string, string>) {
  await mkdir(dir, { recursive: true });
  const entries = await readDir(dir);
  const hasImages = entries.some(
    (e) => !e.isDirectory && IMAGE_RE.test(e.name),
  );
  if (hasImages) return; // already has art (starter or the user's own)
  for (const [name, content] of Object.entries(files)) {
    await writeTextFile(await join(dir, name), content);
  }
}

// --- The starter art, as tiny inline SVGs (accent colors from CLAUDE.md) ---

const STARTER_STICKERS: Record<string, string> = {
  "heart.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 84C20 64 10 44 18 30c7-12 24-12 32 2 8-14 25-14 32-2 8 14-2 34-32 54z" fill="#CA8A83"/></svg>`,
  "star.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 8l11 26 28 2-21 18 6 28-24-15-24 15 6-28-21-18 28-2z" fill="#F2D49A"/></svg>`,
  "flower.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="#D9C6E0"><circle cx="50" cy="26" r="16"/><circle cx="74" cy="44" r="16"/><circle cx="65" cy="72" r="16"/><circle cx="35" cy="72" r="16"/><circle cx="26" cy="44" r="16"/></g><circle cx="50" cy="50" r="13" fill="#F2D49A"/></svg>`,
  "leaf.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M20 80C20 40 50 18 82 18 82 58 52 80 20 80z" fill="#C7D6CB"/><path d="M28 72C40 56 58 38 78 24" stroke="#94886B" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  "sun.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g stroke="#ECC09A" stroke-width="6" stroke-linecap="round"><path d="M50 8v13M50 79v13M8 50h13M79 50h13M21 21l9 9M70 70l9 9M79 21l-9 9M30 70l-9 9"/></g><circle cx="50" cy="50" r="21" fill="#ECC09A"/></svg>`,
  "cloud.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="#9DB2C4"><circle cx="38" cy="56" r="18"/><circle cx="58" cy="50" r="22"/><circle cx="72" cy="60" r="14"/><rect x="34" y="56" width="44" height="18" rx="9"/></g></svg>`,
};

const STARTER_WASHI: Record<string, string> = {
  "rose.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 40"><defs><pattern id="p" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="16" fill="#ffffff" fill-opacity="0.3"/></pattern></defs><rect width="240" height="40" fill="#CA8A83" fill-opacity="0.92"/><rect width="240" height="40" fill="url(#p)"/></svg>`,
  "sage.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 40"><defs><pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="3.5" fill="#ffffff" fill-opacity="0.55"/></pattern></defs><rect width="240" height="40" fill="#C7D6CB"/><rect width="240" height="40" fill="url(#p)"/></svg>`,
  "blue.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 40"><defs><pattern id="p" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="6" fill="#ffffff" fill-opacity="0.28"/></pattern></defs><rect width="240" height="40" fill="#9DB2C4"/><rect width="240" height="40" fill="url(#p)"/></svg>`,
  "amber.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 40"><defs><pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#ffffff" fill-opacity="0.3"/><rect x="10" y="10" width="10" height="10" fill="#ffffff" fill-opacity="0.3"/></pattern></defs><rect width="240" height="40" fill="#F2D49A"/><rect width="240" height="40" fill="url(#p)"/></svg>`,
  "lilac.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 40"><defs><pattern id="p" width="14" height="40" patternUnits="userSpaceOnUse"><rect width="6" height="40" fill="#ffffff" fill-opacity="0.3"/></pattern></defs><rect width="240" height="40" fill="#D9C6E0"/><rect width="240" height="40" fill="url(#p)"/></svg>`,
};
