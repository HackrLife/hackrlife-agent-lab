/**
 * Catalogue test harness (run with: npx tsx tests/run.ts).
 * Not part of the Next build (tests/ is excluded in tsconfig).
 */
import assert from "node:assert/strict";
import type { Product, Run } from "../src/lib/catalogue/types";

export interface PathCase {
  scenario: string;
  /** Action ids to apply in order. Payload after a colon: "free:hello". */
  steps: string[];
  expect: {
    status?: Run["status"];
    outcome?: "success" | "exception" | "stopped" | "failed";
    /** Substrings that must appear in some event label. */
    events?: string[];
    /** Substrings that must NOT appear in any event label. */
    noEvents?: string[];
    /** record id → expected status substring. */
    records?: Record<string, string>;
    /** Custom assertion. */
    check?: (run: Run<any>) => void;
  };
  name: string;
}

export function scenarioInputs(p: Product, id: string) {
  const sc = p.demo.scenarios.find((s) => s.id === id);
  assert.ok(sc, `${p.id}: scenario ${id} not found`);
  return sc!.inputs;
}

export function play(p: Product, scenario: string, steps: string[]): Run<any> {
  let run = p.demo.start(scenarioInputs(p, scenario), scenario);
  for (const step of steps) {
    const [id, ...rest] = step.split(":");
    const payload = rest.length ? rest.join(":") : undefined;
    const available = run.actions.map((a) => a.id);
    assert.ok(
      available.includes(id),
      `${p.id}/${scenario}: action "${id}" not available after [${run.events.at(-1)?.label}]. Available: ${available.join(", ") || "(none — run finished: " + run.outcome?.summary + ")"}`,
    );
    run = p.demo.act(run, id, payload);
  }
  return run;
}

export function checkInvariants(p: Product, run: Run<any>, ctx: string) {
  const nodeIds = new Set(p.graph.nodes.map((n) => n.id));
  for (const e of run.events) assert.ok(nodeIds.has(e.node), `${ctx}: event "${e.label}" references unknown node "${e.node}"`);
  const finished = ["completed", "stopped", "failed"].includes(run.status);
  if (finished) {
    assert.equal(run.actions.length, 0, `${ctx}: finished run still has actions`);
    assert.ok(run.outcome, `${ctx}: finished run has no outcome`);
  } else {
    assert.ok(run.actions.length > 0, `${ctx}: unfinished run (${run.status}) has no actions — dead end`);
    assert.ok(!run.outcome, `${ctx}: unfinished run has an outcome`);
  }
  const keys = run.outbox.filter((o) => o.opKey).map((o) => o.opKey);
  assert.equal(new Set(keys).size, keys.length, `${ctx}: duplicate opKey in outbox (${keys.join(",")})`);
  const ids = run.records.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, `${ctx}: duplicate record ids`);
  const actIds = run.actions.map((a) => a.id);
  assert.equal(new Set(actIds).size, actIds.length, `${ctx}: duplicate action ids`);
  JSON.stringify(run); // must be serialisable
}

export function checkProductShape(p: Product) {
  const ids = p.graph.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, `${p.id}: duplicate node ids`);
  const set = new Set(ids);
  for (const e of p.graph.edges) {
    assert.ok(set.has(e.from) && set.has(e.to), `${p.id}: edge ${e.from}→${e.to} references unknown node`);
  }
  const actions = p.graph.nodes.filter((n) => n.kind === "action");
  assert.ok(actions.length >= 4 && actions.length <= 7, `${p.id}: needs 4–7 action nodes, has ${actions.length}`);
  assert.ok(p.graph.nodes.some((n) => n.kind === "branch"), `${p.id}: needs at least one branch node`);
  assert.ok(p.graph.nodes.some((n) => n.kind === "check"), `${p.id}: needs at least one check node`);
  for (const n of p.graph.nodes) {
    assert.ok(n.row >= 0 && n.row <= 6.5, `${p.id}: node ${n.id} row out of range`);
  }
  // Left and right columns must not overlap (node height ≈ 0.62 rows).
  for (const kind of ["branch", "check"] as const) {
    const rows = p.graph.nodes.filter((n) => n.kind === kind).map((n) => n.row).sort((a, b) => a - b);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i] - rows[i - 1] >= 0.7, `${p.id}: ${kind} nodes at rows ${rows[i - 1]} and ${rows[i]} overlap (need ≥ 0.7 apart)`);
    }
  }
  const sc = p.demo.scenarios;
  assert.ok(sc.some((s) => s.kind === "success"), `${p.id}: needs a success scenario`);
  assert.ok(sc.some((s) => s.kind === "exception"), `${p.id}: needs an exception scenario`);
  for (const f of ["name", "outcome", "definition", "situation", "endState", "ctaLine"] as const) {
    assert.ok(String(p[f]).length > 5, `${p.id}: missing ${f}`);
  }
  assert.ok(p.handles.length >= 3 && p.handles.length <= 5, `${p.id}: handles must be 3–5`);
  for (const s of sc) for (const f of p.demo.fields) assert.ok(f.name in s.inputs, `${p.id}/${s.id}: scenario missing input "${f.name}"`);
}

/** Random walks: every reachable state must satisfy invariants and never throw. */
export function fuzz(p: Product, walks = 150, maxSteps = 40) {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (const sc of p.demo.scenarios) {
    for (let w = 0; w < walks; w++) {
      let run = p.demo.start(sc.inputs, sc.id);
      checkInvariants(p, run, `${p.id}/${sc.id}/walk${w}/start`);
      for (let i = 0; i < maxSteps && run.actions.length; i++) {
        const a = run.actions[Math.floor(rnd() * run.actions.length)];
        const payload = a.freeText ? ["yes please", "no thanks", "Tuesday", "2000", "stop", "can you do it cheaper?"][Math.floor(rnd() * 6)] : undefined;
        const before = JSON.stringify(run);
        run = p.demo.act(run, a.id, payload);
        assert.equal(JSON.stringify(JSON.parse(before)), before, "immutability");
        checkInvariants(p, run, `${p.id}/${sc.id}/walk${w}/step${i}:${a.id}`);
      }
    }
  }
}

export function runCases(p: Product, cases: PathCase[]) {
  for (const c of cases) {
    const run = play(p, c.scenario, c.steps);
    const ctx = `${p.id} › ${c.name}`;
    checkInvariants(p, run, ctx);
    if (c.expect.status) assert.equal(run.status, c.expect.status, `${ctx}: status`);
    if (c.expect.outcome) assert.equal(run.outcome?.kind, c.expect.outcome, `${ctx}: outcome kind (summary: ${run.outcome?.summary})`);
    for (const s of c.expect.events ?? [])
      assert.ok(run.events.some((e) => e.label.toLowerCase().includes(s.toLowerCase())), `${ctx}: expected event containing "${s}". Got:\n  ${run.events.map((e) => e.label).join("\n  ")}`);
    for (const s of c.expect.noEvents ?? [])
      assert.ok(!run.events.some((e) => e.label.toLowerCase().includes(s.toLowerCase())), `${ctx}: unexpected event containing "${s}"`);
    for (const [id, st] of Object.entries(c.expect.records ?? {})) {
      const r = run.records.find((x) => x.id === id);
      assert.ok(r, `${ctx}: record ${id} missing`);
      assert.ok(r!.status.toLowerCase().includes(st.toLowerCase()), `${ctx}: record ${id} status "${r!.status}" should include "${st}"`);
    }
    c.expect.check?.(run);
  }
}
