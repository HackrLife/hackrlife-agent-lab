"use client";

import {
  SCORE_COMPONENTS,
  SCORE_BANDS,
  BASE_POINTS,
  buildGuide,
  buildChecklist,
  type Source,
} from "@/lib/leadQualifierData";
import { downloadMarkdown } from "@/lib/markdown";
import { WorkflowDiagram } from "./WorkflowDiagram";
import { CadenceTimeline } from "./CadenceTimeline";
import { bandClasses, weightClasses, formatWeight } from "./tokens";

interface OutputGalleryProps {
  source: Source;
  onConsultClick: () => void;
}

export function OutputGallery({ source, onConsultClick }: OutputGalleryProps) {
  const guide = buildGuide(source);
  const checklist = buildChecklist(source);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white/70 p-5 shadow-sm backdrop-blur sm:p-8">
      {/* header + download */}
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Agent run complete
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
            Starter Pack — {source.title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Scoring is shared; routing, automation, and the outreach cadence are
            unique to this source.
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadMarkdown(source)}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
        >
          <Download /> Download full pack (.md)
        </button>
      </div>

      <div className="mt-8 space-y-10">
        {/* 1 — Scoring formula */}
        <Section
          n={1}
          eyebrow="Statistical model"
          title="Lead scoring formula"
          subtitle={`A ${BASE_POINTS}-point base score, nudged by this source's weight.`}
          downloadLabel="Download scoring sheet"
        >
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Component</th>
                  <th className="px-4 py-3 text-right font-semibold">Points</th>
                  <th className="hidden px-4 py-3 font-semibold sm:table-cell">
                    What it measures
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {SCORE_COMPONENTS.map((c) => (
                  <tr key={c.label} className="align-top">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {c.label}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
                        {c.points}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-slate-600 sm:table-cell">
                      {c.description}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    Base total
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">
                    {BASE_POINTS}
                  </td>
                  <td className="hidden sm:table-cell" />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <span>Final score = base score</span>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${weightClasses(
                source.weight
              )}`}
            >
              {formatWeight(source.weight)} weight
            </span>
            <span>, capped 0–100.</span>
          </div>
        </Section>

        {/* 2 — Scoring bands */}
        <Section
          n={2}
          eyebrow="Routing logic"
          title="Scoring bands"
          subtitle="The shared bands every final score maps to."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SCORE_BANDS.map((b) => (
              <div
                key={b.label}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${bandClasses[b.tone].chip}`}
                >
                  {b.range}
                </span>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {b.label}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* 3 — Routing & actions (source-specific) */}
        <Section
          n={3}
          eyebrow="Source-specific"
          title="Routing & actions"
          subtitle={`What each band does for a ${source.title} lead.`}
          downloadLabel="Download routing rules"
        >
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-slate-700">
              Posture: {source.posture}
            </p>
            <div className="divide-y divide-slate-100">
              {source.routing.map((r) => (
                <div
                  key={r.band}
                  className="flex items-center gap-3 py-2.5"
                >
                  <span
                    className={`inline-flex w-16 shrink-0 justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${bandClasses[r.tone].chip}`}
                  >
                    {r.band}
                  </span>
                  <span className="text-sm text-slate-900">{r.action}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* 4 — Automation diagram (source-specific) */}
        <Section
          n={4}
          eyebrow="Automation diagram"
          title="Workflow with human in the loop"
          subtitle="This source's unique path, ending in cadence enrolment."
          downloadLabel="Export diagram (PNG / PDF)"
        >
          <WorkflowDiagram source={source} />
        </Section>

        {/* 5 — Outreach cadence (source-specific) */}
        <Section
          n={5}
          eyebrow="Sales automation"
          title="Outreach cadence"
          subtitle="A source-tuned sequence your reps can run. Full email copy in the download."
          downloadLabel="Download cadence + email copy"
        >
          <CadenceTimeline source={source} />
        </Section>

        {/* 6 — Implementation guide */}
        <Section
          n={6}
          eyebrow="Stakeholder pitch"
          title="Implementation guide"
          subtitle="Problem, solution, and implementation in five parts."
          downloadLabel="Download implementation guide"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {guide.map((part) => (
              <div
                key={part.n}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-900 text-[11px] font-bold text-white">
                    {part.n}
                  </span>
                  <h4 className="text-sm font-semibold text-slate-900">
                    {part.title}
                  </h4>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {part.bullets.map((b, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-xs leading-relaxed text-slate-600"
                    >
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        {/* 7 — Deployment checklist */}
        <Section
          n={7}
          eyebrow="Rollout plan"
          title="Deployment checklist"
          subtitle="From definition to live routing in a week."
          downloadLabel="Download deployment checklist"
        >
          <ol className="space-y-2">
            {checklist.map((d) => (
              <li
                key={d.day}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-700">
                  D{d.day}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {d.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                    {d.task}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        {/* 8 — Consult CTA */}
        <div className="overflow-hidden rounded-3xl bg-slate-900 p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-white">
                Ready to deploy this for {source.title}?
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
                We&apos;ll calibrate the scoring, routing, and cadence to your
                offer and wire the automation into your stack — with a human
                approval step you control.
              </p>
            </div>
            <button
              type="button"
              onClick={onConsultClick}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
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

function Section({
  n,
  eyebrow,
  title,
  subtitle,
  downloadLabel,
  children,
}: {
  n: number;
  eyebrow: string;
  title: string;
  subtitle: string;
  downloadLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-500">
          {n}
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
            {eyebrow}
          </p>
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">
            {title}
          </h3>
          <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>
        </div>
      </div>
      {children}
      {downloadLabel && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            title="Generates once the automation is connected"
          >
            <Download className="h-3.5 w-3.5" /> {downloadLabel}
          </button>
          <span className="text-[11px] text-slate-400">
            generates once automation is connected
          </span>
        </div>
      )}
    </div>
  );
}

function Download({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M5 21h14" />
    </svg>
  );
}
