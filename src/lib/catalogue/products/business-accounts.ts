import type { DemoDefinition, Product, Run } from "../types";
import { Sim, aud, DAY, HOUR } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

/** Day 0 of the production calendar = Tuesday 13 October 2026. */
const BASE = Date.UTC(2026, 9, 13);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateLabel(day: number): string {
  const d = new Date(BASE + day * 86400000);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const START_DATES = [0, 7, 14].map(dateLabel);

const ZONE = ["Surry Hills", "Redfern", "Alexandria", "Newtown", "Waterloo"];
const LOCATIONS = [...ZONE, "Parramatta", "Manly"];
/** Fictional business directory used for enrichment. */
const DIRECTORY: Record<string, { name: string; type: string; staff: string }> = {
  "larkspur planning co.": { name: "Larkspur Planning Co.", type: "Town planning consultancy", staff: "20–30 on site" },
  "fernhill legal": { name: "Fernhill Legal", type: "Law firm", staff: "10–15 on site" },
  "quarry lane studio": { name: "Quarry Lane Studio", type: "Design studio", staff: "25–40 on site" },
  "westbrook logistics": { name: "Westbrook Logistics", type: "Freight office", staff: "50+ on site" },
};
const PRICE_PER_HEAD = 12;
const REVISED_PRICE_PER_HEAD = 12.5;
const MIN_ORDER = 150;
/** Breakfast portions the bakery can produce each Tuesday morning. */
const CAPACITY = 130;
/** Portions already committed to other accounts, by day offset. */
const BOOKED: Record<number, number> = { 0: 60, 7: 70, 14: 90, 21: 60, 28: 100, 35: 65, 42: 70, 49: 110, 56: 75, 63: 80, 70: 85, 77: 95 };
const OCCURRENCES = 4;
const PROPOSAL_VALID_DAYS = 7;

type Step = "awaiting_min" | "awaiting_owner" | "awaiting_customer" | "awaiting_feedback" | "scheduled" | "awaiting_owner_change" | "awaiting_customer_change" | "done";

interface Occ {
  n: number;
  day: number;
  qty: number;
  ref: string | null;
  status: "scheduled" | "changed" | "flagged";
}

interface State {
  step: Step;
  accountId: string;
  qty: number;
  price: number;
  mix: string;
  version: number;
  sampleDone: boolean;
  orders: Occ[];
  proposalExpires: number | null;
  changeWeek: number;
  changeQty: number;
  maxForWeek: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function interval(sim: Sim<State>): number {
  return sim.str("frequency") === "Fortnightly" ? 14 : 7;
}

function occurrenceDays(sim: Sim<State>): number[] {
  const start = Math.max(0, START_DATES.indexOf(sim.str("start_date"))) * 7;
  return Array.from({ length: OCCURRENCES }, (_, i) => start + i * interval(sim));
}

function free(day: number): number {
  return CAPACITY - (BOOKED[day] ?? 60);
}

function draftTerms(sim: Sim<State>, reason: string) {
  const s = sim.s;
  s.version += 1;
  const perDelivery = s.qty * s.price;
  sim.record({
    id: "terms",
    title: "Commercial terms",
    ref: `T-${s.accountId.slice(3)}-v${s.version}`,
    status: `v${s.version} draft — awaiting owner approval`,
    tone: "warn",
    fields: [
      { label: "Version", value: s.version > 1 ? `v${s.version} (supersedes v${s.version - 1})` : "v1", tone: s.version > 1 ? "warn" : "default" },
      { label: "Order", value: `${s.mix} for ${s.qty} people` },
      { label: "Price", value: `${aud(s.price)} per head = ${aud(perDelivery)} per delivery` },
      { label: "Frequency", value: `${sim.str("frequency")} from ${sim.str("start_date")}` },
      { label: "Delivery", value: `${sim.str("location")}, 7:30–8:00am, no delivery fee in zone` },
      { label: "Minimum order", value: `${aud(MIN_ORDER)} per delivery` },
      { label: "Changes", value: "48 hours’ notice; each change rechecked for price and capacity" },
      { label: "Invoicing", value: "Monthly, 14-day terms" },
    ],
  });
  sim.emit("approve", "waiting", `Terms v${s.version} drafted`, reason);
  s.step = "awaiting_owner";
  sim.wait("waiting_staff", [
    { id: "approve_terms", label: `Owner: approve terms v${s.version}`, actor: "staff", tone: "primary" },
    { id: "decline_account", label: "Owner: decline the account", actor: "staff", tone: "danger" },
  ]);
}

function proposalActions(s: State): Run["actions"] {
  const acts: Run["actions"] = [{ id: "agree", label: "Accept terms and agree the recurring schedule", actor: "customer", tone: "primary" }];
  if (!s.sampleDone) acts.push({ id: "sample", label: "Ask for a sample breakfast first", actor: "customer" });
  acts.push({ id: "no_reply", label: `Advance clock ${PROPOSAL_VALID_DAYS} days (no reply)`, actor: "clock" });
  acts.push({ id: "decline", label: "Not going ahead", actor: "customer", tone: "danger" });
  return acts;
}

function scheduleRecord(sim: Sim<State>, status: string, tone: "ok" | "warn" | "bad" | "default") {
  const s = sim.s;
  sim.record({
    id: "schedule",
    title: "Recurring orders (4 weeks)",
    status,
    tone,
    fields: s.orders.map((o) => ({
      label: `Week ${o.n} — ${dateLabel(o.day)}`,
      value:
        o.status === "flagged"
          ? `Not created — only ${free(o.day)} portions free (owner to resolve)`
          : `${o.ref} · ${o.qty} people · ${aud(o.qty * s.price)}${o.status === "changed" ? " (changed this week only)" : ""}`,
      tone: o.status === "flagged" ? ("bad" as const) : o.status === "changed" ? ("warn" as const) : ("ok" as const),
    })),
  });
}

function scheduledActions(sim: Sim<State>): Run["actions"] {
  const s = sim.s;
  const wk = s.changeWeek;
  const q = s.changeQty;
  const acts: Run["actions"] = [];
  const target = s.orders[wk - 1];
  if (target && target.status === "scheduled" && q > 0 && q !== target.qty) {
    acts.push({ id: "change_one", label: `Change week ${wk} to ${q} people (that week only)`, actor: "customer", hint: "“We have visitors in that week.”" });
    acts.push({ id: "change_all", label: `Change every week to ${q} people`, actor: "customer", hint: "Explicit agreement to change the recurring quantity." });
  }
  acts.push({ id: "keep", label: "Keep the schedule as agreed", actor: "customer", tone: acts.length ? "default" : "primary" });
  return acts;
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary:
    "Interactive simulation using a fictional business directory, delivery zones and production calendar. No message is sent, no order is created in a real system and no invoice is raised.",
  assistantName: "Accounts assistant",
  channelLabel: "Email thread with the office",
  fields: [
    { kind: "text", name: "business", label: "Business (fictional)", helper: "Try Larkspur Planning Co., Fernhill Legal, Quarry Lane Studio or Westbrook Logistics." },
    { kind: "text", name: "email", label: "Contact email" },
    { kind: "select", name: "location", label: "Business location", options: LOCATIONS, helper: "Parramatta and Manly are outside the delivery zone." },
    { kind: "number", name: "quantity", label: "People per delivery", min: 1, max: 200, helper: `${aud(PRICE_PER_HEAD)} per head; minimum ${aud(MIN_ORDER)} per delivery.` },
    { kind: "select", name: "frequency", label: "Frequency", options: ["Weekly", "Fortnightly"] },
    { kind: "select", name: "start_date", label: "First delivery", options: START_DATES },
    { kind: "select", name: "change_week", label: "Week to change later", options: ["Week 1", "Week 2", "Week 3", "Week 4"] },
    { kind: "number", name: "change_qty", label: "Changed quantity for that week", min: 0, max: 200, helper: `Production capacity is ${CAPACITY} portions per Tuesday across all accounts.` },
  ],
  scenarios: [
    { id: "office_breakfast", label: "Tuesday office breakfast", kind: "success", description: "25 people every Tuesday in Surry Hills. Week 2 rises to 35 for one week.", inputs: { business: "Larkspur Planning Co.", email: "office@larkspur.example", location: "Surry Hills", quantity: 25, frequency: "Weekly", start_date: START_DATES[0], change_week: "Week 2", change_qty: 35 } },
    { id: "outside_area", label: "Outside delivery area", kind: "exception", description: "A Parramatta office. No delivery is promised.", inputs: { business: "Westbrook Logistics", email: "admin@westbrook.example", location: "Parramatta", quantity: 40, frequency: "Weekly", start_date: START_DATES[0], change_week: "Week 1", change_qty: 0 } },
    { id: "below_minimum", label: "Below minimum order", kind: "exception", description: "10 people is below the A$150 per-delivery minimum.", inputs: { business: "Fernhill Legal", email: "reception@fernhill.example", location: "Redfern", quantity: 10, frequency: "Fortnightly", start_date: START_DATES[1], change_week: "Week 1", change_qty: 0 } },
    { id: "production_conflict", label: "Production conflict", kind: "exception", description: "Week 2 rises to 45 people on a Tuesday that is almost fully committed.", inputs: { business: "Quarry Lane Studio", email: "studio@quarrylane.example", location: "Alexandria", quantity: 25, frequency: "Weekly", start_date: START_DATES[1], change_week: "Week 2", change_qty: 45 } },
  ],

  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("business-accounts", scenarioId, inputs, {
      step: "awaiting_owner",
      accountId: "",
      qty: 0,
      price: PRICE_PER_HEAD,
      mix: "Breakfast boxes (pastry, fruit, yoghurt)",
      version: 0,
      sampleDone: false,
      orders: [],
      proposalExpires: null,
      changeWeek: 1,
      changeQty: 0,
      maxForWeek: 0,
    });
    const s = sim.s;
    s.qty = Math.round(sim.num("quantity"));
    s.changeWeek = Math.min(OCCURRENCES, Math.max(1, parseInt(sim.str("change_week").replace(/\D/g, ""), 10) || 1));
    s.changeQty = Math.round(sim.num("change_qty"));
    const business = sim.str("business").trim();
    const location = sim.str("location");
    sim.say("customer", `Hi, this is ${business || "an office"} in ${location}. Could you deliver breakfast for ${s.qty} people ${sim.str("frequency") === "Weekly" ? "every Tuesday" : "every second Tuesday"}, starting ${sim.str("start_date")}?`);
    sim.emit("enquiry", "started", "Business enquiry received", `${business} · ${sim.str("email")}`);

    // Verify account and delivery fit
    sim.emit("verify", "started", "Verifying business and delivery fit");
    if (!business || !(s.qty > 0) || !LOCATIONS.includes(location)) {
      sim.emit("verify", "failed", "Enquiry incomplete", "Business name, location and quantity are required.");
      sim.record({ id: "account", title: "Business account", status: "Incomplete enquiry", tone: "bad", fields: [{ label: "Missing", value: "Business, location or quantity" }] });
      return sim.finish("failed", { kind: "failed", summary: "The enquiry is missing required details, so no account was created. Fix the inputs and run again." }).done();
    }
    const found = DIRECTORY[business.toLowerCase()];
    s.accountId = sim.ref("ACC");
    const key = `account:${sim.str("email").toLowerCase()}`;
    sim.claim(key, "verify", "account");
    sim.send({ channel: "crm", to: "Account CRM", summary: `Create prospect account ${s.accountId}`, status: "simulated", opKey: key });
    sim.emit(
      "check_zone",
      found ? "passed" : "info",
      found ? `Business verified: ${found.name}` : "Business not found in directory — owner to verify",
      found ? `${found.type}, ${found.staff} (fictional directory fixture).` : "Unverified details are labelled, not assumed.",
    );
    const inZone = ZONE.includes(location);
    sim.record({
      id: "account",
      title: "Business account",
      ref: s.accountId,
      status: "Prospect",
      fields: [
        { label: "Business", value: found ? `${found.name} — ${found.type}` : `${business} (unverified)`, tone: found ? "ok" : "warn" },
        { label: "Contact", value: sim.str("email") },
        { label: "Location", value: location },
        { label: "Delivery zone", value: inZone ? "Inside zone" : "Outside zone", tone: inZone ? "ok" : "bad" },
        { label: "Requested", value: `${s.qty} people, ${sim.str("frequency").toLowerCase()} from ${sim.str("start_date")}` },
      ],
    });

    if (!inZone) {
      s.step = "done";
      sim.emit("check_zone", "blocked", `${location} is outside the delivery zone`, "No delivery date, price or schedule is offered.");
      sim.emit("outside", "stopped", "Outside delivery area — handed to owner", "Reply offers collection only; the owner can decide on any exception.");
      sim.say("assistant", `Thank you for asking. ${location} is outside our delivery area, so we can’t offer deliveries there. The owner will be in touch about whether collection from the shop could work for you.`);
      sim.send({ channel: "email", to: sim.str("email"), summary: "Outside delivery area — collection option, no delivery promise", status: "held" });
      sim.send({ channel: "task", to: "Owner", summary: `Review out-of-area enquiry ${s.accountId}`, status: "simulated" });
      sim.patch("account", { status: "Outside delivery area — no delivery offered", tone: "bad" });
      return sim.finish("stopped", { kind: "exception", summary: `${location} is outside the delivery zone, so no delivery, price or schedule was promised. The enquiry was handed to the owner.` }).done();
    }
    sim.emit("check_zone", "passed", `${location} is inside the delivery zone`);
    sim.emit("verify", "passed", "Account and delivery fit confirmed");

    // Scope quantity and frequency
    const perDelivery = s.qty * PRICE_PER_HEAD;
    sim.emit("scope", "started", "Scoping quantity and frequency", `${s.qty} × ${aud(PRICE_PER_HEAD)} = ${aud(perDelivery)} per delivery`);
    if (perDelivery < MIN_ORDER) {
      const minQty = Math.ceil(MIN_ORDER / PRICE_PER_HEAD);
      sim.emit("check_zone", "failed", `Below minimum: ${aud(perDelivery)} < ${aud(MIN_ORDER)} per delivery`, `Smallest qualifying order is ${minQty} people.`);
      sim.say("assistant", `Thanks! Our recurring deliveries start at ${aud(MIN_ORDER)} each, which is ${minQty} people at ${aud(PRICE_PER_HEAD)} a head. Would ${minQty} work for you, or would you prefer to order one-off from the shop?`);
      sim.send({ channel: "email", to: sim.str("email"), summary: `Minimum order explained — ${minQty} people suggested`, status: "held" });
      sim.patch("account", { status: "Below minimum — awaiting customer", tone: "warn" });
      s.step = "awaiting_min";
      return sim
        .wait("waiting_customer", [
          { id: "raise_min", label: `Increase to ${minQty} people`, actor: "customer", tone: "primary", hint: "“We can round up — some of the team will be glad of it.”" },
          { id: "decline", label: "Not going ahead", actor: "customer", tone: "danger" },
        ])
        .done();
    }
    sim.emit("check_zone", "passed", `Minimum met: ${aud(perDelivery)} ≥ ${aud(MIN_ORDER)}`);
    sim.emit("scope", "passed", `Scoped: ${s.qty} people, ${sim.str("frequency").toLowerCase()}`);
    draftTerms(sim, "Owner approves price, terms and feasibility before anything is proposed.");
    return sim.done();
  },

  act(run, actionId) {
    const sim = Sim.from(run);
    const s = sim.s;

    switch (actionId) {
      case "raise_min": {
        const minQty = Math.ceil(MIN_ORDER / PRICE_PER_HEAD);
        sim.advance(2 * HOUR);
        sim.say("customer", `We can round up to ${minQty}.`);
        s.qty = minQty;
        sim.emit("check_zone", "passed", `Minimum met at ${minQty} people (${aud(minQty * PRICE_PER_HEAD)})`);
        sim.emit("scope", "passed", `Scoped: ${minQty} people, ${sim.str("frequency").toLowerCase()}`);
        sim.patch("account", { status: "Prospect", tone: "default", fields: [{ label: "Requested", value: `${minQty} people (raised to minimum), ${sim.str("frequency").toLowerCase()} from ${sim.str("start_date")}` }] });
        draftTerms(sim, "Quantity raised to meet the minimum order.");
        return sim.done();
      }

      case "approve_terms": {
        const key = `${s.accountId}:terms:v${s.version}`;
        if (!sim.claim(key, "check_terms", "proposal send")) return sim.done();
        sim.emit("check_terms", "passed", `Owner approved terms v${s.version}`, undefined, { opKey: key });
        s.proposalExpires = sim.run.clock + PROPOSAL_VALID_DAYS * DAY;
        const days = occurrenceDays(sim);
        sim.send({ channel: "email", to: sim.str("email"), summary: `Proposal with terms v${s.version}: ${aud(s.qty * s.price)} per delivery`, status: "held", opKey: key });
        sim.say(
          "staff",
          `Here’s our proposal (v${s.version}): ${s.mix.toLowerCase()} for ${s.qty} people at ${aud(s.price)} a head, ${aud(s.qty * s.price)} per delivery, ${sim.str("frequency").toLowerCase()} on Tuesdays from ${dateLabel(days[0])}, delivered 7:30–8:00am. Nothing is scheduled until you agree to the schedule.`,
        );
        sim.emit("approve", "confirmed", `Proposal v${s.version} sent — valid ${PROPOSAL_VALID_DAYS} days`);
        sim.patch("terms", { status: `v${s.version} approved — sent to customer`, tone: "ok" });
        sim.patch("account", { status: "Proposal sent", tone: "default" });
        sim.emit("agree", "waiting", "Waiting for explicit agreement to the schedule", "No recurring orders exist until the customer agrees.");
        s.step = "awaiting_customer";
        return sim.wait("waiting_customer", proposalActions(s)).done();
      }

      case "decline_account": {
        s.step = "done";
        sim.emit("check_terms", "stopped", "Owner declined the account");
        sim.patch("terms", { status: `v${s.version} declined by owner`, tone: "bad" });
        sim.patch("account", { status: "Closed — owner declined", tone: "bad" });
        return sim.finish("completed", { kind: "exception", summary: "The owner declined to offer terms, so no proposal was sent and no orders exist." }).done();
      }

      case "sample": {
        if (s.sampleDone) return sim.done();
        s.sampleDone = true;
        sim.say("customer", "Could we try a sample breakfast before committing?");
        const key = `${s.accountId}:sample`;
        sim.claim(key, "approve", "sample");
        const smp = sim.ref("SMP");
        sim.send({ channel: "task", to: "Production", summary: `One-off sample for 5 people — ${smp}`, status: "simulated", opKey: key });
        sim.emit("approve", "info", `Sample ${smp} scheduled for 5 people`, "One-off; creates no recurring order.", { ref: smp });
        sim.advance(2 * DAY);
        sim.say("system", "Sample delivered (simulated). Waiting for feedback.");
        s.step = "awaiting_feedback";
        return sim
          .wait("waiting_customer", [
            { id: "feedback", label: "Feedback: more fruit, fewer pastries", actor: "customer", hint: "Changes the mix, so the proposal is revised." },
            { id: "agree", label: "Sample was great — agree the schedule", actor: "customer", tone: "primary" },
            { id: "decline", label: "Not going ahead", actor: "customer", tone: "danger" },
          ])
          .done();
      }

      case "feedback": {
        sim.say("customer", "Loved it — could we have more fruit and fewer pastries?");
        sim.emit("feedback", "info", "Sample feedback: change the mix", "revise proposal");
        s.mix = "Breakfast boxes (fruit-forward, one pastry, yoghurt)";
        s.price = REVISED_PRICE_PER_HEAD;
        sim.emit("scope", "passed", `Rescoped: fruit-forward mix at ${aud(REVISED_PRICE_PER_HEAD)} per head`);
        sim.patch("terms", { status: `v${s.version} superseded`, tone: "muted" });
        draftTerms(sim, "Mix changed after sample feedback; price rechecked from the price list.");
        return sim.done();
      }

      case "no_reply": {
        sim.advance(PROPOSAL_VALID_DAYS * DAY);
        s.step = "done";
        sim.emit("agree", "stopped", "Proposal lapsed without agreement — no recurring orders created");
        sim.patch("terms", { status: `v${s.version} lapsed`, tone: "muted" });
        sim.patch("account", { status: "Prospect — proposal lapsed", tone: "warn" });
        sim.send({ channel: "task", to: "Owner", summary: `Proposal ${s.accountId} lapsed — decide on one personal follow-up`, status: "simulated" });
        return sim.finish("stopped", { kind: "exception", summary: `The proposal was not accepted within ${PROPOSAL_VALID_DAYS} days, so no recurring orders were created. The owner decides whether to follow up.` }).done();
      }

      case "decline": {
        sim.say("customer", "Thanks, but we won’t go ahead for now.");
        s.step = "done";
        sim.emit("agree", "stopped", "Customer declined — no recurring orders created");
        sim.patch("account", { status: "Closed — customer declined", tone: "bad" });
        if (sim.getRecord("terms")) sim.patch("terms", { status: `v${s.version} not accepted`, tone: "muted" });
        return sim.finish("completed", { kind: "exception", summary: "The customer did not accept, so no recurring orders exist and follow-up stops." }).done();
      }

      case "agree": {
        sim.advance(4 * HOUR);
        sim.say("customer", `We agree to the terms (v${s.version}) and the ${sim.str("frequency").toLowerCase()} Tuesday schedule.`);
        const agr = sim.ref("AGR");
        sim.emit("agree", "confirmed", `Customer agreed schedule and terms v${s.version}`, `Agreement ${agr} recorded.`, { ref: agr });
        sim.patch("terms", { status: `v${s.version} accepted by customer (${agr})`, tone: "ok" });
        // Create orders and fulfilment plan
        sim.emit("orders", "started", `Creating ${OCCURRENCES} recurring orders`);
        const days = occurrenceDays(sim);
        s.orders = days.map((day, i) => ({ n: i + 1, day, qty: s.qty, ref: null, status: "scheduled" as const }));
        let flagged = 0;
        for (const o of s.orders) {
          if (free(o.day) < o.qty) {
            o.status = "flagged";
            flagged += 1;
            sim.emit("check_capacity", "blocked", `Week ${o.n} (${dateLabel(o.day)}): only ${free(o.day)} portions free`, "Occurrence not created; owner to resolve.");
            continue;
          }
          const key = `${s.accountId}:order:${o.day}`;
          if (!sim.claim(key, "orders", "order")) continue;
          o.ref = sim.ref("ORD");
          sim.send({ channel: "crm", to: "Ordering system", summary: `Order ${o.ref} — ${dateLabel(o.day)}, ${o.qty} people`, status: "simulated", opKey: key });
        }
        sim.emit("check_capacity", flagged ? "failed" : "passed", flagged ? `${flagged} occurrence(s) exceed capacity` : `Capacity confirmed for all ${OCCURRENCES} occurrences`, `Capacity ${CAPACITY} portions per Tuesday.`);
        sim.emit("orders", "confirmed", `${OCCURRENCES - flagged} recurring orders created`);
        scheduleRecord(sim, flagged ? "Created with flagged exception" : "Active — 4 weeks scheduled", flagged ? "warn" : "ok");
        sim.patch("account", { status: "Active recurring account", tone: "ok", fields: [{ label: "Agreement", value: `${agr} — terms v${s.version}` }, { label: "Invoicing", value: "Monthly, 14-day terms (simulated)" }] });
        s.step = "scheduled";
        return sim.wait("waiting_customer", scheduledActions(sim)).done();
      }

      case "change_one": {
        const o = s.orders[s.changeWeek - 1];
        if (!o || o.status !== "scheduled") return sim.done();
        const q = s.changeQty;
        sim.advance(1 * DAY);
        sim.say("customer", `For ${dateLabel(o.day)} only, could we have ${q} people instead of ${o.qty}?`);
        sim.emit("qtychange", "info", `Quantity change requested: week ${o.n} ${o.qty} → ${q}`, "recheck selected order");
        const value = q * s.price;
        if (value < MIN_ORDER) {
          sim.emit("check_capacity", "blocked", `Week ${o.n} change below the ${aud(MIN_ORDER)} minimum (${aud(value)})`);
          sim.record({ id: "change", title: "Schedule change", status: "Flagged — below minimum", tone: "bad", fields: [{ label: "Week", value: `${o.n} — ${dateLabel(o.day)}` }, { label: "Requested", value: `${q} people (${aud(value)})` }] });
          s.step = "done";
          return sim.finish("completed", { kind: "exception", summary: `The week ${o.n} change would fall below the minimum order, so it was flagged and the agreed order stays at ${o.qty}.` }).done();
        }
        sim.emit("scope", "passed", `Price rechecked: ${q} × ${aud(s.price)} = ${aud(value)}`);
        if (free(o.day) < q) {
          s.maxForWeek = free(o.day);
          sim.emit("check_capacity", "blocked", `Production conflict on ${dateLabel(o.day)}`, `${BOOKED[o.day] ?? 60} portions already committed; ${free(o.day)} free, ${q} requested.`);
          sim.record({
            id: "change",
            title: "Schedule change",
            status: "Flagged — production conflict",
            tone: "bad",
            fields: [
              { label: "Week", value: `${o.n} — ${dateLabel(o.day)}` },
              { label: "Requested", value: `${q} people` },
              { label: "Free capacity", value: `${free(o.day)} portions`, tone: "bad" },
              { label: "Current order", value: `${o.ref} stays at ${o.qty} until resolved` },
            ],
          });
          sim.send({ channel: "task", to: "Owner", summary: `Capacity conflict on ${dateLabel(o.day)} for ${s.accountId}`, status: "simulated" });
          s.step = "awaiting_owner_change";
          return sim
            .wait("waiting_staff", [
              { id: "offer_max", label: `Owner: offer ${s.maxForWeek} for that week`, actor: "staff", tone: "primary" },
              { id: "keep_original", label: `Owner: keep ${o.qty} and explain`, actor: "staff" },
            ])
            .done();
        }
        const key = `${s.accountId}:change:${o.day}:${q}`;
        if (!sim.claim(key, "orders", "change")) return sim.done();
        const from = o.qty;
        o.qty = q;
        o.status = "changed";
        sim.emit("check_capacity", "passed", `Capacity ok on ${dateLabel(o.day)}: ${free(o.day)} free`);
        sim.send({ channel: "crm", to: "Ordering system", summary: `Update ${o.ref} only — ${q} people`, status: "simulated", opKey: key });
        sim.emit("orders", "confirmed", `Accepted change: ${o.ref} week ${o.n} only`, "Other occurrences unchanged.");
        scheduleRecord(sim, "Active — one-week change applied", "ok");
        sim.record({ id: "change", title: "Schedule change", status: `Accepted — week ${o.n} only`, tone: "ok", fields: [{ label: "Order", value: `${o.ref} — ${dateLabel(o.day)}` }, { label: "Quantity", value: `${from} → ${q}` }, { label: "Delivery value", value: aud(q * s.price) }, { label: "Other weeks", value: `Unchanged at ${s.qty} people` }] });
        s.step = "done";
        return sim.finish("completed", { kind: "success", summary: `Recurring account active with ${s.orders.filter((x) => x.ref).length} orders; the week ${o.n} change to ${q} passed price and capacity checks and affects only that occurrence.` }).done();
      }

      case "offer_max": {
        const o = s.orders[s.changeWeek - 1];
        sim.say("staff", `We can do up to ${s.maxForWeek} people on ${dateLabel(o.day)} — would that work?`);
        sim.emit("qtychange", "waiting", `Owner offered ${s.maxForWeek} for week ${o.n}`);
        s.step = "awaiting_customer_change";
        return sim
          .wait("waiting_customer", [
            { id: "accept_max", label: `Accept ${s.maxForWeek} for that week`, actor: "customer", tone: "primary" },
            { id: "keep_original", label: `Keep ${o.qty} for that week`, actor: "customer" },
          ])
          .done();
      }

      case "accept_max": {
        const o = s.orders[s.changeWeek - 1];
        const key = `${s.accountId}:change:${o.day}:${s.maxForWeek}`;
        if (!sim.claim(key, "orders", "change")) return sim.done();
        const from = o.qty;
        o.qty = s.maxForWeek;
        o.status = "changed";
        sim.say("customer", `${s.maxForWeek} is fine for that week, thanks.`);
        sim.emit("check_capacity", "passed", `Capacity ok at ${s.maxForWeek} on ${dateLabel(o.day)}`);
        sim.send({ channel: "crm", to: "Ordering system", summary: `Update ${o.ref} only — ${o.qty} people`, status: "simulated", opKey: key });
        sim.emit("orders", "confirmed", `Accepted change: ${o.ref} week ${o.n} only at ${o.qty}`, "Other occurrences unchanged.");
        scheduleRecord(sim, "Active — one-week change applied", "ok");
        sim.patch("change", { status: `Accepted at capacity limit — week ${o.n} only`, tone: "warn", fields: [{ label: "Resolved", value: `${from} → ${o.qty} (owner offer accepted)` }] });
        s.step = "done";
        return sim.finish("completed", { kind: "exception", summary: `The week ${o.n} request exceeded production capacity; the customer accepted the owner’s offer of ${o.qty}, applied to that occurrence only.` }).done();
      }

      case "keep_original": {
        const o = s.orders[s.changeWeek - 1];
        sim.emit("qtychange", "stopped", `Change not applied — week ${o.n} stays at ${o.qty}`);
        sim.patch("change", { status: "Flagged — not applied (capacity)", tone: "bad" });
        scheduleRecord(sim, "Active — unchanged", "ok");
        s.step = "done";
        return sim.finish("completed", { kind: "exception", summary: `The week ${o.n} change exceeded production capacity, so it was flagged and the agreed ${o.qty}-person order stands.` }).done();
      }

      case "change_all": {
        const q = s.changeQty;
        sim.advance(1 * DAY);
        sim.say("customer", `We’d like to move to ${q} people every week from now on — we agree to the change.`);
        sim.emit("qtychange", "info", `Recurring change explicitly agreed: ${s.qty} → ${q} every week`);
        if (q * s.price < MIN_ORDER) {
          sim.emit("check_capacity", "blocked", `Change below the ${aud(MIN_ORDER)} minimum`);
          sim.record({ id: "change", title: "Schedule change", status: "Flagged — below minimum", tone: "bad", fields: [{ label: "Requested", value: `${q} people every week` }] });
          s.step = "done";
          return sim.finish("completed", { kind: "exception", summary: "The recurring change would fall below the minimum order, so it was flagged and the agreed schedule stands." }).done();
        }
        sim.emit("scope", "passed", `Price rechecked: ${aud(q * s.price)} per delivery at approved ${aud(s.price)} per head`);
        let flagged = 0;
        for (const o of s.orders) {
          if (!o.ref) continue;
          if (free(o.day) < q) {
            flagged += 1;
            sim.emit("check_capacity", "blocked", `Week ${o.n} (${dateLabel(o.day)}) cannot take ${q} — stays at ${o.qty}`);
            continue;
          }
          const key = `${s.accountId}:changeall:${o.day}:${q}`;
          if (!sim.claim(key, "orders", "change")) continue;
          o.qty = q;
          o.status = "changed";
          sim.send({ channel: "crm", to: "Ordering system", summary: `Update ${o.ref} — ${q} people`, status: "simulated", opKey: key });
        }
        s.qty = q;
        sim.emit("orders", "confirmed", `Recurring quantity updated to ${q}${flagged ? `; ${flagged} week(s) flagged` : ""}`);
        scheduleRecord(sim, flagged ? "Updated with flagged exception" : `Active — ${q} people every week`, flagged ? "warn" : "ok");
        sim.record({ id: "change", title: "Schedule change", status: flagged ? `Accepted with ${flagged} flagged week(s)` : "Accepted — all weeks (explicitly agreed)", tone: flagged ? "warn" : "ok", fields: [{ label: "New quantity", value: `${q} people` }, { label: "Agreement", value: "Customer explicitly agreed to change every week" }] });
        s.step = "done";
        return sim.finish("completed", { kind: flagged ? "exception" : "success", summary: flagged ? `The explicitly agreed change to ${q} people was applied where capacity allowed; ${flagged} week(s) were flagged for the owner.` : `The customer explicitly agreed to ${q} people every week; price and capacity were rechecked for each occurrence.` }).done();
      }

      case "keep": {
        s.step = "done";
        sim.say("customer", "The schedule looks right, thanks.");
        const flagged = s.orders.filter((o) => o.status === "flagged").length;
        sim.emit("orders", "passed", "Schedule kept as agreed");
        return sim.finish("completed", {
          kind: flagged ? "exception" : "success",
          summary: flagged
            ? `Recurring account active with ${OCCURRENCES - flagged} orders; ${flagged} occurrence(s) exceed capacity and are flagged for the owner.`
            : `Recurring account active: ${OCCURRENCES} orders created only after owner-approved terms and the customer’s explicit agreement.`,
        }).done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const businessAccounts: Product = {
  id: "business-accounts",
  no: 20,
  slug: "business-accounts",
  name: "Business Accounts",
  outcome: "Turn business enquiries into recurring orders.",
  sectorLabel: "Bakeries florists caterers and local suppliers",
  sectors: ["Local orders"],
  outcomes: ["Convert sales", "Grow repeat business"],
  definition:
    "Qualifies business account enquiries against your delivery zone and minimum order, then coordinates a sample or proposal on owner-approved terms. Once the customer explicitly agrees a schedule, it creates the recurring orders and rechecks price and production capacity whenever a quantity changes.",
  situation:
    "A local office asks a bakery for breakfast for 25 people every Tuesday. The owner needs to know the office is real and inside the delivery area, that the order clears the minimum, and that Tuesday production can take it — then wants a schedule the office has actually agreed to, not a verbal ‘sounds good’.",
  endState:
    "Business enquiries become verified accounts with approved terms and a visible recurring schedule. Out-of-area and below-minimum requests are handled without false promises, and one-off changes are rechecked and applied only to the week asked for.",
  handles: [
    "Verifies the business from a directory and checks the delivery zone and minimum order",
    "Drafts terms for owner approval and coordinates an optional sample and revised proposal",
    "Creates four weeks of recurring orders only after the customer agrees the schedule",
    "Rechecks price and production capacity for a one-week quantity change",
    "Flags production conflicts to the owner instead of overcommitting",
  ],
  boundaries: [
    "Never promises delivery outside the zone",
    "Creates no recurring orders from an unaccepted proposal",
    "A change to one week never alters other weeks unless the customer explicitly agrees",
  ],
  delivered: [
    { title: "Approved terms and proposal", body: "Versioned commercial terms — price per head, per-delivery value, delivery window, minimum, change notice and invoicing — approved by the owner." },
    { title: "Owner exception", body: "Capacity conflicts, below-minimum changes and out-of-area enquiries arrive as tasks with the numbers behind them." },
    { title: "Account and recurring orders", body: "Verified account record, customer agreement reference and four scheduled orders with order numbers and any one-week changes." },
  ],
  deployment: {
    rules: [
      "Delivery zones, delivery windows and any collection options",
      "Price list, per-delivery minimums and change notice periods",
      "Production capacity per day and how conflicts are resolved",
      "Who approves account terms and invoicing arrangements",
    ],
    systems: ["Account CRM", "Delivery zones", "Production schedule", "Price list", "Ordering system", "Invoicing"],
  },
  measures: ["Active recurring accounts", "Fulfilled recurring revenue", "Account contribution after delivery and production cost"],
  reliability: [
    "Recurring orders created without customer agreement (target: zero)",
    "Deliveries promised outside the zone (target: zero)",
    "Occurrences scheduled beyond production capacity (target: zero)",
  ],
  harness: {
    systems:
      "Production uses an account CRM, delivery zones, production schedule, price list, ordering and invoicing. The demo uses a fictional business directory, a sample production calendar and an outbox that holds every message.",
    controls: [
      "Verified business details, with unverified details labelled",
      "Delivery zone and minimum order checks before any proposal",
      "Owner-approved commercial terms for every version",
      "Explicit customer agreement before recurring orders exist",
      "Capacity checked per occurrence; changes apply only to the selected occurrence unless explicitly agreed",
    ],
  },
  ctaLine: "Want this setting up recurring accounts from your own enquiries?",
  graph: {
    nodes: [
      { id: "enquiry", kind: "action", row: 0, title: "Business enquiry", input: "Email or form from an office", rule: "Business, location, quantity and start required", output: "Enquiry", failure: "Incomplete → nothing created", system: "Email / forms (demo: preset)" },
      { id: "verify", kind: "action", row: 1, title: "Verify account and delivery fit", input: "Business name, location", rule: "Directory lookup; delivery zone", output: "Prospect account record", failure: "Outside zone → stop", system: "Account CRM + directory (demo: fixture)" },
      { id: "scope", kind: "action", row: 2, title: "Scope quantity and frequency", input: "Quantity, frequency, start", rule: "Price list × quantity; minimum per delivery", output: "Costed requirement", failure: "Below minimum → ask to round up", system: "Price list (demo: fixture)" },
      { id: "approve", kind: "action", row: 3, title: "Approve sample or proposal", input: "Costed requirement", rule: "Owner approves versioned terms; optional sample", output: "Proposal vN sent", failure: "Owner declines → stop", system: "Proposal (demo: held outbox)" },
      { id: "agree", kind: "action", row: 4, title: "Customer agrees recurring schedule", input: "Proposal", rule: "Explicit agreement to terms and schedule", output: "Agreement reference", failure: "No reply or decline → no orders", system: "Email (demo: held outbox)" },
      { id: "orders", kind: "action", row: 5, title: "Create orders and fulfilment plan", input: "Agreement", rule: "One order per occurrence; capacity per Tuesday", output: "Four recurring orders", failure: "Conflict → occurrence flagged", system: "Ordering + production (demo: simulated)" },
      { id: "outside", kind: "branch", row: 1, title: "Outside delivery area", input: "Location outside zone", rule: "No delivery promise; owner handoff", output: "Collection-only reply draft", failure: "—" },
      { id: "feedback", kind: "branch", row: 2.6, title: "Sample feedback", input: "Customer feedback on sample", rule: "Change mix; reprice from price list", output: "New terms version", failure: "—" },
      { id: "qtychange", kind: "branch", row: 4.5, title: "Quantity change", input: "Change for one week or all", rule: "Recheck price and capacity for the selected order", output: "Accepted change or flagged exception", failure: "—" },
      { id: "check_zone", kind: "check", row: 1.2, title: "Business and zone checks", input: "Directory, zone list, minimum", rule: "Verified or labelled; in zone; ≥ A$150 per delivery", output: "Pass / blocked", failure: "Outside zone → stop" },
      { id: "check_terms", kind: "check", row: 3, title: "Approved commercial terms", input: "Draft terms vN", rule: "Owner approval before sending", output: "Approved version", failure: "Declined → nothing sent" },
      { id: "check_capacity", kind: "check", row: 5, title: "Agreed schedule and capacity", input: "Agreement, production calendar", rule: "Occurrence qty ≤ free portions", output: "Orders or flagged occurrence", failure: "Conflict → owner resolves" },
    ],
    edges: [
      { from: "enquiry", to: "verify", kind: "flow" },
      { from: "verify", to: "scope", kind: "flow" },
      { from: "scope", to: "approve", kind: "flow" },
      { from: "approve", to: "agree", kind: "flow" },
      { from: "agree", to: "orders", kind: "flow" },
      { from: "verify", to: "outside", kind: "return" },
      { from: "approve", to: "feedback", kind: "return" },
      { from: "feedback", to: "scope", kind: "return", label: "revise proposal" },
      { from: "orders", to: "qtychange", kind: "return" },
      { from: "qtychange", to: "scope", kind: "return", label: "recheck selected order" },
      { from: "check_zone", to: "verify", kind: "check" },
      { from: "check_terms", to: "approve", kind: "check" },
      { from: "check_capacity", to: "orders", kind: "check" },
    ],
  },
  demo,
};
