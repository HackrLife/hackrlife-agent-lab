import assert from "node:assert/strict";
import type { PathCase } from "./harness";

const field = (r: any, rec: string, label: string) => r.records.find((x: any) => x.id === rec)!.fields.find((f: any) => f.label === label)!.value as string;

export const cases: PathCase[] = [
  {
    name: "next grooming visit: confirmed once, reminded, earned only on completion",
    scenario: "groomer_next",
    steps: ["accept", "confirm", "advance"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["Every date checked", "saved as BK-", "Reminder sent", "Visit 1 completed"],
      records: { schedule: "Saved", reminders: "All sent", revenue: "1 completed visit" },
      check: (r) => {
        assert.equal(field(r, "revenue", "Earned (completed visits only)"), "A$95");
        assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 1);
      },
    },
  },
  {
    name: "fortnightly schedule: whole series shown, saved once, future bookings not earned",
    scenario: "cleaner_recurring",
    steps: ["accept", "confirm"],
    expect: {
      status: "waiting_customer",
      events: ["Whole series shown (6 visits)", "confirmed the whole series", "Unique schedule key", "6 appointments saved"],
      records: { schedule: "Saved", reminders: "Active — 6 scheduled", revenue: "No visit completed" },
      check: (r) => {
        assert.equal(field(r, "revenue", "Earned (completed visits only)"), "A$0");
        assert.ok(field(r, "revenue", "Booked future visits").includes("not counted as earned"));
      },
    },
  },
  {
    name: "nothing saved before confirmation",
    scenario: "cleaner_recurring",
    steps: ["accept"],
    expect: { status: "waiting_customer", records: { schedule: "awaiting customer confirmation" }, noEvents: ["saved as"], check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 0) },
  },
  {
    name: "recurring plan with one conflict proposes alternatives",
    scenario: "recurring_conflict",
    steps: ["accept"],
    expect: {
      status: "waiting_customer",
      events: ["Clash: Mon 2 Nov", "1 date clash — alternatives proposed"],
      records: { schedule: "1 date unavailable" },
      noEvents: ["saved as"],
      check: (r) => assert.ok(r.actions.some((a) => a.id === "use_alts") && r.actions.some((a) => a.id === "skip_clash")),
    },
  },
  {
    name: "accepted alternative is re-checked and listed as moved",
    scenario: "recurring_conflict",
    steps: ["accept", "use_alts", "confirm"],
    expect: {
      status: "waiting_customer",
      events: ["Alternatives accepted", "Every date checked (6 of 6 free)", "saved as SCH-"],
      records: { schedule: "Saved" },
      check: (r) => assert.ok(field(r, "schedule", "Visit 2").includes("moved from Mon 2 Nov")),
    },
  },
  {
    name: "skipped clash is listed as an exception",
    scenario: "recurring_conflict",
    steps: ["accept", "skip_clash", "confirm"],
    expect: { events: ["5 appointments saved"], check: (r) => assert.ok(field(r, "schedule", "Visit 2").includes("skipped")) },
  },
  {
    name: "changing the interval regenerates and re-checks dates",
    scenario: "recurring_conflict",
    steps: ["accept", "change_longer"],
    expect: { status: "waiting_customer", events: ["Interval changed to every 3 weeks", "Every date checked"], records: { schedule: "Proposed" } },
  },
  {
    name: "existing next appointment suppresses the invitation",
    scenario: "already_booked",
    steps: [],
    expect: {
      status: "stopped",
      outcome: "exception",
      events: ["Existing booking BK-3107", "Invitation suppressed"],
      records: { schedule: "Already booked" },
      check: (r) => {
        assert.equal(r.outbox.filter((o) => o.status === "held").length, 0);
        assert.equal(r.outbox.filter((o) => o.status === "suppressed").length, 1);
      },
    },
  },
  {
    name: "cancelling the series stops future reminders",
    scenario: "cleaner_recurring",
    steps: ["accept", "confirm", "advance", "cancel_series"],
    expect: {
      status: "stopped",
      outcome: "stopped",
      events: ["Series cancelled — 5 future reminders cancelled"],
      records: { schedule: "Cancelled", reminders: "Stopped" },
      check: (r) => {
        assert.equal(r.outbox.filter((o) => o.summary.startsWith("Reminder:")).length, 1);
        assert.equal(field(r, "revenue", "Earned (completed visits only)"), "A$160");
        assert.ok(r.outbox.some((o) => o.channel === "calendar" && o.summary.startsWith("Release 5")));
      },
    },
  },
  {
    name: "replayed confirmation does not duplicate the booking",
    scenario: "groomer_next",
    steps: ["accept", "confirm", "replay_save"],
    expect: { events: ["Duplicate schedule save ignored"], check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 1) },
  },
  {
    name: "provider mismatch asks the customer instead of reassigning",
    scenario: "provider_mismatch",
    steps: ["any_provider", "accept", "confirm"],
    expect: { events: ["Ana does not offer dog grooming", "Mia assigned with the customer’s agreement", "saved as BK-"], records: { schedule: "Saved" } },
  },
  {
    name: "switching mode is an explicit customer choice",
    scenario: "groomer_next",
    steps: ["switch_mode"],
    expect: { events: ["Customer chose recurring schedule instead", "Whole series shown"] },
  },
  {
    name: "decline saves nothing",
    scenario: "cleaner_recurring",
    steps: ["accept", "decline"],
    expect: { status: "stopped", events: ["nothing saved"], records: { schedule: "Not saved" }, check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 0) },
  },
];
