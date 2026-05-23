import { buildWorkflow, type Source, type WorkflowStep } from "@/lib/leadQualifierData";

const laneClasses: Record<WorkflowStep["lane"], string> = {
  ingest: "bg-sky-100 text-sky-700",
  weight: "bg-violet-100 text-violet-700",
  agent: "bg-slate-200 text-slate-700",
  human: "bg-amber-100 text-amber-700",
  deliver: "bg-emerald-100 text-emerald-700",
};

export function WorkflowDiagram({ source }: { source: Source }) {
  const steps = buildWorkflow(source);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      <div className="flex flex-col gap-0">
        {steps.map((step, i) => {
          const last = i === steps.length - 1;
          return (
            <div key={i} className="flex flex-col">
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${laneClasses[step.lane]}`}
                >
                  {i + 1}
                </span>
                <span className="text-sm font-medium text-slate-900">
                  {step.title}
                </span>
                {step.lane === "human" && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    <Person /> review
                  </span>
                )}
              </div>
              {!last && (
                <div className="flex justify-center py-1 text-slate-300">
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 5v14M6 13l6 6 6-6" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Person() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}
