import assert from "node:assert/strict";
import type { PathCase } from "./harness";
import { eventSalesAssistant } from "../src/lib/catalogue/products/event-sales-assistant";

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

/* Review defect: scope below the minimum order must not be reported as a budget problem. */

function runEdited(overrides: Record<string, string | number | boolean>) {
  const sc = eventSalesAssistant.demo.scenarios.find((x) => x.id === "wedding")!;
  return eventSalesAssistant.demo.start({ ...sc.inputs, ...overrides }, "wedding");
}

cases.push(
  {
    name: "edited wedding: bridal party only is below minimum order, not budget",
    scenario: "wedding",
    steps: [],
    expect: {
      check: () => {
        const r = runEdited({ scope: "Bridal party only", budget: 3000 });
        const labels = r.events.map((e) => e.label).join(" | ");
        assert.ok(/below the A\$1,200 minimum order/.test(labels), labels);
        assert.ok(!/Budget A\$3,000 is below/.test(labels), labels);
        assert.ok(r.records.find((x) => x.id === "opp")!.status.includes("Scope below minimum order"));
        const last = r.messages.filter((m) => m.from === "assistant").at(-1)!.text;
        assert.ok(last.includes("minimum order") && !last.includes("can’t offer an event package within"), last);
        assert.equal(r.status, "waiting_customer");
        assert.ok(r.actions.some((a) => a.id === "take_option"));
      },
    },
  },
  {
    name: "edited: scope below minimum and no larger scope fits → scope-reason decline",
    scenario: "wedding",
    steps: [],
    expect: {
      check: () => {
        const r = runEdited({ scope: "Bridal party only", budget: 500 });
        assert.equal(r.status, "stopped");
        assert.ok(r.records.find((x) => x.id === "opp")!.status.includes("scope below minimum order"));
        assert.ok(r.outcome!.summary.includes("minimum event order"));
        assert.ok(!r.events.some((e) => /Budget A\$500 is below/.test(e.label)));
      },
    },
  },
  {
    name: "free text: negated package name does not choose it",
    scenario: "wedding",
    steps: ["free:not classic, what else is there?"],
    expect: { status: "waiting_customer", noEvents: ["Customer chose"] },
  },
  {
    name: "free text: 'No worries, Classic please' chooses Classic",
    scenario: "wedding",
    steps: ["free:No worries, Classic please"],
    expect: { status: "waiting_staff", events: ["Customer chose Classic"] },
  },
);
