import { ReactNode } from "react";

/** Small uppercase mono label used above section headings. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-500 dark:text-paper/50">
      <span className="h-1.5 w-1.5 rounded-full bg-signal" />
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  intro,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
}) {
  return (
    <div className="max-w-2xl">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="font-display text-3xl font-semibold text-ink-900 dark:text-paper sm:text-4xl">{title}</h2>
      {intro && <p className="mt-3 text-base leading-relaxed text-ink-600 dark:text-paper/70">{intro}</p>}
    </div>
  );
}
