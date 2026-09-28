import assert from "node:assert/strict";
import type { PathCase } from "./harness";

const orders = (r: { outbox: { summary: string }[] }) => r.outbox.filter((o) => o.summary.startsWith("Order ORD-")).length;

export const cases: PathCase[] = [
  {
    name: "office breakfast: approved terms → agreement → 4 orders → one-week change",
    scenario: "office_breakfast",
    steps: ["approve_terms", "agree", "change_one"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["Business verified", "Owner approved terms v1", "Customer agreed schedule", "4 recurring orders created", "Accepted change"],
      records: { account: "Active recurring", schedule: "one-week change", change: "week 2 only" },
      check: (r) => {
        assert.equal(orders(r), 4);
        const qtys = r.state.orders.map((o: { qty: number }) => o.qty);
        assert.deepEqual(qtys, [25, 35, 25, 25]);
      },
    },
  },
  {
    name: "unaccepted proposal creates no recurring orders (no reply)",
    scenario: "office_breakfast",
    steps: ["approve_terms", "no_reply"],
    expect: { status: "stopped", outcome: "exception", events: ["no recurring orders created"], check: (r) => { assert.equal(orders(r), 0); assert.ok(!r.records.some((x) => x.id === "schedule")); } },
  },
  { name: "declined proposal creates no orders", scenario: "office_breakfast", steps: ["approve_terms", "decline"], expect: { outcome: "exception", check: (r) => assert.equal(orders(r), 0) } },
  {
    name: "no proposal before owner approval",
    scenario: "office_breakfast",
    steps: [],
    expect: { status: "waiting_staff", records: { terms: "awaiting owner approval" }, check: (r) => assert.equal(r.outbox.filter((o) => o.channel === "email").length, 0) },
  },
  {
    name: "sample feedback revises the proposal to v2",
    scenario: "office_breakfast",
    steps: ["approve_terms", "sample", "feedback", "approve_terms", "agree", "keep"],
    expect: { outcome: "success", events: ["Sample feedback", "Owner approved terms v2"], records: { terms: "v2 accepted" }, check: (r) => assert.equal(orders(r), 4) },
  },
  {
    name: "outside area gets no delivery promise",
    scenario: "outside_area",
    steps: [],
    expect: {
      status: "stopped",
      outcome: "exception",
      events: ["outside the delivery zone"],
      noEvents: ["Terms v1 drafted", "Proposal"],
      records: { account: "no delivery offered" },
      check: (r) => {
        assert.equal(orders(r), 0);
        assert.ok(r.outbox.every((o) => !/per delivery|schedule/i.test(o.summary)));
      },
    },
  },
  {
    name: "below minimum prompts round-up, then proceeds",
    scenario: "below_minimum",
    steps: ["raise_min", "approve_terms", "agree", "keep"],
    expect: { outcome: "success", events: ["Below minimum", "Minimum met at 13 people"], check: (r) => { assert.equal(orders(r), 4); assert.ok(r.state.orders.every((o: { qty: number }) => o.qty === 13)); } },
  },
  { name: "below minimum: decline creates nothing", scenario: "below_minimum", steps: ["decline"], expect: { outcome: "exception", check: (r) => assert.equal(orders(r), 0) } },
  {
    name: "production conflict flagged; other weeks untouched",
    scenario: "production_conflict",
    steps: ["approve_terms", "agree", "change_one", "keep_original"],
    expect: {
      outcome: "exception",
      events: ["Production conflict"],
      records: { change: "Flagged" },
      check: (r) => assert.deepEqual(r.state.orders.map((o: { qty: number }) => o.qty), [25, 25, 25, 25]),
    },
  },
  {
    name: "production conflict resolved at capacity for that week only",
    scenario: "production_conflict",
    steps: ["approve_terms", "agree", "change_one", "offer_max", "accept_max"],
    expect: { outcome: "exception", records: { change: "week 2 only" }, check: (r) => assert.deepEqual(r.state.orders.map((o: { qty: number }) => o.qty), [25, 40, 25, 25]) },
  },
  {
    name: "explicitly agreed change applies to every week",
    scenario: "office_breakfast",
    steps: ["approve_terms", "agree", "change_all"],
    expect: { outcome: "success", records: { change: "all weeks" }, check: (r) => assert.deepEqual(r.state.orders.map((o: { qty: number }) => o.qty), [35, 35, 35, 35]) },
  },
];
