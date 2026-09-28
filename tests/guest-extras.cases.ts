import assert from "node:assert/strict";
import type { PathCase } from "./harness";

const tasks = (r: any) => r.outbox.filter((o: any) => o.channel === "task" && o.summary.startsWith("TSK")).length;

export const cases: PathCase[] = [
  { name: "breakfast purchased, one task, acknowledged", scenario: "breakfast", steps: ["select", "pay", "ack"], expect: { status: "completed", outcome: "success", events: ["Payment event", "Purchase confirmed", "Delivery responsibility confirmed"], records: { purchase: "Confirmed", task: "Acknowledged" }, check: (r) => assert.equal(tasks(r), 1) } },
  { name: "late checkout sold when no same-day arrival", scenario: "late_checkout", steps: ["select", "pay", "ack"], expect: { outcome: "success", events: ["Late checkout (2pm): eligible"], records: { purchase: "Confirmed" } } },
  { name: "late checkout excluded on conflicting turnover, alternative offered", scenario: "turnover_conflict", steps: [], expect: { status: "waiting_customer", events: ["Late checkout (2pm): excluded", "Late checkout (2pm) unavailable"], check: (r) => { assert.ok(r.actions.some((a: any) => a.id === "choose_alt")); assert.ok(!r.outbox.some((o: any) => o.summary.includes("Late checkout"))); } } },
  { name: "alternative extra can be bought after conflict", scenario: "turnover_conflict", steps: ["choose_alt", "pay", "ack"], expect: { outcome: "success", events: ["Alternative offered: Breakfast hamper"], check: (r) => assert.ok(r.records.find((x: any) => x.id === "purchase").fields.some((f: any) => f.value === "Breakfast hamper")) } },
  { name: "failed payment produces no confirmed purchase", scenario: "payment_declined", steps: ["select", "pay"], expect: { status: "waiting_customer", events: ["Payment failed"], noEvents: ["Purchase confirmed"], records: { purchase: "Not confirmed" }, check: (r) => { assert.equal(tasks(r), 0); assert.ok(!r.records.some((x: any) => x.id === "task")); } } },
  { name: "exit after failed payment stops with nothing confirmed", scenario: "payment_declined", steps: ["select", "pay", "exit"], expect: { status: "stopped", outcome: "exception", records: { purchase: "Not confirmed" }, check: (r) => assert.equal(tasks(r), 0) } },
  { name: "retry after failure confirms once", scenario: "payment_declined", steps: ["select", "pay", "retry", "ack"], expect: { outcome: "success", records: { purchase: "Confirmed" }, check: (r) => assert.equal(tasks(r), 1) } },
  { name: "repeated payment event creates one task", scenario: "breakfast", steps: ["select", "pay", "replay", "replay"], expect: { status: "waiting_staff", events: ["received again", "Duplicate payment event ignored", "Duplicate fulfilment task ignored"], check: (r) => { assert.equal(tasks(r), 1); assert.equal(r.outbox.filter((o: any) => o.channel === "email" && o.summary.startsWith("Confirmation")).length, 1); } } },
  { name: "unacknowledged task escalates on the clock", scenario: "breakfast", steps: ["select", "pay", "wait", "wait", "ack"], expect: { outcome: "success", events: ["escalated to Duty manager", "escalated to Owner"], records: { task: "Acknowledged — Owner" } } },
  { name: "nothing eligible sends no offer", scenario: "nothing_eligible", steps: [], expect: { status: "stopped", events: ["No eligible extras"], check: (r) => assert.equal(r.outbox.length, 0) } },
];
