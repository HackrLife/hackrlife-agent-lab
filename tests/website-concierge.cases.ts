import assert from "node:assert/strict";
import type { PathCase } from "./harness";

export const cases: PathCase[] = [
  {
    name: "Friday clean booked once after recheck",
    scenario: "friday_clean",
    steps: ["share_contact", "pick_0", "confirm", "double_confirm", "finish"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["Scheduler returned booked status", "Duplicate booking ignored"],
      records: { booking: "Booking confirmed", lead: "Booked" },
      check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 1),
    },
  },
  {
    name: "enquiry is not presented as an appointment before confirmation",
    scenario: "friday_clean",
    steps: ["share_contact", "pick_0"],
    expect: { status: "waiting_customer", records: { lead: "not booked" }, noEvents: ["Booking BK"], check: (r) => assert.ok(!r.records.find((x) => x.id === "booking")) },
  },
  {
    name: "known FAQ has an approved answer",
    scenario: "fully_booked",
    steps: [],
    expect: { status: "waiting_customer", events: ["Answered from approved FAQ: Supplies", "Approved source found"] },
  },
  {
    name: "free-text FAQ question answered, then booking continues",
    scenario: "friday_clean",
    steps: ["free:Do you bring your own supplies?", "free:Is the bond-back re-clean included?", "share_contact", "free:Friday 12:30 please", "free:yes book it", "free:thanks"],
    expect: { outcome: "success", events: ["Answered from approved FAQ: Bond-back re-clean", "Visitor selected Friday 12:30 pm"] },
  },
  {
    name: "unknown refund policy escalates, never answered",
    scenario: "unknown_policy",
    steps: ["wait_owner"],
    expect: {
      status: "completed",
      outcome: "exception",
      events: ["No approved source", "Unknown answer — escalated to owner"],
      records: { escalation: "no answer given", callback: "not an appointment" },
      check: (r) => assert.ok(!r.records.find((x) => x.id === "booking")),
    },
  },
  {
    name: "free-text refund question escalates mid-booking",
    scenario: "friday_clean",
    steps: ["share_contact", "free:Can I get my money back if I'm unhappy?"],
    expect: { status: "waiting_customer", events: ["Unknown answer — escalated"], records: { escalation: "Waiting for owner" } },
  },
  {
    name: "fully booked day offers alternatives",
    scenario: "fully_booked",
    steps: ["check_avail", "share_contact", "pick_0", "confirm", "finish"],
    expect: { outcome: "success", events: ["Saturday is fully booked"], records: { booking: "confirmed" } },
  },
  {
    name: "slot removed before confirmation forces re-selection without duplicate",
    scenario: "slot_taken",
    steps: ["share_contact", "pick_0", "confirm", "pick_0", "confirm", "finish"],
    expect: {
      outcome: "success",
      events: ["was taken by another booking", "Slot no longer free"],
      check: (r) => {
        assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 1);
        assert.equal(r.outbox.filter((o) => o.channel === "crm").length, 1);
        assert.ok(r.records.find((x) => x.id === "booking")!.fields.some((f) => f.value === "Friday 12:30 pm"));
      },
    },
  },
  {
    name: "incomplete brief is clarified before an enquiry exists",
    scenario: "incomplete",
    steps: ["share_postcode", "free:3006", "share_contact", "free:Leo Walsh, leo@walsh.example"],
    expect: { status: "waiting_customer", events: ["Brief incomplete: postcode", "Postcode 3006 recorded", "Name and email validated"], records: { lead: "Qualified enquiry" } },
  },
  {
    name: "visitor leaves: enquiry saved, not booked",
    scenario: "friday_clean",
    steps: ["share_contact", "leave"],
    expect: { status: "stopped", records: { lead: "not booked" } },
  },
];
