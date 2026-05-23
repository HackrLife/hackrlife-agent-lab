interface HeroProps {
  onConsultClick: () => void;
}

export function Hero({ onConsultClick }: HeroProps) {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 right-[-10%] h-80 w-80 rounded-full bg-sky-200/40 blur-3xl" />
        <div className="absolute top-24 left-[-8%] h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl" />
      </div>

      <div className="mx-auto max-w-6xl px-5 pt-16 pb-10 sm:pt-24 sm:pb-12">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          HackrLife AgentLab · Agent 01
        </div>

        <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
          Lead Qualification Agent
        </h1>

        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
          Choose your lead source to run a demo agent, then get a deployment
          guide and an AI automation workflow. The source shapes how every lead
          is scored, routed, actioned — and the outreach cadence it gets.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            onClick={onConsultClick}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          >
            Book a consult to deploy this
            <Arrow />
          </button>
          <a
            href="#sources"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            Explore lead sources
          </a>
        </div>

        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
          <Chip>Source-aware scoring</Chip>
          <Chip>Human-in-the-loop workflow</Chip>
          <Chip>Per-source outreach cadence</Chip>
        </div>
      </div>
    </section>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg
        className="h-4 w-4 text-emerald-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m20 6-11 11-5-5" />
      </svg>
      {children}
    </span>
  );
}

function Arrow() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
