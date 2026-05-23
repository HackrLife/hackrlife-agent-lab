import type { Source } from "@/lib/leadQualifierData";
import { channelLabel } from "@/lib/leadQualifierData";
import { channelClasses } from "./tokens";

const channelIcon: Record<string, React.ReactNode> = {
  email: <PathIcon d="M3 7l9 6 9-6M3 7h18v10H3z" />,
  call: (
    <PathIcon d="M5 4h3l1.5 4.5L7.5 10a11 11 0 0 0 6 6l1.5-2 4.5 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 1-2z" />
  ),
  sms: <PathIcon d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z" />,
  dm: (
    <>
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
      />
      <circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" strokeWidth={1.8} />
    </>
  ),
};

export function CadenceTimeline({ source }: { source: Source }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-900">
          {source.cadenceIntensity} · {source.cadence.length} steps
        </span>
        <span className="text-[11px] text-slate-400">
          imports to SalesLoft · Outreach · HubSpot
        </span>
      </div>

      <ol className="flex flex-col">
        {source.cadence.map((step, i) => {
          const cc = channelClasses[step.channel];
          const last = i === source.cadence.length - 1;
          return (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cc.dot}`}
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {channelIcon[step.channel]}
                  </svg>
                </span>
                {!last && (
                  <span className="my-1 w-0.5 flex-1 bg-slate-200" style={{ minHeight: 14 }} />
                )}
              </div>
              <div className={last ? "pb-0" : "pb-3"}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    Day {step.day}
                  </span>
                  <span className={`text-[11px] font-semibold ${cc.text}`}>
                    {channelLabel[step.channel]}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-snug text-slate-900">
                  {step.intent}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PathIcon({ d }: { d: string }) {
  return <path d={d} />;
}
