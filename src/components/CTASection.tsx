import Link from "next/link";

/**
 * CTASection — the recurring "Book a demo for my business" call to action.
 * `variant="output"` is the compact version shown after demo output.
 */
export function CTASection({
  title = "Want this connected to your own business?",
  body = "If a demo matches a problem you have, book a call. We map your process, confirm what your systems can connect to, and scope the rules, approvals and tests before anything goes live.",
  primaryLabel = "Book a demo for my business",
  variant = "section",
}: {
  title?: string;
  body?: string;
  primaryLabel?: string;
  variant?: "section" | "output";
}) {
  if (variant === "output") {
    return (
      <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-signal/40 bg-signal/10 p-5 dark:bg-signal/15 sm:flex-row sm:items-center">
        <p className="text-sm font-medium text-ink-800 dark:text-paper/90">
          Want this connected to your own business?
        </p>
        <Link href="/book" className="btn-signal whitespace-nowrap">
          {primaryLabel}
        </Link>
      </div>
    );
  }

  return (
    <section className="container-lab my-20">
      <div className="relative overflow-hidden rounded-2xl border border-ink-600/15 bg-ink-900 px-7 py-12 text-paper sm:px-12 sm:py-16">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.07]" />
        <div className="pointer-events-none absolute -right-10 top-0 h-48 w-48 rounded-full bg-signal/20 blur-3xl" />
        <div className="relative max-w-2xl">
          <h2 className="font-display text-3xl font-semibold sm:text-4xl">{title}</h2>
          <p className="mt-4 text-base leading-relaxed text-paper/70">{body}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/book" className="btn-signal">
              {primaryLabel}
            </Link>
            <Link href="/agents" className="btn-ghost border-paper/20 bg-transparent text-paper hover:border-paper/50 hover:bg-paper/5">
              Explore solutions
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
