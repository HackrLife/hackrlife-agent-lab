interface ConsultCTAProps {
  onConsultClick: () => void;
}

export function ConsultCTA({ onConsultClick }: ConsultCTAProps) {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-8 text-center shadow-sm sm:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-emerald-200/30 blur-3xl"
        />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
            HackrLife AgentLab
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
            Deploy a Lead Qualification Agent for your team
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
            Pick the lead source that matches your pipeline, take the starter
            pack, and book a consult. We&apos;ll calibrate the scoring model,
            the source-aware routing, and the outreach cadence to your offer —
            with a human approval step you stay in control of.
          </p>
          <div className="mt-8">
            <button
              type="button"
              onClick={onConsultClick}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
            >
              Book a consult to deploy this
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
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
