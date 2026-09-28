"use client";

/**
 * PillFilter — pill row used for the Sector and Outcome filters.
 */
export function PillFilter<T extends string>({
  label,
  options,
  active,
  onChange,
  counts,
}: {
  label: string;
  options: T[];
  active: T | "All";
  onChange: (c: T | "All") => void;
  counts?: Partial<Record<T | "All", number>>;
}) {
  const all: (T | "All")[] = ["All", ...options];
  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={`Filter by ${label.toLowerCase()}`}>
      <span className="w-16 font-mono text-[11px] uppercase tracking-wide text-ink-500 dark:text-paper/50">{label}</span>
      {all.map((opt) => {
        const isActive = opt === active;
        const count = counts?.[opt];
        return (
          <button
            key={opt}
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(opt)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              isActive
                ? "border-signal bg-signal text-white"
                : "border-ink-600/20 bg-paper/60 text-ink-700 hover:border-signal hover:text-signal dark:border-paper/20 dark:bg-ink-800/50 dark:text-paper/70 dark:hover:border-signal"
            }`}
          >
            {opt}
            {typeof count === "number" && (
              <span className={`ml-1.5 font-mono text-[11px] ${isActive ? "text-white/80" : "text-ink-500 dark:text-paper/50"}`}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
