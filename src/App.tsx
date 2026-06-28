import { useEffect, useState } from "react";
import "./App.css";
import { Journal } from "./components/Journal";
import {
  defaultJournalPath,
  ensureJournalStructure,
  ensureStarterLibrary,
  getRememberedRoot,
  loadOrCreateSettings,
  pickJournalFolder,
  rememberRoot,
  saveSettings,
  type Settings,
} from "./lib/storage";

/**
 * Paper Days — Step 2: pick the journal folder + read/write settings.json.
 *
 * Flow:
 *   - "loading"   : checking whether we already know your journal folder.
 *   - "first-run" : we don't — ask you to choose (or use the default).
 *   - "ready"     : folder is set up; settings.json is loaded.
 */
type Status = "loading" | "first-run" | "ready" | "error";

function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [defaultPath, setDefaultPath] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // On launch: do we already know where the journal lives?
  useEffect(() => {
    (async () => {
      try {
        setDefaultPath(await defaultJournalPath());
        const remembered = await getRememberedRoot();
        if (remembered) {
          await openJournal(remembered); // returning user
        } else {
          setStatus("first-run"); // first time
        }
      } catch (err) {
        showError(err);
      }
    })();
  }, []);

  // Apply the current theme to the whole page (sets the CSS variables).
  useEffect(() => {
    const theme = settings?.theme ?? "light";
    document.documentElement.setAttribute("data-theme", theme);
  }, [settings?.theme]);

  /** Flip between light and night, and remember the choice in settings.json. */
  async function toggleTheme() {
    if (!settings) return;
    const next: Settings = {
      ...settings,
      theme: settings.theme === "light" ? "night" : "light",
    };
    setSettings(next);
    try {
      await saveSettings(next);
    } catch (err) {
      console.error("Could not save theme:", err);
    }
  }

  /** Turn the daily quote on/off, and remember it in settings.json. */
  async function toggleQuote() {
    if (!settings) return;
    const next: Settings = { ...settings, showDailyQuote: !settings.showDailyQuote };
    setSettings(next);
    try {
      await saveSettings(next);
    } catch (err) {
      console.error("Could not save quote setting:", err);
    }
  }

  /** Set up the folder structure, remember it, and load settings. */
  async function openJournal(root: string) {
    try {
      setStatus("loading");
      await ensureJournalStructure(root);
      await ensureStarterLibrary(root); // adds starter stickers/washi the first time
      await rememberRoot(root);
      const loaded = await loadOrCreateSettings(root);
      setSettings(loaded);
      setStatus("ready");
    } catch (err) {
      showError(err);
    }
  }

  /** Use the suggested default folder (~/Documents/PaperDays). */
  async function useDefaultFolder() {
    await openJournal(await defaultJournalPath());
  }

  /** Open the native picker so the user can choose any folder. */
  async function chooseFolder() {
    try {
      const chosen = await pickJournalFolder();
      if (chosen) await openJournal(chosen);
    } catch (err) {
      showError(err);
    }
  }

  function showError(err: unknown) {
    setErrorMsg(err instanceof Error ? err.message : String(err));
    setStatus("error");
  }

  // ---- Screens ----------------------------------------------------------

  if (status === "loading") {
    return (
      <main className="screen">
        <p className="muted">Opening your journal…</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="screen">
        <div className="card">
          <h1 className="title-sm">Something went wrong</h1>
          <p className="muted">{errorMsg}</p>
          <button className="btn" onClick={() => setStatus("first-run")}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (status === "first-run") {
    return (
      <main className="screen">
        <div className="card">
          <p className="weekday">Welcome to</p>
          <h1 className="title">Paper Days</h1>
          <p className="muted">
            Everything you write and add lives as plain files in one folder on
            your computer — easy to read, back up, and keep forever.
          </p>
          <p className="muted">Where should your journal live?</p>

          <div className="btn-row">
            <button className="btn btn-primary" onClick={useDefaultFolder}>
              Use the default folder
            </button>
            <button className="btn" onClick={chooseFolder}>
              Choose a different folder…
            </button>
          </div>
          <p className="path-hint">Default: {defaultPath}</p>
        </div>
      </main>
    );
  }

  // status === "ready" — show the journal (month calendar + day pages).
  return (
    <Journal
      root={settings!.journalRoot}
      theme={settings!.theme}
      onToggleTheme={toggleTheme}
      showDailyQuote={settings!.showDailyQuote}
      onToggleQuote={toggleQuote}
    />
  );
}

export default App;
