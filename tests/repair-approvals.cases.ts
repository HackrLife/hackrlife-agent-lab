import assert from "node:assert/strict";
import type { PathCase } from "./harness";

const receipt = (r: any) => r.records.find((x: any) => x.id === "receipt");
const field = (rec: any, label: string) => rec.fields.find((f: any) => f.label === label)?.value as string;

export const cases: PathCase[] = [
  {
    name: "partial approval contains only the selected brake work",
    scenario: "brakes_only",
    steps: ["submit"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["Customer C-1042 verified", "Explicit item selection received", "Totals recalculated: A$486", "Authorisation recorded"],
      records: { receipt: "Authorised — EST-2231 v1", workshop: "approved items only" },
      check: (r) => {
        const rec = receipt(r);
        assert.match(field(rec, "Approved items"), /Front brake pads and rotors/);
        assert.doesNotMatch(field(rec, "Approved items"), /filter/i);
        assert.match(field(rec, "Declined items"), /Cabin air filter/);
        assert.match(field(rec, "Total approved"), /^A\$486 /);
        assert.ok(field(rec, "Timestamp").startsWith("Day 1"));
      },
    },
  },
  {
    name: "approve all: deterministic total of both lines",
    scenario: "all_items",
    steps: ["submit"],
    expect: { outcome: "success", records: { receipt: "EST-2245 v1" }, check: (r) => assert.match(field(receipt(r), "Total approved"), /^A\$426 /) },
  },
  {
    name: "a yes to the pickup question is never treated as approval",
    scenario: "brakes_only",
    steps: ["pickup_yes", "free:yes please"],
    expect: {
      status: "waiting_customer",
      events: ["not an approval", "not an item approval"],
      records: { workshop: "awaiting authorisation" },
      check: (r) => { assert.equal(receipt(r), undefined); assert.equal(r.outbox.filter((o) => o.channel === "task").length, 0); },
    },
  },
  {
    name: "technical question goes to adviser review before approval",
    scenario: "technical_question",
    steps: [],
    expect: { status: "waiting_staff", events: ["Technical question — service adviser review"], check: (r) => assert.equal(receipt(r), undefined) },
  },
  {
    name: "adviser answers, then customer approves",
    scenario: "technical_question",
    steps: ["adviser_answer", "submit"],
    expect: { outcome: "success", events: ["Adviser answered"], check: (r) => assert.ok(r.messages.some((m) => m.from === "staff" && m.text.includes("24.1 mm"))) },
  },
  {
    name: "stale estimate blocks approval and requests review; v2 then approved",
    scenario: "revised",
    steps: ["submit"],
    expect: { status: "waiting_customer", events: ["revised EST-2231 to v2", "Estimate v1 is stale — approval blocked", "Estimate changed"], noEvents: ["Authorisation recorded"], records: { estimate: "Current v2", workshop: "estimate revised" } },
  },
  {
    name: "after review, approval records v2 with the recalculated total",
    scenario: "revised",
    steps: ["submit", "submit"],
    expect: { outcome: "success", records: { receipt: "EST-2231 v2" }, check: (r) => assert.match(field(receipt(r), "Total approved"), /^A\$600 /) },
  },
  {
    name: "repeated confirmation records one authorisation",
    scenario: "brakes_only",
    steps: ["toggle_filter", "toggle_filter", "submit_twice"],
    expect: {
      outcome: "success",
      events: ["Duplicate authorisation ignored"],
      check: (r) => {
        assert.equal(r.outbox.filter((o) => o.channel === "crm").length, 1);
        assert.equal(r.events.filter((e) => e.label.startsWith("Authorisation recorded")).length, 1);
      },
    },
  },
  {
    name: "decline all stops with no authorisation",
    scenario: "decline_all",
    steps: ["decline_all"],
    expect: { status: "stopped", outcome: "exception", events: ["Customer declined all work"], records: { workshop: "Do not proceed" }, check: (r) => { assert.equal(receipt(r), undefined); assert.ok(!r.actions.some((a) => a.id === "submit")); } },
  },
  {
    name: "nothing selected → no confirm button offered",
    scenario: "decline_all",
    steps: [],
    expect: { status: "waiting_customer", check: (r) => assert.ok(!r.actions.some((a) => a.id === "submit")) },
  },
  {
    name: "Mazda estimate: question references its own items (drums/shoes), never rotors or pads",
    scenario: "all_items",
    steps: ["ask_question", "adviser_answer", "submit"],
    expect: {
      outcome: "success",
      check: (r) => {
        const texts = r.messages.filter((m) => m.from === "customer").map((m) => m.text).join(" ");
        assert.match(texts, /drums/);
        assert.doesNotMatch(texts, /rotor|pads/i);
        const q = r.outbox.find((o) => o.channel === "task")!;
        assert.match(q.summary, /EST-2245/);
      },
    },
  },
  {
    name: "Mazda estimate with technical question on: customer asks about drums, not rotors",
    scenario: "all_items",
    steps: [],
    expect: { status: "waiting_customer", check: (r) => { const b = r.actions.find((a) => a.id === "ask_question")!; assert.match(b.label, /drums/); assert.doesNotMatch(b.label, /rotor/i); } },
  },
  {
    name: "“No worries, go ahead” is still not an item approval",
    scenario: "brakes_only",
    steps: ["free:No worries, go ahead"],
    expect: { status: "waiting_customer", events: ["not an item approval"], check: (r) => assert.equal(receipt(r), undefined) },
  },
];
