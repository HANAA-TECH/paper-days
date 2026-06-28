import { useState } from "react";
import { DailyPage } from "./DailyPage";
import { MonthView } from "./MonthView";
import { dateKey } from "../lib/storage";

/**
 * Journal — owns which view is showing: the month calendar or one day's page.
 *
 * It opens on the current month. Tapping a day shows that day; the day page's
 * "‹ Month" button comes back here.
 */
export function Journal({
  root,
  theme,
  onToggleTheme,
  showDailyQuote,
  onToggleQuote,
}: {
  root: string;
  theme: "light" | "night";
  onToggleTheme: () => void;
  showDailyQuote: boolean;
  onToggleQuote: () => void;
}) {
  const today = new Date();
  const todayKey = dateKey(today);

  // Which month the calendar is showing (1–12).
  const [anchor, setAnchor] = useState({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });
  // The open day, or null when we're on the calendar.
  const [openDay, setOpenDay] = useState<string | null>(null);

  function prevMonth() {
    setAnchor(({ year, month }) =>
      month === 1
        ? { year: year - 1, month: 12 }
        : { year, month: month - 1 },
    );
  }

  function nextMonth() {
    setAnchor(({ year, month }) =>
      month === 12
        ? { year: year + 1, month: 1 }
        : { year, month: month + 1 },
    );
  }

  function goToday() {
    setAnchor({ year: today.getFullYear(), month: today.getMonth() + 1 });
  }

  if (openDay) {
    return (
      <DailyPage
        root={root}
        dateStr={openDay}
        onBack={() => setOpenDay(null)}
        theme={theme}
        onToggleTheme={onToggleTheme}
        showDailyQuote={showDailyQuote}
        onToggleQuote={onToggleQuote}
      />
    );
  }

  return (
    <MonthView
      root={root}
      year={anchor.year}
      month={anchor.month}
      todayKey={todayKey}
      onPrev={prevMonth}
      onNext={nextMonth}
      onToday={goToday}
      onPickDay={(key) => setOpenDay(key)}
      theme={theme}
      onToggleTheme={onToggleTheme}
    />
  );
}
