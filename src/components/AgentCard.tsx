import Link from "next/link";
import type { Product } from "@/lib/catalogue/types";
import { OutcomeBadge, StatusBadge } from "@/components/Badge";

/**
 * AgentCard — a single product in the gallery grid.
 * Same card design as before; copy follows the product catalogue.
 * Primary action: Explore solution. Secondary: Try demo (#demo).
 */
export function AgentCard({ product }: { product: Product }) {
  return (
    <div className="card card-hover group relative flex h-full flex-col p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <OutcomeBadge outcome={product.outcomes[0]} />
        <StatusBadge mode={product.demo.mode} />
      </div>

      <p className="font-mono text-[11px] uppercase tracking-wide text-ink-500 dark:text-paper/50">
        {String(product.no).padStart(2, "0")}
      </p>
      <h3 className="mt-1 font-display text-lg font-semibold leading-snug text-ink-900 dark:text-paper">
        <Link href={`/agents/${product.slug}`} className="after:absolute after:inset-0 after:rounded-2xl focus:outline-none">
          {product.name}
        </Link>
      </h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600 dark:text-paper/70">{product.outcome}</p>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-wide text-ink-500 dark:text-paper/50">
        {product.sectors.join(" · ")}
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-600/10 pt-4 dark:border-paper/10">
        <Link
          href={`/agents/${product.slug}#demo`}
          className="relative z-10 text-sm font-medium text-ink-600 hover:text-signal dark:text-paper/70 dark:hover:text-brand-light"
        >
          Try demo
        </Link>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-signal dark:text-brand-light">
          Explore solution
          <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
        </span>
      </div>
    </div>
  );
}
