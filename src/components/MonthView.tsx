import { useEffect, useState } from "react";
import { getMonthSummaries, type DaySummary } from "../lib/storage";

/**
 * MonthView — Step 7: a warm month calendar.
 *
 * Shows the given month as a grid. Days with an entry get a marker (or a tiny
 * photo thumbnail); today is gently highlighted. Arrows change month, and
 * tapping a day opens it.
 */
export function MonthView({
  root,
  year,
  month, // 1–12
  todayKey,
  onPrev,
  onNext,
  onToday,
  onPickDay,
  theme,
  onToggleTheme,
}: {
  root: string;
  year: number;
  month: number;
  todayKey: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPickDay: (dateKey: string) => void;
  theme: "light" | "night";
  onToggleTheme: () => void;
}) {
  const [summaries, setSummaries] = useState<Record<string, DaySummary>>({});

  // Load the per-day summaries whenever the visible month changes.
  useEffect(() => {
    let active = true;
    (async () => {
      const data = await getMonthSummaries(root, year, month);
      if (active) setSummaries(data);
    })();
    return () => {
      active = false;
    };
  }, [root, year, month]);

  // Layout math for the grid.
  const firstOfMonth = new Date(year, month - 1, 1);
  const startWeekday = firstOfMonth.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthLabel = firstOfMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Build the cells: leading blanks, then each day of the month.
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="cal">
      <header className="cal-header">
        <button className="btn cal-arrow" onClick={onPrev} title="Previous month">
          ‹
        </button>
        <h1 className="cal-title">{monthLabel}</h1>
        <button className="btn cal-arrow" onClick={onNext} title="Next month">
          ›
        </button>
        <button className="btn cal-today" onClick={onToday}>
          Today
        </button>
        <button
          className="btn"
          onClick={onToggleTheme}
          title={theme === "light" ? "Switch to night" : "Switch to light"}
        >
          {theme === "light" ? "🌙" : "☀️"}
        </button>
      </header>

      <div className="cal-weekdays">
        {weekdayNames.map((name) => (
          <div key={name} className="cal-weekday">
            {name}
          </div>
        ))}
      </div>

      <div className="cal-grid">
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} className="cal-blank" />;

          const dateKey = `${year}-${pad2(month)}-${pad2(day)}`;
          const summary = summaries[dateKey];
          const isToday = dateKey === todayKey;
          const hasEntry = summary && summary.count > 0;

          return (
            <button
              key={dateKey}
              className={`cal-day${isToday ? " is-today" : ""}${
                hasEntry ? " has-entry" : ""
              }`}
              onClick={() => onPickDay(dateKey)}
            >
              <span className="cal-daynum">{day}</span>
              {summary?.thumbUrl ? (
                <img className="cal-thumb" src={summary.thumbUrl} alt="" />
              ) : hasEntry ? (
                <span className="cal-dot" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
