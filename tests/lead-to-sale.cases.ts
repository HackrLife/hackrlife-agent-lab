import assert from "node:assert/strict";
import type { PathCase } from "./harness";

export const cases: PathCase[] = [
  { name: "qualified → won only after payment", scenario: "qualified", steps: ["reply_full", "ack", "approve", "sounds_great", "accept_pay"], expect: { status: "completed", outcome: "success", events: ["Payment event", "Won"], records: { lead: "Won", offer: "Accepted" } } },
  { name: "positive sentiment is not won", scenario: "qualified", steps: ["reply_full", "ack", "approve", "sounds_great"], expect: { status: "waiting_customer", records: { lead: "Pending" }, noEvents: ["Won —"] } },
  { name: "scope question creates v2 via owner", scenario: "qualified", steps: ["reply_full", "ack", "approve", "question", "revise", "accept_pay"], expect: { outcome: "success", check: (r) => assert.ok(r.records.find((x) => x.id === "offer")!.ref!.endsWith("v2")) } },
  { name: "missing budget stays unknown → discovery, pending", scenario: "missing_budget", steps: ["reply_no_budget", "still_unsure", "ack", "discovery"], expect: { outcome: "exception", records: { bant: "Budget unknown", lead: "Pending" }, events: ["blocked"], check: (r) => assert.equal(r.records.find((x) => x.id === "bant")!.fields.find((f) => f.label === "Budget")!.value, "Unknown") } },
  { name: "duplicate updates one lead", scenario: "duplicate", steps: [], expect: { status: "waiting_customer", events: ["Existing lead L-2291"], noEvents: ["created"], check: (r) => { assert.equal(r.records.find((x) => x.id === "lead")!.ref, "L-2291"); assert.equal(r.outbox.filter((o) => o.channel === "crm").length, 1); } } },
  { name: "no reply stops at limit", scenario: "no_reply", steps: ["wait", "wait", "wait"], expect: { status: "stopped", outcome: "exception", events: ["No reply after 3 attempts"], check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "email").length, 3) } },
  { name: "opt-out stops everything", scenario: "no_reply", steps: ["wait", "opt_out"], expect: { status: "stopped", outcome: "stopped", events: ["Opt-out recorded"] } },
  { name: "poor fit stops before outreach", scenario: "poor_fit", steps: [], expect: { status: "stopped", events: ["Poor fit"], check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "email" && o.summary.startsWith("Follow-up")).length, 0) } },
  { name: "qualified reaches exactly one owner", scenario: "qualified", steps: ["reply_full"], expect: { status: "waiting_staff", check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "task").length, 1) } },
];
