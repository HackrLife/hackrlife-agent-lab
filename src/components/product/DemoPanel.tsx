"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DemoAction, DemoEvent, FieldTone, Inputs, Product, Run, RunStatus } from "@/lib/catalogue/types";
import { fmtClock } from "@/lib/catalogue/sim";

/**
 * DemoPanel — the interactive simulation.
 * Left: customer experience. Right: business result (status, records,
 * outbox, event trace). On mobile these become tabs.
 */

const STATUS_LABEL: Record<RunStatus, string> = {
  idle: "Idle",
  running: "Running",
  waiting_customer: "Waiting for customer",
  waiting_staff: "Waiting for staff",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
};

const STATUS_CLS: Record<RunStatus, string> = {
  idle: "border border-ink-600/20 text-ink-600 dark:border-paper/20 dark:text-paper/70",
  running: "bg-data/20 text-data-600 dark:text-data",
  waiting_customer: "bg-data/20 text-data-600 dark:text-data",
  waiting_staff: "bg-amber-400/20 text-amber-700 dark:text-amber-300",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  stopped: "bg-violet-400/20 text-violet-700 dark:text-violet-300",
  failed: "bg-signal text-white",
};

const TONE: Record<FieldTone, string> = {
  ok: "text-emerald-700 dark:text-emerald-300",
  warn: "text-amber-700 dark:text-amber-300",
  bad: "text-signal dark:text-brand-light",
  muted: "italic text-ink-500 dark:text-paper/45",
  default: "text-ink-800 dark:text-paper/85",
};

const EVENT_DOT: Record<DemoEvent["status"], string> = {
  started: "bg-data",
  waiting: "bg-data",
  info: "bg-ink-500 dark:bg-paper/50",
  passed: "bg-emerald-500",
  confirmed: "bg-emerald-500",
  failed: "bg-signal",
  stopped: "bg-violet-400",
  blocked: "bg-amber-500",
};

const MODE_LABEL: Record<Product["demo"]["mode"], string> = {
  simulation: "Interactive simulation",
  sandbox: "Live sandbox",
  walkthrough: "Guided walkthrough",
};

export function DemoPanel({
  product,
  scenarioId,
  inputs,
  run,
  onScenario,
  onInput,
  onRun,
  onAct,
  onReset,
  onEventFocus,
  focusedEvent,
}: {
  product: Product;
  scenarioId: string;
  inputs: Inputs;
  run: Run | null;
  onScenario: (id: string) => void;
  onInput: (name: string, value: string | number | boolean) => void;
  onRun: () => void;
  onAct: (actionId: string, payload?: string) => void;
  onReset: () => void;
  onEventFocus: (ev: DemoEvent | null) => void;
  focusedEvent: string | null;
}) {
  const demo = product.demo;
  const [tab, setTab] = useState<"conversation" | "result" | "workflow">("conversation");
  const [showInputs, setShowInputs] = useState(true);
  const [speak, setSpeak] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const spokenCount = useRef(0);
  const scenario = demo.scenarios.find((s) => s.id === scenarioId);

  // Keep the newest message visible inside the chat panel only.
  useEffect(() => {
    const el = chatEnd.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run?.messages.length]);

  // Optional speech output for voice products.
  useEffect(() => {
    if (!run) {
      spokenCount.current = 0;
      return;
    }
    const msgs = run.messages;
    if (speak && typeof window !== "undefined" && "speechSynthesis" in window) {
      for (let i = spokenCount.current; i < msgs.length; i++) {
        if (msgs[i].from === "assistant") window.speechSynthesis.speak(new SpeechSynthesisUtterance(msgs[i].text));
      }
    }
    spokenCount.current = msgs.length;
  }, [run, speak]);

  const customerActions = run?.actions.filter((a) => a.actor === "customer") ?? [];
  const staffActions = run?.actions.filter((a) => a.actor === "staff") ?? [];
  const clockActions = run?.actions.filter((a) => a.actor === "clock") ?? [];
  const finished = run && ["completed", "stopped", "failed"].includes(run.status);

  return (
    <div className="space-y-5">
      {/* Mode + boundary */}
      <div className="flex flex-wrap items-start gap-3">
        <span className="pill bg-signal text-white">{MODE_LABEL[demo.mode]}</span>
        <p className="flex-1 text-sm leading-relaxed text-ink-600 dark:text-paper/70">{demo.boundary}</p>
      </div>

      {/* Scenario presets */}
      <div className="card p-5">
        <p className="label">Choose a scenario</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Scenario">
          {demo.scenarios.map((s) => {
            const active = s.id === scenarioId;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onScenario(s.id)}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                  active
                    ? "border-signal bg-signal text-white"
                    : "border-ink-600/20 bg-paper/60 text-ink-700 hover:border-signal hover:text-signal dark:border-paper/20 dark:bg-ink-800/50 dark:text-paper/70"
                }`}
              >
                {s.label}
                <span className={`ml-1.5 font-mono text-[10px] uppercase ${active ? "text-white/80" : "text-ink-500 dark:text-paper/45"}`}>
                  {s.kind === "success" ? "success" : "exception"}
                </span>
              </button>
            );
          })}
        </div>
        {scenario && <p className="mt-3 text-sm text-ink-600 dark:text-paper/70">{scenario.description}</p>}

        <div className="mt-4 border-t border-ink-600/10 pt-4 dark:border-paper/10">
          <button type="button" onClick={() => setShowInputs((v) => !v)} className="text-sm font-medium text-ink-800 hover:text-signal dark:text-paper/85" aria-expanded={showInputs}>
            {showInputs ? "▾" : "▸"} Edit sample inputs
          </button>
          {showInputs && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {demo.fields.map((f) => {
                const id = `in-${product.id}-${f.name}`;
                const v = inputs[f.name];
                return (
                  <div key={f.name}>
                    {f.kind === "toggle" ? (
                      <label htmlFor={id} className="flex cursor-pointer items-center gap-2 pt-7 text-sm text-ink-700 dark:text-paper/80">
                        <input id={id} type="checkbox" checked={v === true} onChange={(e) => onInput(f.name, e.target.checked)} className="h-4 w-4 rounded border-ink-600/30 text-signal focus:ring-signal" />
                        {f.label}
                      </label>
                    ) : (
                      <>
                        <label htmlFor={id} className="label">{f.label}</label>
                        {f.kind === "select" ? (
                          <select id={id} className="field" value={String(v ?? "")} onChange={(e) => onInput(f.name, e.target.value)}>
                            {f.options.map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <div className="relative">
                            <input
                              id={id}
                              className="field"
                              type={f.kind === "number" ? "number" : "text"}
                              value={String(v ?? "")}
                              min={f.kind === "number" ? f.min : undefined}
                              max={f.kind === "number" ? f.max : undefined}
                              step={f.kind === "number" ? f.step : undefined}
                              onChange={(e) => onInput(f.name, f.kind === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
                            />
                            {f.kind === "number" && f.suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-500 dark:text-paper/50">{f.suffix}</span>}
                          </div>
                        )}
                      </>
                    )}
                    {f.helper && <p className="mt-1 text-xs text-ink-500 dark:text-paper/50">{f.helper}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onRun} className="btn-primary">
            {run ? "Restart with these inputs" : "Run scenario"} <span aria-hidden>→</span>
          </button>
          <button type="button" onClick={onReset} className="btn-ghost" disabled={!run}>
            Reset
          </button>
          {demo.voice && (
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-ink-700 dark:text-paper/75">
              <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} className="h-4 w-4 rounded border-ink-600/30 text-signal focus:ring-signal" />
              Read replies aloud (browser voice)
            </label>
          )}
        </div>
      </div>

      {/* Mobile tabs */}
      <div className="flex gap-1 rounded-full border border-ink-600/15 p-1 dark:border-paper/15 lg:hidden" role="tablist">
        {(["conversation", "result", "workflow"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium capitalize ${tab === t ? "bg-signal text-white" : "text-ink-700 dark:text-paper/70"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Customer side */}
        <section className={`card flex min-h-[420px] flex-col ${tab === "conversation" ? "" : "hidden lg:flex"}`} aria-label="Customer experience">
          <header className="flex items-center justify-between border-b border-ink-600/10 px-5 py-3 dark:border-paper/10">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-paper/50">Customer side · {demo.channelLabel}</p>
          </header>
          <div className="scroll-thin max-h-[460px] flex-1 space-y-3 overflow-y-auto p-5" aria-live="polite">
            {!run && <p className="text-sm text-ink-500 dark:text-paper/50">Press “Run scenario” to start. Every message and record here comes from sample data.</p>}
            {run?.messages.map((m, i) => <Bubble key={i} from={m.from} text={m.text} t={m.t} assistant={demo.assistantName} />)}
            <div ref={chatEnd} />
          </div>
          {customerActions.length > 0 && (
            <div className="border-t border-ink-600/10 p-4 dark:border-paper/10">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-ink-500 dark:text-paper/50">Reply as the customer</p>
              <ActionList actions={customerActions} onAct={onAct} voice={!!demo.voice} />
            </div>
          )}
        </section>

        {/* Business side */}
        <section className={`card flex min-h-[420px] flex-col ${tab === "result" ? "" : "hidden lg:flex"}`} aria-label="Business result">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600/10 px-5 py-3 dark:border-paper/10">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-paper/50">Business result</p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-ink-500 dark:text-paper/55" title="Simulation clock">⏱ {fmtClock(run?.clock ?? 0)}</span>
              <span className={`pill ${STATUS_CLS[run?.status ?? "idle"]}`}>{STATUS_LABEL[run?.status ?? "idle"]}</span>
            </div>
          </header>
          <div className="scroll-thin max-h-[560px] flex-1 space-y-4 overflow-y-auto p-5">
            {(clockActions.length > 0 || staffActions.length > 0) && (
              <div className="space-y-3 rounded-xl border border-amber-400/40 bg-amber-400/5 p-3">
                {staffActions.length > 0 && (
                  <div>
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">Owner / staff decision</p>
                    <ActionList actions={staffActions} onAct={onAct} />
                  </div>
                )}
                {clockActions.length > 0 && (
                  <div>
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-ink-500 dark:text-paper/50">Simulation clock</p>
                    <ActionList actions={clockActions} onAct={onAct} />
                  </div>
                )}
              </div>
            )}

            {!run && <p className="text-sm text-ink-500 dark:text-paper/50">Records, messages waiting in the outbox and the event trace appear here as the workflow runs.</p>}

            {run?.records.map((r) => (
              <div key={r.id} className="rounded-xl border border-ink-600/15 p-3.5 dark:border-paper/15">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-900 dark:text-paper">
                    {r.title}
                    {r.ref && <span className="ml-2 font-mono text-xs font-normal text-ink-500 dark:text-paper/55">{r.ref}</span>}
                  </p>
                  <span className={`text-xs font-medium ${TONE[r.tone ?? "default"]}`}>{r.status}</span>
                </div>
                <dl className="mt-2 grid grid-cols-[minmax(0,40%)_1fr] gap-x-3 gap-y-1 text-xs">
                  {r.fields.map((f, i) => (
                    <div key={i} className="contents">
                      <dt className="text-ink-500 dark:text-paper/50">{f.label}</dt>
                      <dd className={TONE[f.tone ?? "default"]}>{f.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}

            {run && run.outbox.length > 0 && (
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-ink-500 dark:text-paper/50">Outbox and external writes</p>
                <ul className="space-y-1.5 text-xs">
                  {run.outbox.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-600/5 px-2.5 py-1.5 dark:bg-paper/5">
                      <span className="font-mono uppercase text-ink-500 dark:text-paper/50">{o.channel}</span>
                      <span className="flex-1 text-ink-800 dark:text-paper/80">{o.summary} <span className="text-ink-500 dark:text-paper/45">→ {o.to}</span></span>
                      <span className={`font-mono text-[10px] uppercase ${o.status === "failed" ? "text-signal" : o.status === "pending" ? "text-amber-600 dark:text-amber-300" : "text-ink-500 dark:text-paper/50"}`}>
                        {o.status === "held" ? "held (not sent)" : o.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {run && <div className="lg:block"><EventLog events={run.events} onFocus={onEventFocus} focused={focusedEvent} /></div>}
          </div>
        </section>

        {/* Mobile workflow tab: trace only (full schematic is below) */}
        <section className={`card p-5 lg:hidden ${tab === "workflow" ? "" : "hidden"}`}>
          {run ? <EventLog events={run.events} onFocus={onEventFocus} focused={focusedEvent} /> : <p className="text-sm text-ink-500 dark:text-paper/50">Run the demo to see the workflow trace. The full schematic is further down the page.</p>}
          <a href="#workflow" className="mt-4 inline-block text-sm font-medium text-signal">View the schematic ↓</a>
        </section>
      </div>

      {/* Outcome */}
      {finished && run?.outcome && (
        <div
          className={`rounded-2xl border p-5 sm:p-6 ${
            run.outcome.kind === "success" ? "border-emerald-500/40 bg-emerald-500/5" : run.outcome.kind === "failed" ? "border-signal/50 bg-signal/10" : "border-violet-400/40 bg-violet-400/5"
          }`}
          role="status"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-paper/55">
            {run.outcome.kind === "success" ? "Verified outcome" : run.outcome.kind === "failed" ? "Failed safely" : "Exception handled"}
          </p>
          <p className="mt-2 text-base leading-relaxed text-ink-900 dark:text-paper">{run.outcome.summary}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link href={`/book?product=${product.slug}&scenario=${run.scenarioId}`} className="btn-primary">Book a demo for my business</Link>
            <span className="text-sm text-ink-600 dark:text-paper/70">{product.ctaLine}</span>
            <button type="button" onClick={onReset} className="btn-ghost ml-auto">Try another scenario</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({ from, text, t, assistant }: { from: string; text: string; t: number; assistant: string }) {
  if (from === "system") {
    return <p className="text-center font-mono text-[11px] text-ink-500 dark:text-paper/50">{text}</p>;
  }
  const mine = from === "customer";
  const who = from === "customer" ? "Customer" : from === "staff" ? "Owner / staff" : assistant;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          mine
            ? "rounded-br-sm bg-signal text-white"
            : from === "staff"
              ? "rounded-bl-sm border border-amber-400/40 bg-amber-400/10 text-ink-900 dark:text-paper"
              : "rounded-bl-sm bg-ink-600/10 text-ink-900 dark:bg-paper/10 dark:text-paper"
        }`}
      >
        <p className={`mb-0.5 text-[10px] font-medium uppercase tracking-wide ${mine ? "text-white/75" : "text-ink-500 dark:text-paper/50"}`}>
          {who} · {fmtClock(t).replace(/^Day \d+ \(/, "").replace(")", "")}
        </p>
        {text}
      </div>
    </div>
  );
}

function ActionList({ actions, onAct, voice }: { actions: DemoAction[]; onAct: (id: string, payload?: string) => void; voice?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);

  function listen() {
    const W = window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any };
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "en-AU";
    rec.interimResults = false;
    rec.onresult = (e: any) => setText(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  }
  const canListen = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  return (
    <div className="flex flex-col gap-2">
      {actions.map((a) => (
        <div key={a.id}>
          {a.freeText && open === a.id ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                onAct(a.id, text.trim());
                setText("");
                setOpen(null);
              }}
            >
              <input autoFocus className="field py-2" placeholder={a.freeText.placeholder} value={text} onChange={(e) => setText(e.target.value)} aria-label={a.label} />
              {voice && canListen && (
                <button type="button" onClick={listen} className="btn-ghost px-3" aria-label="Speak your reply">
                  {listening ? "…" : "🎤"}
                </button>
              )}
              <button type="submit" className="btn-primary px-4">Send</button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => (a.freeText ? setOpen(a.id) : onAct(a.id))}
              className={`w-full rounded-xl border px-3.5 py-2 text-left text-sm transition ${
                a.tone === "primary"
                  ? "border-signal bg-signal/10 font-medium text-ink-900 hover:bg-signal hover:text-white dark:text-paper"
                  : a.tone === "danger"
                    ? "border-ink-600/20 text-ink-700 hover:border-signal hover:text-signal dark:border-paper/20 dark:text-paper/75"
                    : "border-ink-600/20 text-ink-800 hover:border-signal dark:border-paper/20 dark:text-paper/85"
              }`}
            >
              {a.label}
              {a.hint && <span className="mt-0.5 block text-xs font-normal opacity-70">{a.hint}</span>}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function EventLog({ events, onFocus, focused }: { events: DemoEvent[]; onFocus: (e: DemoEvent | null) => void; focused: string | null }) {
  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-ink-500 dark:text-paper/50">Event trace — select to highlight in the schematic</p>
      <ol className="space-y-1">
        {events.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onFocus(focused === e.id ? null : e)}
              className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${focused === e.id ? "bg-signal/15" : "hover:bg-ink-600/5 dark:hover:bg-paper/5"}`}
            >
              <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${EVENT_DOT[e.status]}`} />
              <span className="flex-1">
                <span className="text-ink-900 dark:text-paper/90">{e.label}</span>
                {e.detail && <span className="block text-ink-500 dark:text-paper/50">{e.detail}</span>}
              </span>
              <span className="font-mono text-[10px] uppercase text-ink-500 dark:text-paper/45">{e.status}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
