import type { Agent } from "@/lib/agents";
import { AgentCard } from "@/components/AgentCard";

/**
 * AgentGrid — responsive grid of agent cards.
 * Required layout: 1 / row mobile, 2 / row tablet, 3 / row desktop.
 */
export function AgentGrid({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-600/20 bg-white/40 p-12 text-center">
        <p className="font-display text-lg text-ink-700">No agents match your filters.</p>
        <p className="mt-1 text-sm text-ink-500">Try clearing the search or choosing another category.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent, i) => (
        <div key={agent.slug} className="animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
          <AgentCard agent={agent} />
        </div>
      ))}
    </div>
  );
}
