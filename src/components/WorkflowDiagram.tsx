import type { WorkflowStep } from "@/lib/agents";

/**
 * WorkflowDiagram — horizontal (desktop) / vertical (mobile) step flow.
 * Visualises how a demo request travels: input → n8n → reasoning → output → review.
 */
export function WorkflowDiagram({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div className="relative">
      <ol className="grid gap-4 md:grid-cols-5">
        {steps.map((step, i) => (
          <li key={i} className="relative">
            <div className="card h-full p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-signal font-mono text-[11px] text-white">
                  {i + 1}
                </span>
                {i < steps.length - 1 && (
                  <span className="hidden flex-1 border-t border-dashed border-ink-600/25 dark:border-paper/20 md:block" />
                )}
              </div>
              <p className="font-display text-sm font-semibold text-ink-900 dark:text-paper">{step.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-600 dark:text-paper/70">{step.detail}</p>
            </div>
            {/* Connector arrow on mobile (vertical) */}
            {i < steps.length - 1 && (
              <div className="flex justify-center py-1 md:hidden">
                <span className="font-mono text-ink-500 dark:text-paper/50">↓</span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
