import assert from "node:assert/strict";
import type { PathCase } from "./harness";

export const cases: PathCase[] = [
  {
    name: "wedding: change → v2 approved → deposit-paid booking",
    scenario: "wedding",
    steps: ["choose_classic", "approve", "change_guests", "approve", "pay_current"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["invalidated", "Owner approved proposal v2", "verified against current proposal v2", "Booking"],
      records: { booking: "Confirmed", proposal: "v2 accepted", opp: "Won" },
      check: (r) => {
        assert.ok(r.records.find((x) => x.id === "proposal")!.ref!.endsWith("v2"));
        assert.equal(r.outbox.filter((o) => o.channel === "payment" && o.status === "simulated").length, 1);
      },
    },
  },
  {
    name: "scope change invalidates old total; paying v1 is rejected",
    scenario: "wedding",
    steps: ["choose_classic", "approve", "change_guests", "pay_old"],
    expect: {
      status: "waiting_staff",
      events: ["v1 total", "Payment rejected"],
      records: { proposal: "v2 draft" },
      check: (r) => {
        assert.ok(!r.records.some((x) => x.id === "booking"));
        assert.ok(!r.actions.some((a) => a.id === "pay_current"));
        assert.equal(r.outbox.filter((o) => o.channel === "payment" && o.status === "simulated").length, 0);
      },
    },
  },
  {
    name: "no payment link before owner approval",
    scenario: "wedding",
    steps: ["choose_essential"],
    expect: {
      status: "waiting_staff",
      records: { proposal: "awaiting owner approval" },
      check: (r) => {
        assert.ok(!r.actions.some((a) => a.id === "pay_current"));
        assert.equal(r.outbox.filter((o) => o.channel === "email").length, 0);
      },
    },
  },
  {
    name: "date clash prevents commitment",
    scenario: "date_clash",
    steps: [],
    expect: {
      status: "waiting_customer",
      events: ["Date clash"],
      noEvents: ["Date hold placed", "Proposal v1"],
      check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 0),
    },
  },
  { name: "date clash: fixed date → stopped", scenario: "date_clash", steps: ["date_fixed"], expect: { status: "stopped", outcome: "exception", records: { opp: "date unavailable" } } },
  { name: "date clash: move date → rechecked and bookable", scenario: "date_clash", steps: ["move_date", "choose_classic", "approve", "pay_current"], expect: { outcome: "success", events: ["Date revised", "Date available"] } },
  {
    name: "budget below brief → suitable option offered and booked",
    scenario: "tight_budget",
    steps: ["take_option", "approve", "pay_current"],
    expect: { outcome: "success", events: ["Suitable option offered"], check: (r) => assert.ok(r.records.find((x) => x.id === "booking")!.fields.some((f) => f.value.includes("reception only"))) },
  },
  { name: "below minimum → polite decline", scenario: "below_minimum", steps: [], expect: { status: "stopped", outcome: "exception", events: ["No package meets"], records: { opp: "below event minimum" } } },
  {
    name: "no response: bounded follow-ups then hold expires",
    scenario: "no_response",
    steps: ["choose_classic", "approve", "wait", "wait", "wait"],
    expect: {
      status: "stopped",
      outcome: "exception",
      events: ["Date hold expired", "Follow-up 2 of 2"],
      records: { proposal: "expired" },
      check: (r) => assert.equal(r.outbox.filter((o) => o.summary.startsWith("Follow-up")).length, 2),
    },
  },
  { name: "unclear free text → clarifying question", scenario: "wedding", steps: ["free:Tuesday"], expect: { status: "waiting_customer", events: ["clarifying question"] } },
];
