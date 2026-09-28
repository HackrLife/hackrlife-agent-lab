import assert from "node:assert/strict";
import type { PathCase } from "./harness";

export const cases: PathCase[] = [
  {
    name: "tyres: changed price needs refreshed approval before a slot, then booked",
    scenario: "recover_tyres",
    steps: ["book", "approve_refreshed", "slot_0"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["No completed repair order matches DJ-5012", "Technician-marked work", "Price changed — refreshed estimate requires approval", "approved refreshed estimate v2", "Booking references accepted estimate EST-2107 v2"],
      records: { deferred: "Recovered", booking: "Confirmed", estimate: "v2 accepted" },
      check: (r) => assert.ok(r.records.find((x) => x.id === "booking")!.fields.some((f) => f.value.includes("A$436"))),
    },
  },
  {
    name: "changed price: no slot offered until the refreshed estimate is approved",
    scenario: "recover_tyres",
    steps: ["book"],
    expect: { status: "waiting_customer", noEvents: ["slots offered"], check: (r) => assert.ok(!r.actions.some((a) => a.id.startsWith("slot_"))) },
  },
  {
    name: "unchanged price goes straight to a slot on the original estimate",
    scenario: "unchanged_price",
    steps: ["free:yes, I can come in", "free:Thursday works"],
    expect: { outcome: "success", events: ["EST-2188 v1 still current"], noEvents: ["Price changed"], check: (r) => assert.ok(r.records.find((x) => x.id === "booking")!.fields.some((f) => f.value.startsWith("Thursday"))) },
  },
  {
    name: "already completed job is suppressed before contact",
    scenario: "already_completed",
    steps: [],
    expect: { status: "stopped", outcome: "exception", events: ["Already completed — RO-7731"], noEvents: ["Invitation 1"], records: { deferred: "Closed — completed" }, check: (r) => { assert.equal(r.outbox.filter((o) => o.status === "held").length, 0); assert.equal(r.outbox.filter((o) => o.status === "suppressed").length, 1); } },
  },
  {
    name: "decline ends outreach",
    scenario: "decline",
    steps: ["decline"],
    expect: { status: "stopped", events: ["Customer declined — outreach ended", "No further invitations"], records: { deferred: "Closed — customer declined" } },
  },
  {
    name: "declining the refreshed price also ends outreach",
    scenario: "recover_tyres",
    steps: ["book", "free:no, leave it"],
    expect: { status: "stopped", records: { estimate: "v2 declined", deferred: "declined" } },
  },
  {
    name: "postponement creates exactly one reminder (duplicate reply ignored)",
    scenario: "postpone",
    steps: ["postpone", "postpone_dup"],
    expect: {
      status: "waiting_customer",
      events: ["one reminder set for 2 months", "Duplicate reminder ignored"],
      records: { reminder: "Scheduled", deferred: "Postponed" },
      check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "task" && o.summary.includes("re-invite")).length, 1),
    },
  },
  {
    name: "agreed date re-checks history, re-invites; second postponement stops",
    scenario: "postpone",
    steps: ["postpone", "advance_reminder", "postpone"],
    expect: { status: "stopped", events: ["Agreed reminder date reached", "Second postponement — outreach ended"], check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "task").length, 1) },
  },
  {
    name: "contact limit: two invitations then stop",
    scenario: "unchanged_price",
    steps: ["no_reply", "no_reply"],
    expect: { status: "stopped", events: ["Contact limit reached (2 of 2)"], check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "sms").length, 2) },
  },
  {
    name: "not yet due: nothing sent until the review date",
    scenario: "not_yet_due",
    steps: [],
    expect: { status: "running", events: ["Review date in 2 months"], check: (r) => assert.equal(r.outbox.length, 0) },
  },
  {
    name: "condition question gets no new diagnosis",
    scenario: "recover_tyres",
    steps: ["free:are the tyres still ok for now?"],
    expect: { status: "waiting_customer", events: ["no new diagnosis given"] },
  },
  {
    name: "“No worries, book me in please” books (not a decline)",
    scenario: "unchanged_price",
    steps: ["free:No worries, book me in please", "slot_0"],
    expect: { status: "completed", outcome: "success", events: ["Customer wants to book"], noEvents: ["declined"], records: { deferred: "Recovered" } },
  },
  {
    name: "“don't remind me, just book it” books rather than postponing",
    scenario: "unchanged_price",
    steps: ["free:don't remind me later, just book it"],
    expect: { status: "waiting_customer", events: ["Customer wants to book"], noEvents: ["reminder set"] },
  },
  {
    name: "expired estimate at the same price says refreshed and unchanged, not updated",
    scenario: "unchanged_price",
    steps: [],
    expect: {
      status: "waiting_customer",
      check: (r) => {
        const { demo } = require("../src/lib/catalogue/products/repair-follow-up").repairFollowUp;
        const run = demo.act(demo.start({ ...r.inputs, elapsed_months: 8 }, "unchanged_price"), "book");
        const last = run.messages.filter((m: any) => m.from === "assistant").at(-1).text;
        assert.match(last, /expired/);
        assert.match(last, /unchanged at A\$129/);
        assert.doesNotMatch(last, /updated|was A\$/);
        assert.ok(run.events.some((e: any) => e.label.startsWith("Estimate expired")));
        assert.ok(run.actions.some((a: any) => a.label === "Approve refreshed estimate (A$129)"));
      },
    },
  },
];
