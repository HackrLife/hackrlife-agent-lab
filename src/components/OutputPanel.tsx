import { CTASection } from "@/components/CTASection";

export type OutputState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "success"; text: string };

/**
 * OutputPanel — renders the four states of a demo run:
 * idle, loading, error, success. On success it shows the formatted
 * output followed by the post-output "Book a consult" CTA.
 *
 * The n8n webhook may return arbitrary JSON. We normalise common
 * shapes into displayable text (see normaliseOutput in AgentForm).
 */
export function OutputPanel({ state }: { state: OutputState }) {
  return (
    <div className="rounded-2xl border border-ink-600/15 bg-ink-900 text-paper">
      <div className="flex items-center justify-between border-b border-paper/10 px-5 py-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-paper/50">
          Output panel
        </p>
        <StatusDot phase={state.phase} />
      </div>

      <div className="scroll-thin max-h-[28rem] overflow-y-auto px-5 py-5">
        {state.phase === "idle" && (
          <p className="font-mono text-sm text-paper/45">
            // Submit the demo above. Output appears here. Nothing is published or stored.
          </p>
        )}

        {state.phase === "loading" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm text-paper/70">
              <Spinner />
              <span className="font-mono">Running the workflow inside n8n…</span>
            </div>
            <div className="space-y-2 pt-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-paper/10" />
              <div className="h-3 w-full animate-pulse rounded bg-paper/10" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-paper/10" />
            </div>
          </div>
        )}

        {state.phase === "error" && (
          <div className="rounded-xl border border-ember/40 bg-ember/10 p-4">
            <p className="font-mono text-xs uppercase tracking-wide text-ember">Webhook error</p>
            <p className="mt-1.5 text-sm text-paper/80">{state.message}</p>
            <p className="mt-2 text-xs text-paper/50">
              The demo workflow could not be reached. This can happen if the backend is offline.
              You can try again, or book a consult to discuss this use case directly.
            </p>
          </div>
        )}

        {state.phase === "success" && (
          <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-paper/90">
            {state.text}
          </pre>
        )}
      </div>

      {state.phase === "success" && (
        <div className="border-t border-paper/10 p-4">
          <CTASection variant="output" />
        </div>
      )}
    </div>
  );
}

function StatusDot({ phase }: { phase: OutputState["phase"] }) {
  const map: Record<OutputState["phase"], { color: string; label: string }> = {
    idle: { color: "bg-paper/30", label: "idle" },
    loading: { color: "bg-data animate-pulse", label: "running" },
    error: { color: "bg-ember", label: "error" },
    success: { color: "bg-brand-light", label: "complete" },
  };
  const { color, label } = map[phase];
  return (
    <span className="flex items-center gap-2 font-mono text-[11px] text-paper/50">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-paper/20 border-t-signal" />
  );
}
