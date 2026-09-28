"use client";

import { useMemo, useState } from "react";
import { products } from "@/lib/catalogue";
import { OUTCOMES, SECTORS, type Outcome, type Sector } from "@/lib/catalogue/types";
import { AgentGrid } from "@/components/AgentGrid";
import { SearchBar } from "@/components/SearchBar";
import { PillFilter } from "@/components/CategoryFilter";

/**
 * AgentGallery — interactive wrapper used on /agents.
 * Search + Sector filter + Outcome filter over the product catalogue.
 * Products are read on the client (they carry demo functions).
 */
export function AgentGallery({
  initialSector = "All",
  initialOutcome = "All",
}: {
  initialSector?: Sector | "All";
  initialOutcome?: Outcome | "All";
}) {
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState<Sector | "All">(initialSector);
  const [outcome, setOutcome] = useState<Outcome | "All">(initialOutcome);

  const sectorCounts = useMemo(() => {
    const c: Partial<Record<Sector | "All", number>> = { All: products.length };
    for (const s of SECTORS) c[s] = products.filter((p) => p.sectors.includes(s)).length;
    return c;
  }, []);
  const outcomeCounts = useMemo(() => {
    const c: Partial<Record<Outcome | "All", number>> = { All: products.length };
    for (const o of OUTCOMES) c[o] = products.filter((p) => p.outcomes.includes(o)).length;
    return c;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (sector !== "All" && !p.sectors.includes(sector)) return false;
      if (outcome !== "All" && !p.outcomes.includes(outcome)) return false;
      if (!q) return true;
      return [p.name, p.outcome, p.definition, p.sectorLabel, ...p.sectors, ...p.outcomes].join(" ").toLowerCase().includes(q);
    });
  }, [query, sector, outcome]);

  return (
    <div>
      <div className="flex flex-col gap-4">
        <div className="sm:max-w-sm">
          <SearchBar value={query} onChange={setQuery} placeholder="Search solutions…" />
        </div>
        <PillFilter label="Sector" options={SECTORS} active={sector} onChange={setSector} counts={sectorCounts} />
        <PillFilter label="Outcome" options={OUTCOMES} active={outcome} onChange={setOutcome} counts={outcomeCounts} />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-wide text-ink-500 dark:text-paper/50">
          {filtered.length} {filtered.length === 1 ? "solution" : "solutions"}
        </p>
      </div>

      <div className="mt-5">
        <AgentGrid products={filtered} />
      </div>
    </div>
  );
}
