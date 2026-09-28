import type { DemoDefinition, Outcome } from "@/lib/catalogue/types";

const outcomeColor: Record<Outcome, string> = {
  "Capture enquiries": "bg-data/15 text-data-600 dark:bg-data/20 dark:text-data",
  "Convert sales": "bg-signal/15 text-signal dark:bg-signal/25 dark:text-brand-light",
  "Fill capacity": "bg-ember/15 text-ember dark:bg-ember/20 dark:text-ember",
  "Grow repeat business": "bg-ink-900/8 text-ink-700 dark:bg-paper/10 dark:text-paper/80",
  "Manage orders": "bg-data/15 text-data-600 dark:bg-data/20 dark:text-data",
};

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return <span className={`pill ${outcomeColor[outcome]}`}>{outcome}</span>;
}

const MODE: Record<DemoDefinition["mode"], string> = {
  simulation: "Simulation",
  sandbox: "Live sandbox",
  walkthrough: "Walkthrough",
};

/** Honest demo status: never says "live" unless it is a live sandbox. */
export function StatusBadge({ mode }: { mode: DemoDefinition["mode"] }) {
  if (mode === "sandbox") {
    return (
      <span className="pill bg-signal text-white">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-pulseline rounded-full bg-white" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
        </span>
        {MODE[mode]}
      </span>
    );
  }
  if (mode === "simulation") {
    return <span className="pill bg-signal text-white">{MODE[mode]}</span>;
  }
  return (
    <span className="pill border border-ink-600/20 bg-paper text-ink-600 dark:border-paper/20 dark:bg-ink-700/50 dark:text-paper/70">
      {MODE[mode]}
    </span>
  );
}
