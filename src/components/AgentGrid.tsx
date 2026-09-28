import type { Product } from "@/lib/catalogue/types";
import { AgentCard } from "@/components/AgentCard";

/**
 * AgentGrid — responsive grid of product cards.
 * 1 / row mobile, 2 / row tablet, 3 / row desktop.
 */
export function AgentGrid({ products }: { products: Product[] }) {
  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-600/20 bg-white/40 p-12 text-center dark:border-paper/20 dark:bg-ink-800/40">
        <p className="font-display text-lg text-ink-700 dark:text-paper/80">No solutions match these filters.</p>
        <p className="mt-1 text-sm text-ink-500 dark:text-paper/50">Try clearing the search or choosing another sector or outcome.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((p, i) => (
        <div key={p.slug} className="animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
          <AgentCard product={p} />
        </div>
      ))}
    </div>
  );
}
