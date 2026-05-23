"use client";

import { useRef, useState } from "react";
import { SOURCES, type Source } from "@/lib/leadQualifierData";
import { Hero } from "@/components/lead-qualifier/Hero";
import { SourceCard } from "@/components/lead-qualifier/SourceCard";
import { OutputGallery } from "@/components/lead-qualifier/OutputGallery";
import { ConsultCTA } from "@/components/lead-qualifier/ConsultCTA";

/**
 * v1 NOTE
 * -------
 * "Run Agent" is simulated client-side (a short timeout). To wire up the
 * automation later, replace the timeout body in `handleRun` with a POST to
 * your webhook and call setSelected(source) when the response returns. The
 * gallery already renders from source data, so the change is isolated here.
 */

// Consult CTA: opens the visitor's email app addressed to us, with a prefilled
// subject. To change the address or subject, edit this one line.
const CONSULT_MAILTO =
  "mailto:dev@hackrlife.com?subject=Consult%3A%20Lead%20Qualification%20Agent";

export default function LeadQualifierPage() {
  const [selected, setSelected] = useState<Source | null>(null);
  const [runningSlug, setRunningSlug] = useState<string | null>(null);
  const galleryRef = useRef<HTMLDivElement | null>(null);

  function handleRun(source: Source) {
    setRunningSlug(source.slug);
    window.setTimeout(() => {
      setSelected(source);
      setRunningSlug(null);
      window.setTimeout(() => {
        galleryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 60);
    }, 600);
  }

  function handleConsultClick() {
    window.location.href = CONSULT_MAILTO;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 antialiased">
      <Hero onConsultClick={handleConsultClick} />

      <section id="sources" className="mx-auto max-w-6xl px-5 pb-4">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Choose your lead source
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Each source carries a weight that nudges the score, then sets its own
            routing, automation, and outreach cadence.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
          {SOURCES.map((s) => (
            <SourceCard
              key={s.slug}
              source={s}
              isSelected={selected?.slug === s.slug}
              isRunning={runningSlug === s.slug}
              onRun={handleRun}
            />
          ))}
        </div>
      </section>

      <div ref={galleryRef} className="mx-auto max-w-6xl px-5 py-10">
        {selected ? (
          <OutputGallery source={selected} onConsultClick={handleConsultClick} />
        ) : (
          <EmptyState />
        )}
      </div>

      <ConsultCTA onConsultClick={handleConsultClick} />

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-5 py-6 text-sm text-slate-500 sm:flex-row">
          <span>© {new Date().getFullYear()} HackrLife AgentLab</span>
          <span>agents.hackrlife.com · Lead Qualification Agent</span>
        </div>
      </footer>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white/60 p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">
        Run an agent to see the starter pack
      </h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
        Pick any lead source above and hit <strong>Run Agent</strong>. Its
        tailored qualification pack — scoring, routing, automation, and cadence —
        appears right here.
      </p>
    </div>
  );
}
