"use client";

import { useEffect, useState } from "react";

/**
 * ThemeToggle — flips between dark and light by toggling the `dark` class
 * on <html>, and remembers the choice in localStorage.
 *
 * The site defaults to DARK. The actual initial class is set by a tiny inline
 * script in layout.tsx (before paint) to avoid a flash; this component just
 * keeps the button in sync and handles clicks.
 */
export function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  // Sync button state with whatever the pre-paint script already applied.
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    root.classList.toggle("dark", next);
    try {
      localStorage.setItem("agentlab-theme", next ? "dark" : "light");
    } catch {
      /* ignore storage errors (private mode, etc.) */
    }
    setIsDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark and light mode"
      title="Toggle theme"
      className="inline-grid h-9 w-9 place-items-center rounded-full border border-ink-600/20 bg-paper/60 text-ink-700 transition hover:border-signal hover:text-signal dark:border-paper/20 dark:bg-ink-700/40 dark:text-paper dark:hover:border-signal"
    >
      {isDark ? (
        // sun (click to go light)
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // moon (click to go dark)
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
