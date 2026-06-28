# CLAUDE.md — Paper Days

A warm, Hobonichi-style journaling app. (Rename "Paper Days" to anything you like.)

## Project in one paragraph

Paper Days is a **local, offline desktop app** for daily journaling. It has two
views: a **month calendar** and a **daily page**. Each daily page is a free
**canvas** where the user adds text, photos, video, stickers, and washi tape, and
drags, resizes, and rotates each item freely — like sticking real things onto
paper. All data lives in **plain files in a folder on disk** that the user can
open, read, and back up. There is no cloud, no accounts, no server, no database.

## Who I'm building this with (read this first)

This is the user's **first web/app project** — assume no prior web-development
experience. So, throughout:

- Explain choices in plain language; avoid unexplained jargon.
- Keep the stack and dependencies **minimal**; prefer simple, well-documented tools.
- Build in **small milestones that each run**, not one big drop.
- Comment the code generously.
- After each milestone, remind the user exactly how to run and try it, and don't
  move on until it actually works.
- Never add a backend server, database server, cloud service, or login.
- Ask before adding any new heavy dependency.

## Tech stack

- **Desktop shell:** Tauri v2 — a real, small, cross-platform desktop app with
  secure local file access through its JavaScript APIs (no Rust code needed for
  normal file read/write).
- **UI:** React + TypeScript, built with Vite.
- **Styling:** Tailwind CSS.
- **Canvas manipulation:** react-moveable (drag, resize, rotate, snapping).
- **Media:** native `<img>` / `<video>` pointing at local files via Tauri's
  asset-URL conversion.
- **One-time prerequisites:** Node.js, plus the Tauri prerequisites (Rust
  toolchain and OS build tools). Walk the user through installing these the first
  time and verify each is working before continuing.

If we ever decide to stay all-JavaScript instead, Electron is the fallback — but
default to Tauri.

## How data is stored (the core design — keep it file-based and human-readable)

On first run, the user picks a root folder (default `~/Documents/PaperDays/`,
remembered in settings). Layout:

```
PaperDays/
  settings.json              theme, fonts, journal root path, quote on/off
  entries/
    2026/
      06/
        2026-06-14.json      the day's canvas: list of elements + page meta
        2026-06-14/          media files for that day
          photo-1.jpg
          clip-1.mp4
  library/
    washi/                   starter washi textures + user imports
    stickers/                starter stickers + user imports
```

- **One JSON file per day** describes the page as a list of `elements`. Each
  element looks like:
  `{ id, type: "text" | "image" | "video" | "sticker" | "washi",
     x, y, width, height, rotation, z, ... }`
  where `text` carries its content and style, and the visual types carry a `src`
  path (relative to that day's media folder or to `library/`).
- **Media is copied in on import** (never just linked from elsewhere), so the
  whole journal is self-contained — the user can copy the `PaperDays/` folder
  anywhere to back it up.
- **Autosave to disk**, debounced (~500ms) after edits. No save button.
- **No database.** Plain files only, so the user can open the folder and
  understand everything they see.

## The two views

- **Month calendar:** a grid for the current month in warm paper styling. Each day
  that has an entry shows a small colored marker or photo strip; today is gently
  highlighted; arrows change the month; tapping a day opens its daily page.
- **Daily page:** the canvas. A date header (large day number + weekday + month),
  a faint dot grid, and the user's placed elements. An optional daily quote pinned
  at the bottom. A small toolbar to add text, photo, video, sticker, or washi.

## Canvas behavior

- Every element can be **dragged, resized, rotated, and reordered** (bring
  forward / send back) via react-moveable.
- Stickers and washi come from `library/`; the user can also import their own
  images into the library.
- Selecting an element shows simple handles; deleting is select-then-delete.
- Keep it obvious and forgiving — this is a cozy journal, not pro design software.

## Design system (Hobonichi: quiet paper, the user's stuff is the star)

Base vibe: **minimal and airy** — lots of paper showing by default.

Light "paper" theme:
- paper `#F7F1E3`, dot grid `#DAD0B9`, page border `#E4D9C0`
- ink (text) `#3C372D`, muted ink `#94886B`

Night theme (dark mode):
- paper `#262320`, dot grid `#3A352B`, border `#3A352B`
- ink `#E8E2D4`, muted ink `#9E947C`

Accents (stickers, washi, calendar markers — used in both themes):
dusty rose `#CA8A83`, sage `#C7D6CB`, peach `#ECC09A`, dusk blue `#9DB2C4`,
amber `#F2D49A`, lilac `#D9C6E0`.

Typography:
- UI labels: a clean sans (system UI / Inter).
- The user's personal notes: a handwriting font (Caveat).
- Daily quote: a serif, italic, muted.

Shape and feel: cards and pages at ~10–12px corner radius; small radius on
stickers; thin 0.5px borders; no heavy shadows; calm, flat, warm.

## Build order (small, runnable steps — confirm each before the next)

1. Bare Tauri + React + Vite + TypeScript app that opens a window. Confirm it runs.
2. Pick/create the journal root folder; read and write `settings.json`.
3. Daily page that loads and saves one day's JSON to disk (text elements only).
4. The drag/resize/rotate canvas with react-moveable.
5. Image and video elements (import → copy into the day's folder → display).
6. Sticker and washi library plus the add-element toolbar.
7. Month calendar view: navigation, entry markers, tap-to-open.
8. Theming (light + night) wired to the design tokens above.
9. Polish: daily quote, dot grid, handwriting/serif fonts, autosave debounce.

After each step, tell the user how to run and try it — and wait until it works.
