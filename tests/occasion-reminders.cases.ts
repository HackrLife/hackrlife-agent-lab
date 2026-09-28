import assert from "node:assert/strict";
import type { PathCase } from "./harness";
import { occasionReminders } from "../src/lib/catalogue/products/occasion-reminders";

export const cases: PathCase[] = [
  {
    name: "anniversary: reminder → reorder → delivery → next reminder",
    scenario: "anniversary",
    steps: ["advance", "choose_garden_rose", "deliver"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["Reminder scheduled for Sun 11 Oct 2026", "Sample checkout", "next reminder Mon 11 Oct 2027"],
      records: { order: "Paid", reminder: "Next reminder Mon 11 Oct 2027" },
      check: (r) => {
        assert.equal(r.outbox.filter((o) => o.channel === "task" && o.summary.startsWith("Delivery request")).length, 1);
        assert.ok(r.clock >= 6 * 1440);
      },
    },
  },
  {
    name: "changed date reschedules the reminder",
    scenario: "date_changed",
    steps: ["advance", "update_date"],
    expect: {
      status: "running",
      events: ["Occasion date changed", "Reminder scheduled for Sun 18 Oct 2026"],
      records: { reminder: "Scheduled for Sun 18 Oct 2026", invitation: "Closed — date changed" },
    },
  },
  {
    name: "changed date: new reminder then order for the new date",
    scenario: "date_changed",
    steps: ["advance", "update_date", "advance", "choose_garden_rose", "collect"],
    expect: {
      outcome: "success",
      check: (r) => {
        assert.ok(r.records.find((x) => x.id === "order")!.fields.some((f) => f.value.includes("Sun 1 Nov 2026")));
        assert.equal(r.outbox.filter((o) => o.channel === "email" && o.summary.startsWith("Anniversary reminder")).length, 2);
      },
    },
  },
  {
    name: "existing occasion order suppresses the invitation",
    scenario: "already_ordered",
    steps: ["advance"],
    expect: {
      status: "stopped",
      outcome: "exception",
      events: ["invitation suppressed"],
      check: (r) => {
        assert.equal(r.outbox.filter((o) => o.channel === "email" && o.status === "held").length, 0);
        assert.equal(r.outbox.filter((o) => o.status === "suppressed").length, 1);
      },
    },
  },
  {
    name: "unavailable product offers alternatives",
    scenario: "sold_out",
    steps: ["advance"],
    expect: {
      status: "waiting_customer",
      events: ["Garden rose bouquet unavailable"],
      check: (r) => {
        const ids = r.actions.map((a) => a.id);
        assert.ok(!ids.includes("choose_garden_rose"));
        assert.ok(ids.includes("choose_native_bunch") && ids.includes("choose_peony_rose"));
      },
    },
  },
  {
    name: "passed cutoff blocks delivery; collection completes",
    scenario: "cutoff",
    steps: ["advance", "choose_garden_rose", "deliver", "collect"],
    expect: {
      outcome: "success",
      events: ["Delivery cutoff passed", "Alternative fulfilment chosen"],
      check: (r) => {
        assert.equal(r.outbox.filter((o) => o.summary.startsWith("Delivery request")).length, 0);
        assert.equal(r.outbox.filter((o) => o.summary.startsWith("Collection request")).length, 1);
      },
    },
  },
  {
    name: "opt-out deletes future reminder eligibility",
    scenario: "anniversary",
    steps: ["advance", "opt_out"],
    expect: {
      status: "stopped",
      outcome: "stopped",
      events: ["eligibility deleted"],
      records: { occasion: "Opted out", reminder: "Cancelled" },
    },
  },
  { name: "no opt-in → nothing scheduled", scenario: "not_opted_in", steps: [], expect: { status: "stopped", events: ["No explicit reminder permission"], check: (r) => assert.equal(r.outbox.length, 0) } },
  {
    name: "preference change reuses stated preference only",
    scenario: "anniversary",
    steps: ["advance", "change_budget"],
    expect: {
      status: "waiting_customer",
      events: ["Budget preference changed", "Preferences reused as stated"],
      noEvents: ["Duplicate"],
      check: (r) => assert.ok(r.actions.some((a) => a.id === "choose_luxe_rose")),
    },
  },
  { name: "no reply → lapses without chasing", scenario: "anniversary", steps: ["advance", "lapse"], expect: { status: "completed", outcome: "exception", events: ["invitation lapsed"], check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "email").length, 1) } },
];

/* Review defect: an in-stock item outside the stated budget band is not "unavailable". */
cases.push({
  name: "edited anniversary: Up to A$80 → previous bouquet is above budget, not unavailable",
  scenario: "anniversary",
  steps: [],
  expect: {
    check: () => {
      const sc = occasionReminders.demo.scenarios.find((x) => x.id === "anniversary")!;
      let r = occasionReminders.demo.start({ ...sc.inputs, budget_pref: "Up to A$80" }, "anniversary");
      r = occasionReminders.demo.act(r, "advance");
      const msg = r.messages.filter((m) => m.from === "assistant").at(-1)!.text;
      assert.ok(!/isn’t available/.test(msg), msg);
      assert.ok(/above the Up to A\$80 budget/.test(msg), msg);
      assert.ok(r.events.some((e) => /outside the stated Up to A\$80 budget/.test(e.label)));
      assert.ok(r.actions.some((a) => a.id === "choose_seasonal_posy"));
      assert.ok(!r.actions.some((a) => a.id === "choose_garden_rose"));
      const inv = r.records.find((x) => x.id === "invitation")!;
      assert.ok(inv.fields.some((f) => f.value.includes("in stock, above")));
    },
  },
});
