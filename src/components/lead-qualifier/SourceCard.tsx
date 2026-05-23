"use client";

import { useState } from "react";
import type { Source } from "@/lib/leadQualifierData";
import { SourceIcon } from "./SourceIcon";
import { weightClasses, formatWeight } from "./tokens";

interface SourceCardProps {
  source: Source;
  isSelected: boolean;
  isRunning: boolean;
  onRun: (s: Source) => void;
}

export function SourceCard({
  source,
  isSelected,
  isRunning,
  onRun,
}: SourceCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <article
      className={`group flex h-full flex-col rounded-2xl border bg-white p-4 shadow-sm transition ${
        isSelected
          ? "border-slate-900 ring-1 ring-slate-900"
          : "border-slate-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
          <SourceIcon icon={source.icon} />
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${weightClasses(
            source.weight
          )}`}
          title="Source weight applied to the base score"
        >
          {formatWeight(source.weight)} wt
        </span>
      </div>

      <h3 className="mt-3 text-sm font-semibold leading-snug text-slate-900">
        {source.title}
      </h3>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
        {source.description}
      </p>
      <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-400">
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="5" r="2" />
          <path d="M8 19h4a4 4 0 0 0 4-4V7" />
        </svg>
        {source.posture}
      </p>

      <button
        type="button"
        onClick={() => setShowPrompt((v) => !v)}
        className="mt-3 inline-flex w-fit items-center gap-1 text-[11px] font-semibold text-slate-500 transition hover:text-slate-800"
        aria-expanded={showPrompt}
      >
        <svg
          className={`h-3 w-3 transition-transform ${showPrompt ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        {showPrompt ? "Hide prompt" : "View prompt"}
      </button>

      {showPrompt && (
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
          {source.prompt}
        </pre>
      )}

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => onRun(source)}
        disabled={isRunning}
        className={`mt-3 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
          isSelected
            ? "bg-emerald-600 text-white hover:bg-emerald-500 focus-visible:ring-emerald-600"
            : "bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-slate-900"
        } disabled:cursor-not-allowed disabled:opacity-70`}
      >
        {isRunning ? (
          <>
            <Spinner /> Running…
          </>
        ) : isSelected ? (
          <>
            <CheckSmall /> Agent run · see below
          </>
        ) : (
          <>
            <Play /> Run Agent
          </>
        )}
      </button>
    </article>
  );
}

function Play() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function CheckSmall() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z"
      />
    </svg>
  );
}
