import assert from "node:assert/strict";
import type { PathCase } from "./harness";

export const cases: PathCase[] = [
  {
    name: "routine request books exactly one slot",
    scenario: "routine",
    steps: ["give_address", "accept_slot", "confirm_booking", "retry_booking", "end_call"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["Explicit confirmation received", "Calendar write verified", "Duplicate booking ignored"],
      records: { booking: "Confirmed", intake: "Booked" },
      check: (r) => {
        assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 1);
        assert.match(r.records.find((x) => x.id === "booking")!.ref!, /^BK-\d{4}$/);
      },
    },
  },
  {
    name: "calendar unchanged until explicit confirmation",
    scenario: "routine",
    steps: ["give_address", "accept_slot"],
    expect: {
      status: "waiting_customer",
      events: ["Details read back"],
      noEvents: ["Calendar write verified", "Explicit confirmation"],
      check: (r) => {
        assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 0);
        assert.ok(!r.records.find((x) => x.id === "booking"));
      },
    },
  },
  {
    name: "outside area → referral, not a booking",
    scenario: "outside_area",
    steps: ["give_address"],
    expect: {
      status: "stopped",
      outcome: "exception",
      events: ["outside service area", "referral"],
      records: { referral: "no booking" },
      check: (r) => {
        assert.ok(!r.records.find((x) => x.id === "booking"));
        assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 0);
      },
    },
  },
  {
    name: "no availability → try another day → booked",
    scenario: "no_availability",
    steps: ["give_address", "next_day", "accept_slot", "confirm_booking", "end_call"],
    expect: { outcome: "success", events: ["No free slot on Thursday", "Trying another day", "Offered Friday"], records: { booking: "Confirmed" } },
  },
  {
    name: "no suitable day → call-back, loop stops",
    scenario: "no_availability",
    steps: ["give_address", "no_day"],
    expect: { status: "stopped", outcome: "exception", events: ["call-back requested"], check: (r) => assert.ok(!r.records.find((x) => x.id === "booking")) },
  },
  {
    name: "calendar outage → pending handoff, never success",
    scenario: "calendar_outage",
    steps: ["give_address", "accept_slot", "confirm_booking", "retry_write"],
    expect: {
      status: "stopped",
      outcome: "exception",
      events: ["Calendar write not verified", "Pending handoff"],
      noEvents: ["Calendar write verified", "Booking BK"],
      records: { booking: "Pending" },
      check: (r) => {
        assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 1);
        assert.ok(!r.outbox.some((o) => o.channel === "sms" && o.summary.startsWith("Confirmation")));
      },
    },
  },
  {
    name: "urgent job handed to staff",
    scenario: "urgent",
    steps: [],
    expect: { status: "stopped", outcome: "exception", events: ["Urgent — handed to staff"], check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "task").length, 1) },
  },
  {
    name: "free text: address, day change, yes",
    scenario: "no_availability",
    steps: ["free:It's 22 Crown Street, Redfern", "free:How about Tuesday?", "free:yes that works", "free:yes please book it", "free:thanks, bye"],
    expect: { outcome: "success", events: ["Offered Tuesday 8:00 am", "Calendar write verified"] },
  },
  {
    name: "ambiguous answers → staff handoff",
    scenario: "routine",
    steps: ["free:hmm", "free:not sure", "free:what?"],
    expect: { status: "stopped", outcome: "exception", events: ["Ambiguous request — handed to staff"] },
  },
  {
    name: "negative reply to offered slot is not accepted",
    scenario: "routine",
    steps: ["give_address", "free:no, that's not fine"],
    expect: { status: "waiting_customer", noEvents: ["Details read back"], events: ["Offered Tuesday 1:30 pm"] },
  },
  {
    name: "\"no\" at read-back writes nothing",
    scenario: "routine",
    steps: ["give_address", "accept_slot", "free:no, don't book that"],
    expect: { status: "waiting_customer", events: ["No confirmation — nothing written"], check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 0) },
  },
  {
    name: "cancel request after booking → staff handoff, never success",
    scenario: "routine",
    steps: ["give_address", "accept_slot", "confirm_booking", "free:actually please cancel the booking"],
    expect: { status: "stopped", outcome: "exception", events: ["Change or cancellation request — handed to staff"], records: { booking: "Change requested" } },
  },
  {
    name: "negated cancel after booking does not cancel",
    scenario: "routine",
    steps: ["give_address", "accept_slot", "confirm_booking", "free:please don't cancel, just bring a ladder", "free:no worries, thanks"],
    expect: { status: "completed", outcome: "success", noEvents: ["cancellation request"] },
  },
  {
    name: "confirmation copy never claims a sent text",
    scenario: "routine",
    steps: ["give_address", "accept_slot", "confirm_booking"],
    expect: { check: (r) => assert.ok(!r.messages.some((m) => /texted you|i've texted|emailed you|\ba A\$/i.test(m.text))) },
  },
];
