"use client";

import type { Category } from "@/lib/agents";
import { categories } from "@/lib/agents";

export type CategoryValue = Category | "All";

/**
 * CategoryFilter — pill row for filtering the gallery by category.
 */
export function CategoryFilter({
  active,
  onChange,
  counts,
}: {
  active: CategoryValue;
  onChange: (c: CategoryValue) => void;
  counts?: Partial<Record<CategoryValue, number>>;
}) {
  const all: CategoryValue[] = ["All", ...categories];

  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by category">
      {all.map((cat) => {
        const isActive = cat === active;
        const count = counts?.[cat];
        return (
          <button
            key={cat}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(cat)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              isActive
                ? "border-signal bg-signal text-white"
                : "border-ink-600/20 bg-paper/60 text-ink-700 hover:border-signal hover:text-signal dark:border-paper/20 dark:bg-ink-800/50 dark:text-paper/70 dark:hover:border-signal"
            }`}
          >
            {cat}
            {typeof count === "number" && (
              <span className={`ml-1.5 font-mono text-[11px] ${isActive ? "text-white/80" : "text-ink-500 dark:text-paper/50"}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
