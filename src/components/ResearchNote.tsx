import { ReactNode } from "react";

/**
 * ResearchNote — a recurring callout that frames the lab as research.
 * Used on the homepage and reused on About / Research where useful.
 */
export function ResearchNote({
  children,
  label = "Research note",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <aside className="relative overflow-hidden rounded-2xl border border-ink-600/15 bg-white/60 p-6 dark:border-paper/15 dark:bg-ink-800/60 sm:p-8">
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-data/10 blur-2xl" />
      <p className="mb-2 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-data-600 dark:text-data">
        <span className="h-1.5 w-1.5 rounded-full bg-data" />
        {label}
      </p>
      <p className="relative max-w-3xl font-display text-lg leading-relaxed text-ink-800 dark:text-paper/90 sm:text-xl">
        {children}
      </p>
    </aside>
  );
}
