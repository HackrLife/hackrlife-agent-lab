import assert from "node:assert/strict";
import type { PathCase } from "./harness";

const emails = (r: any) => r.outbox.filter((o: any) => o.channel === "email").length;

export const cases: PathCase[] = [
  { name: "approved campaign fills and closes with contribution", scenario: "fill_midweek", steps: ["approve", "book2", "book2", "close"], expect: { status: "completed", outcome: "success", events: ["Explicit owner approval", "Batch 1 queued", "Allocation filled"], records: { campaign: "Closed — 4 of 4", audience: "40 eligible" }, check: (r) => assert.equal(emails(r), 1) } },
  { name: "plan states contribution estimate with assumptions before approval", scenario: "fill_midweek", steps: [], expect: { status: "waiting_staff", records: { campaign: "Proposed" }, check: (r) => { const c = r.records.find((x: any) => x.id === "campaign"); assert.ok(c.fields.some((f: any) => f.label === "Contribution estimate")); assert.ok(c.fields.filter((f: any) => f.label.startsWith("Assumption")).length >= 3); assert.equal(emails(r), 0); } } },
  { name: "inventory is recomputed before the next batch", scenario: "fill_midweek", steps: ["approve", "book1", "next_day"], expect: { events: ["Direct full-rate booking", "Inventory recomputed: 4 unsold, 3 offer night(s) left", "Batch 2 queued"], check: (r) => assert.equal(emails(r), 2) } },
  { name: "below-floor offer is blocked, then revised by owner", scenario: "below_floor", steps: [], expect: { status: "waiting_staff", events: ["Below margin floor"], records: { campaign: "Blocked" }, check: (r) => assert.equal(emails(r), 0) } },
  { name: "revised offer clears floor and can be approved", scenario: "below_floor", steps: ["revise", "approve"], expect: { events: ["Owner revised offer to “25% off midweek”", "Margin floor cleared"], records: { campaign: "Running" }, check: (r) => assert.equal(emails(r), 1) } },
  { name: "owner rejection sends nothing", scenario: "owner_rejects", steps: ["reject"], expect: { status: "stopped", outcome: "exception", events: ["Campaign rejected"], records: { campaign: "Rejected" }, check: (r) => assert.equal(r.outbox.length, 0) } },
  { name: "filled allocation stops new messages", scenario: "cancel_after_fill", steps: ["approve", "book2", "next_day"], expect: { events: ["Allocation filled", "No batch sent"], check: (r) => { assert.equal(emails(r), 1); assert.ok(!r.actions.some((a: any) => a.id.startsWith("book"))); } } },
  { name: "cancellation does not restart campaign without its rule", scenario: "cancel_after_fill", steps: ["approve", "book2", "cancel", "next_day"], expect: { events: ["Campaign not restarted", "No batch sent"], noEvents: ["reopened"], check: (r) => assert.equal(emails(r), 1) } },
  { name: "configured restart rule reopens outreach after cancellation", scenario: "restart_rule", steps: ["approve", "book2", "cancel", "next_day"], expect: { events: ["campaign reopened", "Batch 2 queued"], check: (r) => assert.equal(emails(r), 2) } },
  { name: "offer window closes after bounded days", scenario: "fill_midweek", steps: ["approve", "next_day", "next_day", "next_day"], expect: { status: "completed", outcome: "exception", events: ["Campaign closed: 0 offer nights"], check: (r) => assert.equal(emails(r), 3) } },
];
