import type { Category, DemoStatus } from "@/lib/agents";

const categoryColor: Record<Category, string> = {
  Marketing: "bg-data/15 text-data-600 dark:bg-data/20 dark:text-data",
  Content: "bg-signal/15 text-signal dark:bg-signal/25 dark:text-brand-light",
  Research: "bg-ink-900/8 text-ink-700 dark:bg-paper/10 dark:text-paper/80",
  Operations: "bg-ember/15 text-ember dark:bg-ember/20 dark:text-ember",
  Creator: "bg-data/15 text-data-600 dark:bg-data/20 dark:text-data",
  Freelancer: "bg-signal/15 text-signal dark:bg-signal/25 dark:text-brand-light",
  "Small Business": "bg-ember/15 text-ember dark:bg-ember/20 dark:text-ember",
};

export function CategoryBadge({ category }: { category: Category }) {
  return <span className={`pill ${categoryColor[category]}`}>{category}</span>;
}

export function StatusBadge({ status }: { status: DemoStatus }) {
  if (status === "live") {
    return (
      <span className="pill bg-signal text-white">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-pulseline rounded-full bg-white" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
        </span>
        Live Demo
      </span>
    );
  }
  return (
    <span className="pill border border-ink-600/20 bg-paper text-ink-600 dark:border-paper/20 dark:bg-ink-700/50 dark:text-paper/70">
      Preview
    </span>
  );
}
