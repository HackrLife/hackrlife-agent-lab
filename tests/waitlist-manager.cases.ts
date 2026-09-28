import assert from "node:assert/strict";
import type { PathCase } from "./harness";

const bookings = (r: any) => r.outbox.filter((o: any) => o.channel === "calendar").length;

export const cases: PathCase[] = [
  {
    name: "wrong-duration customer is excluded and matches are ranked with reasons",
    scenario: "first_accepts",
    steps: [],
    expect: {
      status: "waiting_customer",
      events: ["Jack Nguyen: excluded", "Priya Shah: eligible", "Ellie Brooks: eligible", "2 eligible, ranked", "Offer OFR-"],
      records: { matches: "2 of 3 eligible" },
      check: (r) => {
        const m = r.records.find((x) => x.id === "matches")!;
        assert.ok(m.fields.some((f) => f.label.includes("Jack") && f.value.includes("Needs 90 min")));
        assert.equal(r.outbox.filter((o) => o.summary.startsWith("Offer ")).length, 1);
      },
    },
  },
  {
    name: "first match accepts → one booking, remaining offers stopped",
    scenario: "first_accepts",
    steps: ["accept"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["Atomic slot claim won by Priya", "Booked Priya Shah", "Remaining offers stopped"],
      records: { slot: "Refilled", booking: "Booked", offers: "Filled" },
      check: (r) => {
        assert.equal(bookings(r), 1);
        assert.ok(r.events.find((e) => e.label === "Remaining offers stopped")!.detail!.includes("Ellie Brooks not contacted"));
      },
    },
  },
  {
    name: "expiry releases the hold and offers the next customer",
    scenario: "expiry_next",
    steps: ["expire"],
    expect: {
      status: "waiting_customer",
      events: ["Hold expired at 09:30 — released", "Offer to Priya Shah expired — next customer", "Temporary hold for Ellie"],
      check: (r) => {
        assert.equal(r.clock, 30);
        const o = r.records.find((x) => x.id === "offers")!;
        assert.ok(o.fields.some((f) => f.value.startsWith("Expired — hold released")));
        assert.ok(r.actions.some((a) => a.id === "race"));
      },
    },
  },
  {
    name: "after expiry the next customer accepts",
    scenario: "expiry_next",
    steps: ["expire", "accept"],
    expect: { status: "completed", outcome: "success", events: ["Booked Ellie Brooks"], check: (r) => assert.equal(bookings(r), 1) },
  },
  {
    name: "defect fix: expired-offer reply arriving first does not beat the live hold",
    scenario: "two_accept",
    steps: ["expire", "race"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["Two acceptances arrived within seconds", "expired at 09:20 — reply rejected", "Priya told courteously the offer has expired", "Atomic slot claim won by Ellie", "Booked Ellie Brooks"],
      noEvents: ["Atomic slot claim won by Priya", "Booked Priya"],
      check: (r) => {
        assert.equal(bookings(r), 1);
        assert.equal(r.outbox.filter((o) => o.summary.startsWith("Courteous unavailable") && o.summary.includes("expired")).length, 1);
        assert.equal(r.outbox.filter((o) => o.summary.startsWith("Booking confirmation")).length, 1);
      },
    },
  },
  {
    name: "race with live reply first: still one booking, expired reply rejected",
    scenario: "expiry_next",
    steps: ["expire", "race"],
    expect: { events: ["Atomic slot claim won by Ellie", "reply rejected"], records: { booking: "Booked" }, check: (r) => assert.equal(bookings(r), 1) },
  },
  {
    name: "two simultaneous valid acceptances → exactly one booking via atomic claim",
    scenario: "first_accepts",
    steps: ["accept_twice"],
    expect: {
      status: "completed",
      events: ["Atomic slot claim won by Priya", "Duplicate slot claim ignored", "not booked again"],
      check: (r) => {
        assert.equal(bookings(r), 1);
        assert.equal(r.outbox.filter((o) => o.summary.startsWith("Booking confirmation")).length, 1);
      },
    },
  },
  {
    name: "late reply alone is rejected; live offer continues",
    scenario: "expiry_next",
    steps: ["expire", "late_reply", "accept"],
    expect: { status: "completed", events: ["reply rejected", "Booked Ellie Brooks"], check: (r) => assert.equal(bookings(r), 1) },
  },
  {
    name: "every offer expires → handed to staff, no hold left",
    scenario: "expiry_next",
    steps: ["expire", "expire"],
    expect: { status: "stopped", outcome: "exception", events: ["Waitlist exhausted"], records: { slot: "handed to staff" }, check: (r) => assert.equal(bookings(r), 0) },
  },
  {
    name: "90-minute slot: only the matching customer is offered",
    scenario: "large_dog",
    steps: ["accept"],
    expect: { status: "completed", outcome: "success", events: ["Priya Shah: excluded", "Booked Jack Nguyen"], records: { matches: "1 of 3" } },
  },
  {
    name: "no eligible match stops before any offer",
    scenario: "no_match",
    steps: [],
    expect: { status: "stopped", events: ["No eligible match"], check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "sms").length, 0) },
  },
  {
    name: "decline releases the hold and moves on",
    scenario: "first_accepts",
    steps: ["decline", "accept"],
    expect: { events: ["Hold OFR-", "released on decline", "Booked Ellie Brooks"] },
  },
  {
    name: "repeated cancellation event is deduplicated",
    scenario: "first_accepts",
    steps: ["dup_cancel"],
    expect: { status: "waiting_customer", events: ["Duplicate cancellation event ignored"], check: (r) => assert.equal(r.outbox.filter((o) => o.summary.startsWith("Offer ")).length, 1) },
  },
];
