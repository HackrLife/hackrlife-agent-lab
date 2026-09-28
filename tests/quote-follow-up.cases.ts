import assert from "node:assert/strict";
import type { PathCase } from "./harness";

const sms = (r: any) => r.outbox.filter((o: any) => o.channel === "sms" && o.status === "held" && o.summary.startsWith("Follow-up"));

export const cases: PathCase[] = [
  {
    name: "acceptance stops reminders and sends a booking invitation",
    scenario: "accepted",
    steps: ["advance", "reply_accept"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["Classified: acceptance", "Reminders stopped on acceptance", "Booking invitation sent"],
      records: { quote: "Accepted v1", invite: "Sent", followups: "1 of 3" },
      check: (r) => {
        assert.equal(sms(r).length, 1);
        assert.ok(r.records.find((x: any) => x.id === "followups")!.fields.filter((f: any) => f.value.startsWith("Cancelled")).length === 2);
      },
    },
  },
  {
    name: "question answered from the quote, then accepted",
    scenario: "question",
    steps: ["advance", "reply_question", "reply_accept"],
    expect: { outcome: "success", events: ["Answer taken from quote v1", "Quote v1 accepted"] },
  },
  {
    name: "extra task needs owner approval; revised quote supersedes old",
    scenario: "revision",
    steps: ["advance", "reply_extra", "approve_scope", "accept_old", "reply_accept"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["No automatic price change", "Owner approved scope and price", "Revised quote v2 issued — v1 superseded", "v1 superseded by v2 — acceptance refused", "Quote v2 accepted"],
      records: { quote: "Accepted v2 — A$480", owner: "Approved" },
      check: (r) => assert.equal(r.records.find((x: any) => x.id === "quote")!.ref, "Q-2417-v2"),
    },
  },
  {
    name: "extra task alone never changes the price",
    scenario: "revision",
    steps: ["advance", "reply_extra"],
    expect: { status: "waiting_staff", records: { quote: "awaiting owner", owner: "Waiting" }, check: (r) => assert.ok(r.records.find((x: any) => x.id === "quote")!.fields.some((f: any) => f.label === "Price" && f.value === "A$420")) },
  },
  {
    name: "decline closes the sequence",
    scenario: "decline",
    steps: ["advance", "reply_decline"],
    expect: { status: "completed", outcome: "exception", events: ["Sequence closed", "Quote closed — declined"], records: { quote: "Declined" }, noEvents: ["Follow-up 3 of 3 sent"] },
  },
  {
    name: "message retry does not send the same follow-up twice",
    scenario: "silence",
    steps: ["advance", "retry_send", "retry_send"],
    expect: { status: "waiting_customer", events: ["Duplicate follow-up ignored"], check: (r) => assert.equal(sms(r).length, 1) },
  },
  {
    name: "silence: bounded follow-ups then owner call task",
    scenario: "silence",
    steps: ["advance", "advance", "advance", "advance"],
    expect: {
      status: "stopped",
      outcome: "exception",
      events: ["No reply after 3 follow-ups", "Contact limit reached"],
      check: (r) => {
        assert.equal(sms(r).length, 3);
        assert.equal(r.outbox.filter((o: any) => o.channel === "task").length, 1);
      },
    },
  },
  {
    name: "expired quote blocked until owner reissues",
    scenario: "expired",
    steps: [],
    expect: { status: "waiting_staff", events: ["expired on day 30"], noEvents: ["Follow-up 1 of 3 sent"], records: { quote: "Expired" } },
  },
  {
    name: "expired quote reissued as a new version, then accepted",
    scenario: "expired",
    steps: ["reissue", "reply_accept"],
    expect: { outcome: "success", events: ["Revised quote v2 issued"], records: { quote: "Accepted v2 — A$420" } },
  },
  {
    name: "free-text price request goes to the owner",
    scenario: "accepted",
    steps: ["advance", "free:Can you do it cheaper?", "keep_price", "free:yes please"],
    expect: { outcome: "success", events: ["Classified: price objection", "Owner kept v1 unchanged"], records: { quote: "Accepted v1 — A$420" } },
  },
  {
    name: "owner takeover stops automation",
    scenario: "revision",
    steps: ["advance", "reply_extra", "owner_call"],
    expect: { status: "stopped", outcome: "stopped", events: ["Automated follow-up stopped on human takeover"] },
  },
];
