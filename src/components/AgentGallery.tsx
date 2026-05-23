"use client";

import { useMemo, useState } from "react";
import type { Agent } from "@/lib/agents";
import { categories } from "@/lib/agents";
import { AgentGrid } from "@/components/AgentGrid";
import { SearchBar } from "@/components/SearchBar";
import { CategoryFilter, type CategoryValue } from "@/components/CategoryFilter";

/**
 * AgentGallery — interactive wrapper used on /agents.
 * Combines SearchBar + CategoryFilter + AgentGrid with client state.
 */
export function AgentGallery({
  agents,
  initialCategory = "All",
}: {
  agents: Agent[];
  initialCategory?: CategoryValue;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryValue>(initialCategory);
  const [liveOnly, setLiveOnly] = useState(false);

  const counts = useMemo(() => {
    const c: Partial<Record<CategoryValue, number>> = { All: agents.length };
    for (const cat of categories) {
      c[cat] = agents.filter((a) => a.category === cat).length;
    }
    return c;
  }, [agents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) => {
      if (category !== "All" && a.category !== category) return false;
      if (liveOnly && a.status !== "live") return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.short.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.tagline.toLowerCase().includes(q)
      );
    });
  }, [agents, query, category, liveOnly]);

  return (
    <div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="sm:max-w-sm sm:flex-1">
            <SearchBar value={query} onChange={setQuery} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700 dark:text-paper/70">
            <input
              type="checkbox"
              checked={liveOnly}
              onChange={(e) => setLiveOnly(e.target.checked)}
              className="h-4 w-4 rounded border-ink-600/30 text-signal focus:ring-signal dark:border-paper/30"
            />
            Live demos only
          </label>
        </div>

        <CategoryFilter active={category} onChange={setCategory} counts={counts} />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-wide text-ink-500 dark:text-paper/50">
          {filtered.length} {filtered.length === 1 ? "agent" : "agents"}
        </p>
      </div>

      <div className="mt-5">
        <AgentGrid agents={filtered} />
      </div>
    </div>
  );
}
