import Link from "next/link";
import type { Agent } from "@/lib/agents";
import { CategoryBadge, StatusBadge } from "@/components/Badge";

/**
 * AgentCard — a single agent in the gallery grid.
 * Live agents → "Try Demo". Preview agents → "Preview Use Case".
 */
export function AgentCard({ agent }: { agent: Agent }) {
  const isLive = agent.status === "live";
  return (
    <Link
      href={`/agents/${agent.slug}`}
      className="card card-hover group flex h-full flex-col p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <CategoryBadge category={agent.category} />
        <StatusBadge status={agent.status} />
      </div>

      <h3 className="font-display text-lg font-semibold leading-snug text-ink-900 dark:text-paper">
        {agent.name}
      </h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600 dark:text-paper/70">{agent.short}</p>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-ink-600/10 pt-4 dark:border-paper/10">
        <span className="font-mono text-[11px] uppercase tracking-wide text-ink-500 dark:text-paper/50">
          {agent.valueEstimate}
        </span>
        <span
          className={`inline-flex items-center gap-1 text-sm font-medium ${
            isLive ? "text-signal" : "text-ink-600 dark:text-paper/70"
          }`}
        >
          {isLive ? "Try Demo" : "Preview Use Case"}
          <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
        </span>
      </div>
    </Link>
  );
}
