/**
 * FeatureList — a titled bullet list used across agent detail sections
 * (helps with, who it's for, limitations, full deployment).
 */
export function FeatureList({
  title,
  items,
  tone = "default",
}: {
  title: string;
  items: string[];
  tone?: "default" | "muted" | "signal";
}) {
  const marker =
    tone === "signal"
      ? "bg-signal"
      : tone === "muted"
      ? "bg-ink-500 dark:bg-paper/40"
      : "bg-signal";

  return (
    <div className="card p-6">
      <h3 className="font-display text-lg font-semibold text-ink-900 dark:text-paper">{title}</h3>
      <ul className="mt-4 space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-700 dark:text-paper/75">
            <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${marker}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
