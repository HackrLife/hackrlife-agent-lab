import assert from "node:assert/strict";
import type { PathCase } from "./harness";

const cal = (r: any) => r.outbox.filter((o: any) => o.channel === "calendar");
const waitlist = (r: any) => r.outbox.filter((o: any) => o.to === "Waitlist Manager workflow");

export const cases: PathCase[] = [
  {
    name: "confirmed after a verified calendar write",
    scenario: "confirmed",
    steps: ["reply_confirm"],
    expect: { status: "completed", outcome: "success", events: ["BK-2046 active", "Reply classified: confirmed", "Calendar read-back: BK-2046 confirmed"], records: { booking: "Confirmed" } },
  },
  {
    name: "reschedule secures the replacement before releasing the original",
    scenario: "reschedule",
    steps: ["reply_move", "pick_0"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["Replacement secured — original still booked", "Replacement BK-", "Original BK-2046 released after the replacement was verified", "passed to the waitlist"],
      records: { booking: "Released — moved to", new_booking: "verified" },
      check: (r) => {
        const labels = r.events.map((e) => e.label);
        const verified = labels.findIndex((l) => l.startsWith("Replacement BK-"));
        const released = labels.findIndex((l) => l.startsWith("Original BK-2046 released"));
        assert.ok(verified >= 0 && released > verified, "replacement must be verified before release");
        assert.equal(waitlist(r).length, 1);
      },
    },
  },
  {
    name: "replacement slot taken → original preserved, another slot offered",
    scenario: "replacement_fails",
    steps: ["reply_move", "pick_0"],
    expect: {
      status: "waiting_customer",
      events: ["was just taken", "Replacement failed — original booking kept"],
      records: { booking: "original kept" },
      check: (r) => {
        assert.equal(cal(r).length, 0);
        assert.ok(!r.actions.some((a) => a.id === "pick_0"));
      },
    },
  },
  {
    name: "after a failed replacement a different slot succeeds",
    scenario: "replacement_fails",
    steps: ["reply_move", "pick_0", "pick_1"],
    expect: { status: "completed", outcome: "success", records: { new_booking: "verified" }, check: (r) => assert.ok(r.records.find((x) => x.id === "new_booking")!.fields[0].value.startsWith("Thu 15 Oct")) },
  },
  {
    name: "calendar write fails → original preserved, nothing confirmed",
    scenario: "write_fails",
    steps: ["reply_move", "pick_0"],
    expect: {
      status: "waiting_staff",
      events: ["Calendar write failed", "No verified replacement booking", "Replacement failed — original booking kept"],
      noEvents: ["released after"],
      records: { booking: "original kept" },
      check: (r) => {
        assert.equal(cal(r).filter((o: any) => o.status === "simulated").length, 0);
        assert.equal(cal(r).filter((o: any) => o.status === "failed").length, 1);
        assert.ok(!r.records.some((x) => x.id === "new_booking"));
      },
    },
  },
  {
    name: "retry after write failure books once",
    scenario: "write_fails",
    steps: ["reply_move", "pick_0", "retry_write"],
    expect: { status: "completed", outcome: "success", check: (r) => assert.equal(cal(r).filter((o: any) => o.status === "simulated" && o.summary.startsWith("Create")).length, 1) },
  },
  {
    name: "cancel outside window → cancellation event passed to waitlist, no fee",
    scenario: "cancel",
    steps: ["reply_cancel"],
    expect: {
      status: "completed",
      events: ["Outside the 24 h window", "BK-2046 cancelled in the calendar", "Cancellation event passed to the waitlist workflow"],
      records: { booking: "Cancelled — slot passed to waitlist" },
      check: (r) => {
        assert.equal(waitlist(r).length, 1);
        assert.ok(!r.outbox.some((o) => o.channel === "payment"));
        assert.ok(r.records.find((x) => x.id === "booking")!.fields.some((f) => f.label === "Cancellation fee" && f.value.startsWith("None")));
      },
    },
  },
  {
    name: "late request routes to policy review",
    scenario: "late_cancel",
    steps: ["reply_cancel"],
    expect: {
      status: "waiting_staff",
      events: ["Inside the 24 h late-cancellation window", "Late request routed to policy review"],
      noEvents: ["cancelled in the calendar"],
      records: { booking: "late request under review" },
      check: (r) => assert.equal(cal(r).length, 0),
    },
  },
  {
    name: "late cancellation approved by staff, no fee",
    scenario: "late_cancel",
    steps: ["reply_cancel", "staff_approve"],
    expect: { status: "completed", events: ["Staff approved", "passed to the waitlist"], check: (r) => assert.ok(!r.outbox.some((o) => o.channel === "payment")) },
  },
  {
    name: "late cancellation kept by staff",
    scenario: "late_cancel",
    steps: ["reply_cancel", "staff_keep"],
    expect: { status: "stopped", records: { booking: "kept after policy review" }, check: (r) => assert.equal(cal(r).length, 0) },
  },
  {
    name: "late reschedule also goes to review",
    scenario: "late_cancel",
    steps: ["reply_move", "pick_2"],
    expect: { status: "waiting_staff", events: ["Late request routed to policy review"] },
  },
  {
    name: "silence never cancels — bounded reminders then booking kept",
    scenario: "no_reply",
    steps: ["no_reply", "no_reply", "no_reply"],
    expect: {
      status: "stopped",
      outcome: "exception",
      events: ["limited reminder 2 of 3", "limited reminder 3 of 3", "No reply after 3 messages", "silence never cancels"],
      records: { booking: "unconfirmed, kept" },
      check: (r) => {
        assert.equal(r.outbox.filter((o) => o.channel === "sms").length, 3);
        assert.equal(cal(r).length, 0);
        assert.equal(waitlist(r).length, 0);
      },
    },
  },
  {
    name: "free-text reply is classified; unclear asks",
    scenario: "confirmed",
    steps: ["free:hmm what?", "free:Could we do next Tuesday instead?"],
    expect: { status: "waiting_customer", events: ["clarifying question", "Reply classified: reschedule"] },
  },
  {
    name: "defect fix: “Please don't cancel, I'll be there” confirms, never cancels",
    scenario: "confirmed",
    steps: ["free:Please don't cancel, I'll be there"],
    expect: { status: "completed", outcome: "success", records: { booking: "Confirmed" }, noEvents: ["cancel"], check: (r) => assert.equal(waitlist(r).length, 0) },
  },
  {
    name: "defect fix: “See you Thursday!” confirms — a weekday alone is not a move",
    scenario: "confirmed",
    steps: ["free:See you Thursday!"],
    expect: { status: "completed", outcome: "success", records: { booking: "Confirmed" }, noEvents: ["reschedule"] },
  },
  {
    name: "defect fix: “Yes, but could I move it to next Tuesday?” is a move, not a confirmation",
    scenario: "confirmed",
    steps: ["free:Yes, but could I move it to next Tuesday?"],
    expect: { status: "waiting_customer", events: ["Reply classified: reschedule"], noEvents: ["confirmed"], records: { booking: "awaiting confirmation" } },
  },
  {
    name: "negated move and cancel never act; mixed request is clarified",
    scenario: "confirmed",
    steps: ["free:I don't want to move it", "free:cancel or move, not sure"],
    expect: { status: "waiting_customer", events: ["clarifying", "both moving and cancelling"], noEvents: ["Reply classified"] },
  },
];
