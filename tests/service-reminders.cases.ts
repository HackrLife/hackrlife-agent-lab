import assert from "node:assert/strict";
import type { PathCase } from "./harness";

const dueField = (r: any, label: string) => r.records.find((x: any) => x.id === "due")?.fields.find((f: any) => f.label === label)?.value as string;

export const cases: PathCase[] = [
  {
    name: "due by date with unknown mileage: reminder proceeds, mileage stays unknown",
    scenario: "mileage_missing",
    steps: [],
    expect: {
      status: "waiting_customer",
      events: ["Mileage unknown — not estimated", "due by date", "Reminder 1 of 2 queued"],
      records: { due: "Due by date (mileage unknown)" },
      check: (r) => { assert.match(dueField(r, "Mileage rule"), /Unknown — not estimated/); assert.match(dueField(r, "Date rule"), /12 of 12 months → due/); },
    },
  },
  {
    name: "customer supplies mileage → due state changes → booked → cycle resets",
    scenario: "mileage_missing",
    steps: ["mileage_high", "slot_0", "complete"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["Mileage supplied: 99,800 km — recalculating", "Booked", "Completion resets the cycle once"],
      records: { due: "Due by date and mileage", booking: "Completed", reminder: "Reset — cycle 2" },
      check: (r) => assert.match(dueField(r, "Mileage rule"), /15,600 km of 15,000 km → overdue/),
    },
  },
  {
    name: "typed mileage is parsed; implausible reading rejected, not guessed",
    scenario: "mileage_missing",
    steps: ["free:2000", "free:it's on 97,500 km"],
    expect: { status: "waiting_customer", events: ["Reading rejected", "Mileage supplied: 97,500 km"], check: (r) => assert.match(dueField(r, "Mileage rule"), /13,300 km of 15,000 km → not due/) },
  },
  {
    name: "due by mileage only (8 months, 15,400 km)",
    scenario: "due_by_mileage",
    steps: ["free:Friday please"],
    expect: { status: "waiting_staff", records: { due: "Due by mileage", booking: "Confirmed", reminder: "paused" } },
  },
  {
    name: "future booking suppresses contact",
    scenario: "already_booked",
    steps: [],
    expect: { status: "stopped", events: ["Future service already booked — contact suppressed"], noEvents: ["Reminder 1"], records: { reminder: "Paused" }, check: (r) => { assert.equal(r.outbox.filter((o) => o.status === "held").length, 0); assert.equal(r.outbox[0].status, "suppressed"); } },
  },
  {
    name: "not due → next check; stale reading becomes unknown, date reminder proceeds",
    scenario: "not_due",
    steps: ["advance_check"],
    expect: { status: "waiting_customer", events: ["Not due — next check in 6 months", "Next check reached"], records: { due: "Due by date (mileage unknown)" }, check: (r) => assert.match(dueField(r, "Mileage rule"), /treated as unknown, not extrapolated/) },
  },
  {
    name: "mileage-only rule with unknown mileage: no date-based reminder, mileage requested",
    scenario: "mileage_only",
    steps: [],
    expect: { status: "waiting_customer", events: ["Asked for current odometer reading"], noEvents: ["Reminder 1"], records: { due: "Not due by date; mileage unknown" }, check: (r) => assert.match(dueField(r, "Reminder basis"), /Not permitted/) },
  },
  {
    name: "new mileage changes the due state (mileage-only rule → due)",
    scenario: "mileage_only",
    steps: ["mileage_high"],
    expect: { status: "waiting_customer", records: { due: "Due by mileage" }, check: (r) => assert.ok(r.actions.some((a) => a.id === "slot_0")) },
  },
  {
    name: "new mileage below the window → not due",
    scenario: "mileage_only",
    steps: ["mileage_low"],
    expect: { status: "running", events: ["Not due — next check"], records: { due: "Not due" } },
  },
  {
    name: "completion replayed resets the cycle exactly once",
    scenario: "due_by_mileage",
    steps: ["slot_0", "complete_twice"],
    expect: {
      outcome: "success",
      events: ["Duplicate completion event ignored"],
      records: { reminder: "cycle 2" },
      check: (r) => { assert.equal(r.events.filter((e) => e.label === "Completion resets the cycle once").length, 1); assert.equal(r.outbox.filter((o) => o.channel === "crm").length, 1); },
    },
  },
  {
    name: "reminder contact limit stops at two",
    scenario: "mileage_missing",
    steps: ["no_reply", "no_reply"],
    expect: { status: "stopped", events: ["Contact limit reached (2 of 2)"], check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "sms").length, 2) },
  },
];
