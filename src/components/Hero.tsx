import Link from "next/link";

/**
 * Hero — homepage hero.
 * Headline: "HackrLife Agent Lab"
 * Strapline: "Automations that answer enquiries, book customers and keep business moving. Try a sample workflow, see what happens behind the scenes and book a conversation about connecting it to your own business."
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-paper/40 to-paper dark:via-ink-900/40 dark:to-ink-900" />

      <div className="container-lab relative py-20 sm:py-28">
        <div className="animate-fade-up">
          <span className="pill border border-ink-600/20 bg-white/70 text-ink-700 dark:border-paper/20 dark:bg-ink-800/60 dark:text-paper/80">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            Small business automations
          </span>
        </div>

        <h1
          className="animate-fade-up mt-6 max-w-4xl font-display text-5xl font-semibold leading-[1.05] tracking-tight text-ink-900 dark:text-paper sm:text-6xl md:text-7xl"
          style={{ animationDelay: "60ms" }}
        >
          HackrLife{" "}
          <span className="relative whitespace-nowrap">
            <span className="relative z-10">Agent Lab</span>
            <span className="absolute bottom-1 left-0 z-0 h-3 w-full -rotate-1 bg-signal/60" />
          </span>
        </h1>

        <p
          className="animate-fade-up mt-6 max-w-2xl text-lg leading-relaxed text-ink-600 dark:text-paper/70 sm:text-xl"
          style={{ animationDelay: "120ms" }}
        >
          Automations that answer enquiries, book customers and keep business moving. Try a sample workflow, see what happens behind the scenes and book a conversation about connecting it to your own business.
        </p>

        <div className="animate-fade-up mt-9 flex flex-wrap gap-3" style={{ animationDelay: "180ms" }}>
          <Link href="/agents" className="btn-primary text-base">
            Explore solutions
          </Link>
          <Link href="/book" className="btn-ghost text-base">
            Book a demo for my business
          </Link>
        </div>

        <div
          className="animate-fade-up mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-xs uppercase tracking-wide text-ink-500 dark:text-paper/50"
          style={{ animationDelay: "240ms" }}
        >
          <span>20 solutions</span>
          <span className="hidden h-3 w-px bg-ink-600/20 dark:bg-paper/20 sm:block" />
          <span>Try every demo without signing up</span>
          <span className="hidden h-3 w-px bg-ink-600/20 dark:bg-paper/20 sm:block" />
          <span>Sample data only</span>
          <span className="hidden h-3 w-px bg-ink-600/20 dark:bg-paper/20 sm:block" />
          <span>No real messages or charges</span>
        </div>
      </div>
    </section>
  );
}
