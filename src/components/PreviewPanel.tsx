import Link from "next/link";
import type { Agent } from "@/lib/agents";

/**
 * PreviewPanel — shown in place of a live form for Preview agents.
 * Describes the use case and routes to a consult, per the spec:
 * "Book a consult to explore this workflow."
 */
export function PreviewPanel({ agent }: { agent: Agent }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card relative overflow-hidden p-6">
        <span className="pill mb-4 border border-ink-600/20 bg-paper text-ink-600 dark:border-paper/20 dark:bg-ink-700/50 dark:text-paper/70">Preview</span>
        <h3 className="font-display text-xl font-semibold text-ink-900 dark:text-paper">
          Use-case preview
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-paper/70">
          This agent is a use-case preview, not a live demo yet. Here is the workflow it represents:
        </p>
        <div className="mt-5 space-y-3">
          {agent.workflow.map((step, i) => (
            <div key={i} className="flex gap-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-ink-900/5 font-mono text-[11px] text-ink-600 dark:bg-paper/10 dark:text-paper/70">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-ink-900 dark:text-paper">{step.title}</p>
                <p className="text-xs leading-relaxed text-ink-600 dark:text-paper/70">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card flex flex-col justify-center bg-ink-900 p-7 text-paper dark:bg-ink-800">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-brand-light/90">
          Want to test this one?
        </p>
        <h3 className="mt-3 font-display text-2xl font-semibold">
          Book a consult to explore this workflow.
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-paper/70">
          I can build a working version of this agent inside your own tools and scope what a safe,
          useful deployment would look like for your stack.
        </p>
        <div className="mt-6">
          <Link href="/consult" className="btn-signal">
            Book a consult to explore this workflow
          </Link>
        </div>
      </div>
    </div>
  );
}
