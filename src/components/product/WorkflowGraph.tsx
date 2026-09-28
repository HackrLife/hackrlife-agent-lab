"use client";

import { useMemo, useRef, useState } from "react";
import type { DemoEvent, Graph, GraphNode } from "@/lib/catalogue/types";

/**
 * WorkflowGraph — product-specific schematic.
 *  - Overview: the business stages (action nodes) as a numbered strip.
 *  - Detailed: SVG with blue actions (centre), purple exception/return
 *    branches (left) and amber harness checks (right). Nodes are highlighted
 *    only from the demo's emitted events.
 *  - Inspector: click a node to see input, rule, output, failure path and
 *    what happened at that node in the current run.
 *  - Text: the full flow as an accessible list.
 */

const W = 960;
const NODE_H = 62;
const ROW = 100;
const PAD = 24;
const COL = {
  branch: { x: 16, w: 210 },
  action: { x: 372, w: 240 },
  check: { x: 734, w: 210 },
} as const;

type NodeState = "idle" | "active" | "done" | "halt";

function stateFromEvents(events: DemoEvent[]): Record<string, NodeState> {
  const out: Record<string, NodeState> = {};
  for (const e of events) {
    out[e.node] =
      e.status === "failed" || e.status === "stopped" || e.status === "blocked"
        ? "halt"
        : e.status === "passed" || e.status === "confirmed"
          ? "done"
          : "active";
  }
  return out;
}

function box(n: GraphNode) {
  const c = COL[n.kind];
  return { x: c.x, y: PAD + n.row * ROW, w: c.w, h: NODE_H };
}

function wrap(text: string, max = 24): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

const KIND_STYLE: Record<GraphNode["kind"], { box: string; text: string; label: string }> = {
  action: {
    box: "fill-data/10 stroke-data dark:fill-data/10",
    text: "fill-ink-900 dark:fill-paper",
    label: "Business step",
  },
  branch: {
    box: "fill-violet-400/10 stroke-violet-400",
    text: "fill-ink-900 dark:fill-paper",
    label: "Exception or return path",
  },
  check: {
    box: "fill-amber-400/10 stroke-amber-500 dark:stroke-amber-400",
    text: "fill-ink-900 dark:fill-paper",
    label: "Harness check",
  },
};

const STATE_RING: Record<NodeState, string> = {
  idle: "",
  active: "stroke-data",
  done: "stroke-emerald-400",
  halt: "stroke-signal dark:stroke-brand-light",
};

const STATE_WORD: Record<NodeState, string> = {
  idle: "Not reached",
  active: "In progress",
  done: "Passed",
  halt: "Stopped / blocked",
};

export function WorkflowGraph({
  graph,
  events,
  selectedNode,
  onSelectNode,
  focusEventNode,
}: {
  graph: Graph;
  events: DemoEvent[];
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  /** Node of the event the visitor clicked in the log (highlighted). */
  focusEventNode?: string | null;
}) {
  const [detailed, setDetailed] = useState(true);
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph]);
  const states = useMemo(() => stateFromEvents(events), [events]);
  const hasRun = events.length > 0;
  const lastNode = events.at(-1)?.node ?? null;
  const actions = graph.nodes.filter((n) => n.kind === "action").sort((a, b) => a.row - b.row);
  const maxRow = Math.max(...graph.nodes.map((n) => n.row));
  const H = PAD * 2 + maxRow * ROW + NODE_H;
  const selected = selectedNode ? byId[selectedNode] : null;
  const selectedEvents = selected ? events.filter((e) => e.node === selected.id) : [];

  return (
    <div className="card overflow-hidden">
      {/* Overview strip */}
      <div className="border-b border-ink-600/10 p-5 dark:border-paper/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-paper/50">Overview — business stages</p>
          <button type="button" onClick={() => setDetailed((d) => !d)} className="btn-ghost px-3 py-1.5 text-xs">
            {detailed ? "Hide detailed schematic" : "Show detailed schematic"}
          </button>
        </div>
        <ol className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {actions.map((n, i) => {
            const st = states[n.id] ?? "idle";
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onSelectNode(selectedNode === n.id ? null : n.id)}
                  className={`flex h-full w-full items-start gap-2 rounded-xl border p-2.5 text-left text-xs transition ${
                    selectedNode === n.id ? "border-signal" : "border-ink-600/15 dark:border-paper/15"
                  } ${hasRun && st === "idle" ? "opacity-50" : ""}`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full font-mono text-[10px] ${
                      st === "done" ? "bg-emerald-500 text-white" : st === "halt" ? "bg-signal text-white" : st === "active" ? "bg-data text-ink-900" : "bg-ink-600/15 text-ink-700 dark:bg-paper/15 dark:text-paper/80"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="leading-snug text-ink-800 dark:text-paper/85">{n.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {detailed && (
        <div className="grid lg:grid-cols-[1fr_300px]">
          <div className="relative border-b border-ink-600/10 dark:border-paper/10 lg:border-b-0 lg:border-r">
            <div className="absolute right-3 top-3 z-10 flex gap-1">
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))} className="h-7 w-7 rounded-full border border-ink-600/20 bg-paper/90 text-sm dark:border-paper/20 dark:bg-ink-800/90">−</button>
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(1)))} className="h-7 w-7 rounded-full border border-ink-600/20 bg-paper/90 text-sm dark:border-paper/20 dark:bg-ink-800/90">+</button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  scroller.current?.scrollTo({ left: 0, top: 0 });
                }}
                className="h-7 rounded-full border border-ink-600/20 bg-paper/90 px-2.5 text-[11px] dark:border-paper/20 dark:bg-ink-800/90"
              >
                Reset view
              </button>
            </div>
            <div
              ref={scroller}
              className="scroll-thin max-h-[680px] cursor-grab overflow-auto active:cursor-grabbing"
              onPointerDown={(e) => {
                if ((e.target as Element).closest("[data-node]")) return;
                const el = scroller.current!;
                drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
              }}
              onPointerMove={(e) => {
                if (!drag.current || !scroller.current) return;
                scroller.current.scrollLeft = drag.current.sl - (e.clientX - drag.current.x);
                scroller.current.scrollTop = drag.current.st - (e.clientY - drag.current.y);
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerLeave={() => (drag.current = null)}
            >
              <svg
                viewBox={`0 0 ${W} ${H}`}
                style={{ width: `${Math.max(720, W * zoom)}px`, maxWidth: zoom === 1 ? "100%" : undefined, minWidth: zoom === 1 ? 720 : undefined }}
                className="block h-auto select-none"
                role="img"
                aria-label="Detailed workflow schematic. The same flow is available as text below."
              >
                <defs>
                  {[
                    ["arrow-flow", "fill-ink-500 dark:fill-paper/60"],
                    ["arrow-return", "fill-violet-400"],
                    ["arrow-check", "fill-amber-500 dark:fill-amber-400"],
                  ].map(([id, cls]) => (
                    <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" className={cls} />
                    </marker>
                  ))}
                </defs>

                {/* Edges */}
                {graph.edges.map((e, i) => {
                  const a = byId[e.from];
                  const b = byId[e.to];
                  if (!a || !b) return null;
                  const A = box(a);
                  const B = box(b);
                  let d = "";
                  let lx = 0;
                  let ly = 0;
                  if (e.kind === "check") {
                    const x1 = A.x;
                    const y1 = A.y + A.h / 2;
                    const x2 = B.x + B.w;
                    const y2 = B.y + B.h / 2;
                    d = `M${x1},${y1} C${x1 - 50},${y1} ${x2 + 50},${y2} ${x2 + 2},${y2}`;
                    lx = (x1 + x2) / 2;
                    ly = (y1 + y2) / 2 - 6;
                  } else if (a.kind === "action" && b.kind === "action" && b.row > a.row) {
                    const x = A.x + A.w / 2;
                    if (Math.abs(b.row - a.row - 1) < 0.01) {
                      d = `M${x},${A.y + A.h} L${x},${B.y - 2}`;
                    } else {
                      const xr = A.x + A.w;
                      d = `M${xr},${A.y + A.h - 12} C${xr + 40},${A.y + A.h} ${xr + 40},${B.y} ${xr},${B.y + 12}`;
                    }
                    lx = x + 30;
                    ly = (A.y + A.h + B.y) / 2;
                  } else if (a.kind === "action" && b.kind === "action") {
                    // loop back up on the right side
                    const xr = A.x + A.w;
                    d = `M${xr},${A.y + 14} C${xr + 60},${A.y} ${xr + 60},${B.y + B.h} ${xr + 2},${B.y + B.h - 14}`;
                    lx = xr + 42;
                    ly = (A.y + B.y + B.h) / 2;
                  } else if (A.x === B.x) {
                    // same column (e.g. branch → branch): arc on the outer side
                    const outer = A.x < 300 ? A.x : A.x + A.w;
                    const dir = A.x < 300 ? -1 : 1;
                    const y1 = A.y + A.h / 2;
                    const y2 = B.y + B.h / 2;
                    d = `M${outer},${y1} C${outer + dir * 34},${y1} ${outer + dir * 34},${y2} ${outer + dir * 2},${y2}`;
                    lx = outer + dir * 30;
                    ly = (y1 + y2) / 2;
                  } else {
                    // across columns (action ↔ branch, or anything else)
                    const off = a.kind === "action" ? -9 : 9;
                    const fromLeft = A.x < B.x;
                    const left = fromLeft ? A : B;
                    const right = fromLeft ? B : A;
                    const x1 = left.x + left.w;
                    const y1 = left.y + left.h / 2 + off;
                    const x2 = right.x;
                    const y2 = right.y + right.h / 2 + off;
                    const [sx, sy, tx, ty] = fromLeft ? [x1, y1, x2 - 2, y2] : [x2, y2, x1 + 2, y1];
                    const bend = fromLeft ? 40 : -40;
                    d = `M${sx},${sy} C${sx + bend},${sy} ${tx - bend},${ty} ${tx},${ty}`;
                    // label sits beside the purple node, just outside it
                    lx = x1 + 8;
                    ly = y1 + (off < 0 ? -7 : 16);
                  }
                  const cls =
                    e.kind === "check"
                      ? "stroke-amber-500 dark:stroke-amber-400"
                      : e.kind === "return" && a.kind === "branch"
                        ? "stroke-violet-400"
                        : "stroke-ink-500 dark:stroke-paper/50";
                  const marker = e.kind === "check" ? "arrow-check" : cls.includes("violet") ? "arrow-return" : "arrow-flow";
                  const label = e.label ?? (e.kind === "check" ? "check" : "");
                  return (
                    <g key={i}>
                      <path d={d} fill="none" strokeWidth={1.6} strokeDasharray={e.kind === "check" ? "6 5" : undefined} className={cls} markerEnd={`url(#${marker})`} />
                      {label && (
                        <text x={lx} y={ly} textAnchor={e.kind === "check" || A.x === B.x || (a.kind === "action" && b.kind === "action") ? "middle" : "start"} className={`text-[11px] ${e.kind === "check" ? "fill-amber-600 dark:fill-amber-400" : "fill-violet-500 dark:fill-violet-300"}`} style={{ paintOrder: "stroke" }} strokeWidth={4} stroke="transparent">
                          {label}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Nodes */}
                {graph.nodes.map((n) => {
                  const b = box(n);
                  const st = states[n.id] ?? "idle";
                  const lines = wrap(n.title, n.kind === "action" ? 26 : 24);
                  const isSel = selectedNode === n.id;
                  const isFocus = focusEventNode === n.id;
                  const isLast = lastNode === n.id;
                  return (
                    <g
                      key={n.id}
                      data-node={n.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${KIND_STYLE[n.kind].label}: ${n.title}. ${hasRun ? STATE_WORD[st] : ""}`}
                      onClick={() => onSelectNode(isSel ? null : n.id)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          onSelectNode(isSel ? null : n.id);
                        }
                      }}
                      className={`cursor-pointer outline-none transition-opacity ${hasRun && st === "idle" && !isSel ? "opacity-40" : "opacity-100"}`}
                    >
                      {(st !== "idle" || isSel || isFocus) && (
                        <rect
                          x={b.x - 5}
                          y={b.y - 5}
                          width={b.w + 10}
                          height={b.h + 10}
                          rx={12}
                          fill="none"
                          strokeWidth={isSel || isFocus || isLast ? 2.5 : 1.5}
                          strokeDasharray={isLast && !isSel && !isFocus ? "4 3" : undefined}
                          className={isSel || isFocus ? "stroke-signal dark:stroke-brand-light" : STATE_RING[st]}
                        />
                      )}
                      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} strokeWidth={1.5} className={KIND_STYLE[n.kind].box} />
                      <text textAnchor="middle" className={`text-[14px] ${KIND_STYLE[n.kind].text}`}>
                        {lines.map((l, i) => (
                          <tspan key={i} x={b.x + b.w / 2} y={b.y + b.h / 2 + (i - (lines.length - 1) / 2) * 17 + 5}>
                            {l}
                          </tspan>
                        ))}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-ink-600/10 px-5 py-3 text-[11px] text-ink-600 dark:border-paper/10 dark:text-paper/60">
              <Legend swatch="border-data bg-data/10">Business step</Legend>
              <Legend swatch="border-violet-400 bg-violet-400/10">Exception, return or stop</Legend>
              <Legend swatch="border-amber-500 bg-amber-400/10">Harness check</Legend>
              <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-amber-500" /> Required check</span>
              {hasRun && (
                <>
                  <Legend swatch="border-emerald-400">Passed in this run</Legend>
                  <Legend swatch="border-signal dark:border-brand-light">Stopped / blocked</Legend>
                </>
              )}
            </div>
          </div>

          {/* Inspector */}
          <aside className="p-5" aria-live="polite">
            {selected ? (
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-paper/50">{KIND_STYLE[selected.kind].label}</p>
                <h4 className="mt-1 font-display text-lg font-semibold text-ink-900 dark:text-paper">{selected.title}</h4>
                <dl className="mt-3 space-y-2.5 text-sm">
                  <Row k="Input">{selected.input}</Row>
                  <Row k={selected.kind === "check" ? "Pass condition" : "Rule or tool"}>{selected.rule}</Row>
                  <Row k="Output">{selected.output}</Row>
                  {selected.failure && selected.failure !== "—" && <Row k={selected.kind === "check" ? "On failure" : "Exception / stop"}>{selected.failure}</Row>}
                  {selected.system && <Row k="System">{selected.system}</Row>}
                </dl>
                <div className="mt-4 border-t border-ink-600/10 pt-3 dark:border-paper/10">
                  <p className="font-mono text-[11px] uppercase tracking-wide text-ink-500 dark:text-paper/50">In this run</p>
                  {selectedEvents.length ? (
                    <ul className="mt-2 space-y-1.5 text-xs text-ink-700 dark:text-paper/75">
                      {selectedEvents.map((e) => (
                        <li key={e.id}>
                          <span className="font-mono text-[10px] uppercase text-ink-500 dark:text-paper/50">{e.status}</span> — {e.label}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-ink-500 dark:text-paper/50">{hasRun ? "This branch did not execute in the current run." : "Run the demo to see what happens here."}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-ink-600 dark:text-paper/65">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-paper/50">Node inspection</p>
                <p className="mt-2 leading-relaxed">Select any step, branch or check to see its input, rule, output and failure path. Nodes light up only from events the demo actually emitted.</p>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Text alternative */}
      <details className="border-t border-ink-600/10 px-5 py-4 text-sm dark:border-paper/10">
        <summary className="cursor-pointer font-medium text-ink-800 dark:text-paper/85">Read the full flow as text</summary>
        <ol className="mt-3 space-y-3">
          {graph.nodes
            .slice()
            .sort((a, b) => (a.kind === b.kind ? a.row - b.row : ["action", "branch", "check"].indexOf(a.kind) - ["action", "branch", "check"].indexOf(b.kind)))
            .map((n) => {
              const outs = graph.edges.filter((e) => e.from === n.id);
              return (
                <li key={n.id} className="text-ink-700 dark:text-paper/75">
                  <span className="font-semibold text-ink-900 dark:text-paper">{n.title}</span>{" "}
                  <span className="text-xs text-ink-500 dark:text-paper/50">({KIND_STYLE[n.kind].label.toLowerCase()})</span>
                  <br />
                  {n.rule}. Output: {n.output}.
                  {outs.length > 0 && (
                    <>
                      {" "}Leads to:{" "}
                      {outs.map((e, i) => (
                        <span key={i}>
                          {byId[e.to]?.title}
                          {e.label ? ` (${e.label})` : e.kind === "check" ? " (required check)" : ""}
                          {i < outs.length - 1 ? "; " : "."}
                        </span>
                      ))}
                    </>
                  )}
                </li>
              );
            })}
        </ol>
      </details>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500 dark:text-paper/50">{k}</dt>
      <dd className="mt-0.5 leading-snug text-ink-800 dark:text-paper/85">{children}</dd>
    </div>
  );
}

function Legend({ swatch, children }: { swatch: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-4 rounded-sm border-2 ${swatch}`} />
      {children}
    </span>
  );
}
