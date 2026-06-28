import { useEffect, useRef, useState } from "react";
import Moveable, {
  type OnDrag,
  type OnDragStart,
  type OnResize,
  type OnResizeStart,
  type OnRotate,
  type OnRotateStart,
} from "react-moveable";
import {
  importMediaFile,
  importToLibrary,
  libraryAssetUrl,
  listLibrary,
  loadDay,
  mediaAssetUrl,
  saveDay,
  type DayPage,
  type LibraryKind,
  type MediaElement,
  type PageElement,
  type TextElement,
} from "../lib/storage";

/**
 * DailyPage — Step 4: today's page where notes can be dragged, resized,
 * and rotated, like sticking things onto paper.
 *
 * How interaction works:
 *   - Click a note  -> selects it (handles appear).
 *   - Drag / corner-resize / rotate handle -> moves/sizes/turns it.
 *   - Double-click  -> edit the text.
 *   - Click empty paper -> deselect.
 *   - Delete/Backspace (when selected, not editing) -> remove it.
 * Every change autosaves to the day's JSON ~500ms later.
 */

/** A small mutable record of an element's live geometry while dragging. */
type Frame = {
  translate: [number, number];
  rotate: number;
  width: number;
  height: number;
};

/** A few gentle quotes; the same one shows all day for a given date. */
const QUOTES = [
  "Today is a little life. — Arthur Schopenhauer",
  "The smallest moments can hold the most.",
  "Write it down. Make it real.",
  "How we spend our days is how we spend our lives. — Annie Dillard",
  "Begin anywhere. — John Cage",
  "Little by little, one travels far.",
  "Notice the ordinary; it is full of wonder.",
  "A day is a vessel; fill it gently.",
  "Keep a green tree in your heart and a singing bird may come.",
  "What is done in love is done well. — Vincent van Gogh",
  "The days are long but the years are short.",
  "Stay close to anything that makes you glad you are alive.",
];

/** Pick a quote for a date, stable across the whole day. */
function quoteForDate(d: Date): string {
  const start = new Date(d.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((d.getTime() - start.getTime()) / 86_400_000);
  return QUOTES[dayOfYear % QUOTES.length];
}

export function DailyPage({
  root,
  dateStr,
  onBack,
  theme,
  onToggleTheme,
  showDailyQuote,
  onToggleQuote,
}: {
  root: string;
  dateStr: string; // which day to show, as "YYYY-MM-DD"
  onBack: () => void; // go back to the month calendar
  theme: "light" | "night";
  onToggleTheme: () => void;
  showDailyQuote: boolean;
  onToggleQuote: () => void;
}) {
  // Build a Date from the key in local time (avoids timezone off-by-one).
  const [yy, mm, dd] = dateStr.split("-").map(Number);
  const dateObj = new Date(yy, mm - 1, dd);
  const key = dateStr;

  const [page, setPage] = useState<DayPage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Displayable URLs for media elements, keyed by element id.
  const [mediaUrls, setMediaUrls] = useState<Map<string, string>>(new Map());
  // The open library tray ("stickers" / "washi"), and its loaded items.
  const [activePicker, setActivePicker] = useState<LibraryKind | null>(null);
  const [libraryItems, setLibraryItems] = useState<
    { src: string; url: string }[]
  >([]);

  // DOM nodes for each note, so react-moveable knows what to attach to.
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const textareas = useRef(new Map<string, HTMLTextAreaElement>());
  // The geometry of the currently-dragging element (updated many times/sec).
  const frame = useRef<Frame | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  // Load today's page on first appearance.
  useEffect(() => {
    let active = true;
    (async () => {
      const loaded = await loadDay(root, key);
      if (active) setPage(loaded);
    })();
    return () => {
      active = false;
    };
  }, [root, key]);

  // When we enter edit mode, focus that note's textarea.
  useEffect(() => {
    if (editingId) textareas.current.get(editingId)?.focus();
  }, [editingId]);

  // Resolve each media element's file into a URL the browser can show. We key
  // this on the *set* of media (ids + filenames), so it doesn't re-run while
  // you're just dragging things around.
  const mediaSig = page
    ? page.elements
        .filter((el): el is MediaElement => el.type !== "text")
        .map((el) => `${el.id}:${el.src}`)
        .join("|")
    : "";
  useEffect(() => {
    if (!page) return;
    let active = true;
    (async () => {
      const next = new Map<string, string>();
      for (const el of page.elements) {
        try {
          if (el.type === "image" || el.type === "video") {
            // Photos/video live in the day's own folder.
            next.set(el.id, await mediaAssetUrl(root, key, el.src));
          } else if (el.type === "sticker" || el.type === "washi") {
            // Stickers/washi live in the shared library/ folder.
            next.set(el.id, await libraryAssetUrl(root, el.src));
          }
        } catch (err) {
          console.error("Could not load media:", err);
        }
      }
      if (active) setMediaUrls(next);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaSig, root, key]);

  // Load the sticker/washi thumbnails whenever the tray opens.
  useEffect(() => {
    if (!activePicker) {
      setLibraryItems([]);
      return;
    }
    let active = true;
    (async () => {
      const items = await listLibrary(root, activePicker);
      if (active) setLibraryItems(items);
    })();
    return () => {
      active = false;
    };
  }, [activePicker, root]);

  // Delete the selected note with the keyboard (when not editing text).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!selectedId || editingId) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeElement(selectedId);
      } else if (e.key === "Escape") {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, editingId, page]);

  // ---- Saving ------------------------------------------------------------

  /** Update the page in memory and schedule a debounced (~500ms) save. */
  function update(next: DayPage) {
    setPage(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveDay(root, next).catch((err) => console.error("Save failed:", err));
    }, 500);
  }

  /** Replace one element by id, keeping the rest unchanged. */
  function patchElement(id: string, changes: Partial<PageElement>) {
    if (!page) return;
    update({
      ...page,
      elements: page.elements.map((el) =>
        el.id === id ? ({ ...el, ...changes } as PageElement) : el,
      ),
    });
  }

  // ---- Adding / removing notes ------------------------------------------

  function addText() {
    if (!page) return;
    const count = page.elements.length;
    const note: TextElement = {
      id: crypto.randomUUID(),
      type: "text",
      x: 60 + (count % 5) * 26,
      y: 50 + (count % 5) * 26,
      width: 260,
      height: 96,
      rotation: 0,
      z: topZ() + 1,
      text: "",
    };
    update({ ...page, elements: [...page.elements, note] });
    // Select and immediately edit the new note so you can just start typing.
    setSelectedId(note.id);
    setEditingId(note.id);
  }

  /** Load an image URL just to read its natural size (to keep its aspect). */
  function imageSize(url: string): Promise<{ w: number; h: number } | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function addPhoto() {
    if (!page) return;
    const src = await importMediaFile(root, key, "image");
    if (!src) return; // user cancelled
    // Pick a tidy starting size that keeps the photo's proportions.
    const size = await imageSize(await mediaAssetUrl(root, key, src));
    const width = 280;
    const height = size ? Math.round((width * size.h) / size.w) : 210;
    addMediaElement("image", src, width, height);
  }

  async function addVideo() {
    if (!page) return;
    const src = await importMediaFile(root, key, "video");
    if (!src) return; // user cancelled
    addMediaElement("video", src, 320, 200);
  }

  /** Place a sticker from the library, sized to keep its proportions. */
  async function addSticker(src: string) {
    const size = await imageSize(await libraryAssetUrl(root, src));
    const width = 96;
    const height = size ? Math.round((width * size.h) / size.w) : 96;
    addMediaElement("sticker", src, width, height);
    setActivePicker(null);
  }

  /** Place a strip of washi tape from the library. */
  function addWashi(src: string) {
    addMediaElement("washi", src, 220, 38);
    setActivePicker(null);
  }

  /** Import the user's own image into the open library category. */
  async function importLibrary() {
    if (!activePicker) return;
    const added = await importToLibrary(root, activePicker);
    if (added) setLibraryItems(await listLibrary(root, activePicker));
  }

  function addMediaElement(
    type: MediaElement["type"],
    src: string,
    width: number,
    height: number,
  ) {
    if (!page) return;
    const count = page.elements.length;
    const el: MediaElement = {
      id: crypto.randomUUID(),
      type,
      x: 60 + (count % 5) * 26,
      y: 50 + (count % 5) * 26,
      width,
      height,
      rotation: 0,
      z: topZ() + 1,
      src,
    };
    update({ ...page, elements: [...page.elements, el] });
    setSelectedId(el.id);
    setEditingId(null);
  }

  function removeElement(id: string) {
    if (!page) return;
    update({ ...page, elements: page.elements.filter((el) => el.id !== id) });
    if (selectedId === id) setSelectedId(null);
    if (editingId === id) setEditingId(null);
  }

  // ---- Stacking order (bring forward / send back) -----------------------

  function topZ(): number {
    if (!page || page.elements.length === 0) return 0;
    return Math.max(...page.elements.map((el) => el.z));
  }

  function bottomZ(): number {
    if (!page || page.elements.length === 0) return 0;
    return Math.min(...page.elements.map((el) => el.z));
  }

  function bringForward() {
    if (selectedId) patchElement(selectedId, { z: topZ() + 1 });
  }

  function sendBack() {
    if (selectedId) patchElement(selectedId, { z: bottomZ() - 1 });
  }

  // ---- react-moveable handlers ------------------------------------------
  // These mutate `frame` and the DOM directly during a gesture (smooth, no
  // React re-render), then commit the final numbers to state when it ends.

  function startFrame(el: PageElement): Frame {
    return {
      translate: [el.x, el.y],
      rotate: el.rotation,
      width: el.width,
      height: el.height,
    };
  }

  /** Write the live frame onto a DOM node. */
  function applyFrame(target: HTMLElement | SVGElement) {
    const f = frame.current!;
    target.style.width = `${f.width}px`;
    target.style.height = `${f.height}px`;
    target.style.transform = `translate(${f.translate[0]}px, ${f.translate[1]}px) rotate(${f.rotate}deg)`;
  }

  /** Commit the live frame back into the saved element. */
  function commitFrame() {
    if (!selectedId || !frame.current) return;
    const f = frame.current;
    patchElement(selectedId, {
      x: Math.round(f.translate[0]),
      y: Math.round(f.translate[1]),
      width: Math.round(f.width),
      height: Math.round(f.height),
      rotation: Math.round(f.rotate),
    });
  }

  const selectedEl = page?.elements.find((el) => el.id === selectedId) ?? null;
  const target =
    selectedId && editingId !== selectedId
      ? (nodes.current.get(selectedId) ?? null)
      : null;

  if (!page) {
    return (
      <main className="screen">
        <p className="muted">Opening today…</p>
      </main>
    );
  }

  // Friendly header pieces.
  const dayNumber = dateObj.getDate();
  const weekday = dateObj.toLocaleDateString(undefined, { weekday: "long" });
  const monthYear = dateObj.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="page">
      <header className="page-header">
        <button className="btn page-back" onClick={onBack}>
          ‹ Month
        </button>
        <span className="page-daynum">{dayNumber}</span>
        <span className="page-headtext">
          <span className="page-weekday">{weekday}</span>
          <span className="page-month">{monthYear}</span>
        </span>
        <button
          className="btn page-theme"
          onClick={onToggleTheme}
          title={theme === "light" ? "Switch to night" : "Switch to light"}
        >
          {theme === "light" ? "🌙" : "☀️"}
        </button>
      </header>

      {/* The canvas. Clicking empty paper deselects and stops editing. */}
      <div
        className="page-canvas"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedId(null);
            setEditingId(null);
          }
        }}
      >
        {page.elements.length === 0 && (
          <p className="canvas-hint">
            Tap “+ Text” below to add your first note.
          </p>
        )}

        {page.elements.map((el) => {
          const isEditing = editingId === el.id;
          return (
            <div
              key={el.id}
              ref={(node) => {
                if (node) nodes.current.set(el.id, node);
                else nodes.current.delete(el.id);
              }}
              className={`text-item${selectedId === el.id ? " selected" : ""}`}
              style={{
                width: el.width,
                height: el.height,
                transform: `translate(${el.x}px, ${el.y}px) rotate(${el.rotation}deg)`,
                zIndex: el.z,
              }}
              onMouseDown={() => {
                if (!isEditing) setSelectedId(el.id);
              }}
              onDoubleClick={() => {
                setSelectedId(el.id);
                setEditingId(el.id);
              }}
            >
              {el.type === "text" ? (
                <textarea
                  ref={(node) => {
                    if (node) textareas.current.set(el.id, node);
                    else textareas.current.delete(el.id);
                  }}
                  className="text-input"
                  value={el.text}
                  placeholder="Write something…"
                  readOnly={!isEditing}
                  // When not editing, let clicks pass through to the wrapper so
                  // selecting/dragging works; when editing, the textarea is live.
                  style={{ pointerEvents: isEditing ? "auto" : "none" }}
                  onChange={(e) => patchElement(el.id, { text: e.target.value })}
                />
              ) : el.type === "image" ? (
                <img
                  className="media-img"
                  src={mediaUrls.get(el.id)}
                  alt=""
                  draggable={false}
                  // A photo is just a picture — always let the wrapper handle drags.
                  style={{ pointerEvents: "none" }}
                />
              ) : el.type === "sticker" || el.type === "washi" ? (
                <img
                  className={el.type === "washi" ? "media-washi" : "media-sticker"}
                  src={mediaUrls.get(el.id)}
                  alt=""
                  draggable={false}
                  style={{ pointerEvents: "none" }}
                />
              ) : (
                <video
                  className="media-video"
                  src={mediaUrls.get(el.id)}
                  // Double-click a video to "activate" it and use the controls.
                  controls={isEditing}
                  style={{ pointerEvents: isEditing ? "auto" : "none" }}
                />
              )}
            </div>
          );
        })}

        {/* The selection handles, attached to the selected (non-editing) note. */}
        {target && selectedEl && (
          <Moveable
            target={target}
            draggable
            resizable
            rotatable
            origin={false}
            keepRatio={false}
            throttleDrag={0}
            throttleResize={0}
            throttleRotate={0}
            renderDirections={["nw", "ne", "sw", "se"]}
            onDragStart={({ set }: OnDragStart) => {
              frame.current = startFrame(selectedEl);
              set(frame.current.translate);
            }}
            onDrag={({ target, beforeTranslate }: OnDrag) => {
              frame.current!.translate = [beforeTranslate[0], beforeTranslate[1]];
              applyFrame(target);
            }}
            onDragEnd={commitFrame}
            onResizeStart={({ setOrigin, dragStart }: OnResizeStart) => {
              frame.current = startFrame(selectedEl);
              setOrigin(["%", "%"]);
              if (dragStart) dragStart.set(frame.current.translate);
            }}
            onResize={({ target, width, height, drag }: OnResize) => {
              frame.current!.width = width;
              frame.current!.height = height;
              frame.current!.translate = [
                drag.beforeTranslate[0],
                drag.beforeTranslate[1],
              ];
              applyFrame(target);
            }}
            onResizeEnd={commitFrame}
            onRotateStart={({ set }: OnRotateStart) => {
              frame.current = startFrame(selectedEl);
              set(frame.current.rotate);
            }}
            onRotate={({ target, beforeRotate }: OnRotate) => {
              frame.current!.rotate = beforeRotate;
              applyFrame(target);
            }}
            onRotateEnd={commitFrame}
          />
        )}
      </div>

      {/* The library tray: thumbnails of stickers or washi to drop on the page. */}
      {activePicker && (
        <div className="library-panel">
          {libraryItems.map((item) => (
            <button
              key={item.src}
              className="library-thumb"
              title="Add to page"
              onClick={() =>
                activePicker === "stickers"
                  ? addSticker(item.src)
                  : addWashi(item.src)
              }
            >
              <img src={item.url} alt="" draggable={false} />
            </button>
          ))}
          <button className="btn library-import" onClick={importLibrary}>
            Import…
          </button>
        </div>
      )}

      {/* The optional gentle daily quote, pinned above the toolbar. */}
      {showDailyQuote && <div className="quote-bar">{quoteForDate(dateObj)}</div>}

      {/* The toolbar. */}
      <div className="toolbar">
        <button className="btn btn-primary" onClick={addText}>
          + Text
        </button>
        <button className="btn" onClick={addPhoto}>
          + Photo
        </button>
        <button className="btn" onClick={addVideo}>
          + Video
        </button>
        <button
          className={`btn${activePicker === "stickers" ? " btn-active" : ""}`}
          onClick={() =>
            setActivePicker(activePicker === "stickers" ? null : "stickers")
          }
        >
          + Sticker
        </button>
        <button
          className={`btn${activePicker === "washi" ? " btn-active" : ""}`}
          onClick={() =>
            setActivePicker(activePicker === "washi" ? null : "washi")
          }
        >
          + Washi
        </button>
        <button
          className={`btn${showDailyQuote ? " btn-active" : ""}`}
          onClick={onToggleQuote}
          title="Show or hide the daily quote"
        >
          ❝ Quote
        </button>
        {selectedId && !editingId && (
          <>
            <span className="toolbar-divider" />
            <button className="btn" onClick={bringForward}>
              Bring forward
            </button>
            <button className="btn" onClick={sendBack}>
              Send back
            </button>
            <button className="btn" onClick={() => removeElement(selectedId)}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
