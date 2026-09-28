/**
 * src/lib/catalogue/sim.ts
 * ------------------------------------------------------------------
 * Small helper that every product state machine uses.
 *
 *   start:  const sim = Sim.begin(productId, scenarioId, inputs, initialState)
 *   act:    const sim = Sim.from(run)   // works on a deep copy
 *
 * then call sim.say / sim.emit / sim.record / sim.send / sim.wait / sim.finish
 * and return sim.run. Runs are plain JSON so React can store them.
 * ------------------------------------------------------------------
 */

import type {
  DemoAction,
  DemoEvent,
  EventStatus,
  FieldTone,
  Inputs,
  OutboxItem,
  RecordField,
  ResultRecord,
  Run,
  RunOutcome,
  RunStatus,
  Speaker,
} from "./types";

function randomId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Deterministic short hash so references look real but are stable per run. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export class Sim<S> {
  run: Run<S>;

  private constructor(run: Run<S>) {
    this.run = run;
  }

  static begin<S>(productId: string, scenarioId: string, inputs: Inputs, state: S): Sim<S> {
    return new Sim<S>({
      runId: `run_${randomId()}`,
      productId,
      scenarioId,
      status: "running",
      clock: 0,
      inputs: { ...inputs },
      messages: [],
      events: [],
      actions: [],
      records: [],
      outbox: [],
      opKeys: [],
      state,
      seq: 0,
    });
  }

  static from<S>(run: Run<S>): Sim<S> {
    return new Sim<S>(JSON.parse(JSON.stringify(run)) as Run<S>);
  }

  /** Mutable product state. */
  get s(): S {
    return this.run.state;
  }

  get inputs(): Inputs {
    return this.run.inputs;
  }

  str(name: string, fallback = ""): string {
    const v = this.run.inputs[name];
    return v === undefined || v === null ? fallback : String(v);
  }

  num(name: string, fallback = 0): number {
    const v = Number(this.run.inputs[name]);
    return Number.isFinite(v) ? v : fallback;
  }

  bool(name: string): boolean {
    const v = this.run.inputs[name];
    return v === true || v === "true" || v === "yes";
  }

  /** Deterministic reference such as BK-4821 (unique within a run). */
  ref(prefix: string): string {
    this.run.seq += 1;
    const n = (hash(`${this.run.runId}:${prefix}:${this.run.seq}`) % 9000) + 1000;
    return `${prefix}-${n}`;
  }

  say(from: Speaker, text: string): this {
    this.run.messages.push({ from, text, t: this.run.clock });
    return this;
  }

  emit(
    node: string,
    status: EventStatus,
    label: string,
    detail?: string,
    extra?: { opKey?: string; ref?: string },
  ): this {
    this.run.seq += 1;
    const ev: DemoEvent = {
      id: `ev_${this.run.seq}`,
      t: this.run.clock,
      node,
      status,
      label,
      ...(detail ? { detail } : {}),
      ...(extra?.opKey ? { opKey: extra.opKey } : {}),
      ...(extra?.ref ? { ref: extra.ref } : {}),
    };
    this.run.events.push(ev);
    return this;
  }

  /** Advance the simulation clock. */
  advance(minutes: number): this {
    this.run.clock += Math.max(0, Math.round(minutes));
    return this;
  }

  /** Insert or update a result record by id (never duplicates). */
  record(rec: {
    id: string;
    title: string;
    status: string;
    tone?: FieldTone;
    ref?: string;
    fields: RecordField[];
  }): this {
    const next: ResultRecord = { ...rec };
    const i = this.run.records.findIndex((r) => r.id === rec.id);
    if (i >= 0) this.run.records[i] = next;
    else this.run.records.push(next);
    return this;
  }

  /** Update some fields/status of an existing record. */
  patch(id: string, changes: { status?: string; tone?: FieldTone; ref?: string; fields?: RecordField[] }): this {
    const r = this.run.records.find((x) => x.id === id);
    if (!r) return this;
    if (changes.status !== undefined) r.status = changes.status;
    if (changes.tone !== undefined) r.tone = changes.tone;
    if (changes.ref !== undefined) r.ref = changes.ref;
    for (const f of changes.fields ?? []) {
      const j = r.fields.findIndex((x) => x.label === f.label);
      if (j >= 0) r.fields[j] = f;
      else r.fields.push(f);
    }
    return this;
  }

  getRecord(id: string): ResultRecord | undefined {
    return this.run.records.find((r) => r.id === id);
  }

  /**
   * Idempotency guard. Returns true the first time an operation key is seen,
   * false (and logs a deduplication event) on any repeat.
   */
  claim(opKey: string, node: string, what = "operation"): boolean {
    if (this.run.opKeys.includes(opKey)) {
      this.emit(node, "blocked", `Duplicate ${what} ignored`, `Operation key ${opKey} already completed.`, { opKey });
      return false;
    }
    this.run.opKeys.push(opKey);
    return true;
  }

  /** Queue a simulated external side effect (message, calendar write, CRM write …). */
  send(item: Omit<OutboxItem, "id" | "t">): this {
    this.run.seq += 1;
    this.run.outbox.push({ ...item, id: `ob_${this.run.seq}`, t: this.run.clock });
    return this;
  }

  /** Replace the actions available to the visitor and set the waiting status. */
  wait(status: Extract<RunStatus, "waiting_customer" | "waiting_staff" | "running">, actions: DemoAction[]): this {
    this.run.status = status;
    this.run.actions = actions;
    return this;
  }

  /** End the run. Clears all actions. */
  finish(status: Extract<RunStatus, "completed" | "stopped" | "failed">, outcome: RunOutcome): this {
    this.run.status = status;
    this.run.outcome = outcome;
    this.run.actions = [];
    return this;
  }

  done(): Run<S> {
    return this.run;
  }
}

/* ----------------------------- Formatting ------------------------------ */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Simulation clock: run starts Monday 09:00. */
export function fmtClock(minutes: number, startHour = 9): string {
  const total = startHour * 60 + minutes;
  const day = Math.floor(total / 1440);
  const m = total % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `Day ${day + 1} (${DAYS[day % 7]}) ${hh}:${mm}`;
}

export function aud(n: number): string {
  return `A$${n.toLocaleString("en-AU", { maximumFractionDigits: 2, minimumFractionDigits: n % 1 === 0 ? 0 : 2 })}`;
}

export const MIN = 1;
export const HOUR = 60;
export const DAY = 1440;
