import type { DemoAction, DemoDefinition, Product } from "../types";
import { Sim, aud, HOUR } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

const PROPERTY = "Wattle Lane Cottages";

interface Reservation {
  id: string;
  guest: string;
  email: string;
  room: string;
  guests: number;
  nights: number;
}
const RESERVATIONS: Record<string, Reservation> = {
  "RES-3107 · Mia Chen · Room 3 · 2 nights": { id: "RES-3107", guest: "Mia Chen", email: "mia.chen@mail.example", room: "Room 3", guests: 2, nights: 2 },
  "RES-3112 · Tom Okafor · Room 5 · 1 night": { id: "RES-3112", guest: "Tom Okafor", email: "tom.okafor@mail.example", room: "Room 5", guests: 1, nights: 1 },
};
const RES_NAMES = Object.keys(RESERVATIONS);

type Extra = "Breakfast hamper" | "Late checkout (2pm)";
const EXTRAS: Extra[] = ["Breakfast hamper", "Late checkout (2pm)"];
const BREAKFAST_PER_PERSON = 28;
const LATE_CHECKOUT = 35;
const ESCALATION_HOURS = 4;
const MAX_ESCALATIONS = 2;

const FULFILLER: Record<Extra, string> = {
  "Breakfast hamper": "Kitchen — Sam",
  "Late checkout (2pm)": "Housekeeping — Ana",
};
const ESCALATE_TO = ["Duty manager — Raj", "Owner — Helen"];

type Step = "choosing" | "checkout" | "payment_failed" | "fulfilment" | "done";

interface Eligibility {
  extra: Extra;
  ok: boolean;
  reason: string;
  price: number;
}

interface State {
  step: Step;
  res: Reservation;
  eligibility: Eligibility[];
  chosen: Extra | null;
  offered: Extra | null;
  attempts: number;
  payRef: string;
  receipt: string;
  taskRef: string;
  escalations: number;
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

function evaluate(res: Reservation, arrivalDays: number, stock: number, sameDayArrival: boolean): Eligibility[] {
  const mornings = res.nights;
  const needed = mornings; // one hamper per morning
  const bPrice = BREAKFAST_PER_PERSON * res.guests * mornings;
  const breakfast: Eligibility =
    arrivalDays < 1
      ? { extra: "Breakfast hamper", ok: false, reason: "Ordering cutoff passed — hampers need 24 hours’ notice", price: bPrice }
      : stock < needed
        ? { extra: "Breakfast hamper", ok: false, reason: `Only ${stock} hamper${stock === 1 ? "" : "s"} left for these dates; ${needed} needed`, price: bPrice }
        : { extra: "Breakfast hamper", ok: true, reason: `${needed} hamper${needed === 1 ? "" : "s"} in stock; arrival in ${arrivalDays} day${arrivalDays === 1 ? "" : "s"}`, price: bPrice };
  const late: Eligibility = sameDayArrival
    ? { extra: "Late checkout (2pm)", ok: false, reason: `${res.room} has a same-day arrival on the checkout date`, price: LATE_CHECKOUT }
    : { extra: "Late checkout (2pm)", ok: true, reason: `${res.room} has no arrival on the checkout date`, price: LATE_CHECKOUT };
  return [breakfast, late];
}

function elig(s: State, extra: Extra) {
  return s.eligibility.find((e) => e.extra === extra)!;
}

function priceNote(s: State, extra: Extra) {
  return extra === "Breakfast hamper"
    ? `${aud(BREAKFAST_PER_PERSON)} × ${s.res.guests} guest${s.res.guests === 1 ? "" : "s"} × ${s.res.nights} morning${s.res.nights === 1 ? "" : "s"}`
    : "Flat fee";
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

function goToCheckout(sim: Sim<State>, extra: Extra) {
  const s = sim.s;
  s.chosen = extra;
  s.step = "checkout";
  const e = elig(s, extra);
  sim.say("customer", extra === "Breakfast hamper" ? "Breakfast would be lovely, please add it." : "Yes please, a late checkout would help a lot.");
  sim.emit("select", "passed", `Guest selected ${extra}`, `${aud(e.price)} — ${priceNote(s, extra)}.`);
  sim.record({
    id: "purchase",
    title: "Extra purchase",
    status: "Awaiting payment — not confirmed",
    tone: "warn",
    fields: [
      { label: "Reservation", value: `${s.res.id} · ${s.res.room}` },
      { label: "Extra", value: extra },
      { label: "Price", value: `${aud(e.price)} (${priceNote(s, extra)})` },
      { label: "Payment", value: "Not yet received", tone: "muted" },
    ],
  });
  sim.say("assistant", `Here’s your sample checkout for ${extra} — ${aud(e.price)}. This demo collects no card details; the payment result is simulated.`);
  sim.wait("waiting_customer", [
    { id: "pay", label: `Pay ${aud(e.price)} in sample checkout`, actor: "customer", tone: "primary", hint: "Result follows the “Simulated payment result” input." },
    { id: "decline", label: "Change my mind", actor: "customer" },
  ]);
}

function paymentEvent(sim: Sim<State>, replay: boolean) {
  const s = sim.s;
  const extra = s.chosen!;
  const e = elig(s, extra);
  if (replay) sim.emit("verify", "info", `Payment event ${s.payRef} received again`, "Provider retried the webhook delivery.", { ref: s.payRef });
  const payKey = `payment:${s.payRef}`;
  if (!sim.claim(payKey, "verify", "payment event")) {
    sim.claim(`task:${s.payRef}`, "task", "fulfilment task");
    return;
  }
  sim.emit("check_payment", "passed", `Payment event ${s.payRef} verified`, `${aud(e.price)} for ${s.res.id} · ${extra}.`, { ref: s.payRef, opKey: payKey });
  s.receipt = sim.ref("RCPT");
  sim.send({ channel: "payment", to: "Payment provider (sandbox)", summary: `${s.payRef} succeeded — ${aud(e.price)}`, status: "simulated", opKey: payKey });
  sim.emit("verify", "confirmed", `Purchase confirmed — receipt ${s.receipt}`, undefined, { ref: s.receipt });
  sim.patch("purchase", {
    status: "Confirmed — paid",
    tone: "ok",
    ref: s.receipt,
    fields: [
      { label: "Payment", value: `${s.payRef} (simulated)`, tone: "ok" },
      { label: "Receipt", value: s.receipt },
    ],
  });
  const confKey = `${s.res.id}:confirmation:${s.payRef}`;
  sim.claim(confKey, "verify", "guest confirmation");
  sim.send({ channel: "email", to: s.res.email, summary: `Confirmation: ${extra} added to ${s.res.id} (receipt ${s.receipt})`, status: "held", opKey: confKey });
  sim.say(
    "assistant",
    extra === "Breakfast hamper"
      ? `All set, ${s.res.guest.split(" ")[0]} — a breakfast hamper will be in ${s.res.room} each morning of your stay. Receipt ${s.receipt}.`
      : `All set, ${s.res.guest.split(" ")[0]} — you can stay in ${s.res.room} until 2pm on your checkout day. Receipt ${s.receipt}.`,
  );

  // Fulfilment task, created once per payment event
  const taskKey = `task:${s.payRef}`;
  if (!sim.claim(taskKey, "task", "fulfilment task")) return;
  s.taskRef = sim.ref("TSK");
  s.step = "fulfilment";
  sim.send({ channel: "task", to: FULFILLER[extra], summary: `${s.taskRef}: ${extra} for ${s.res.room} (${s.res.id})`, status: "simulated", opKey: taskKey });
  sim.emit("task", "waiting", `Fulfilment task ${s.taskRef} assigned to ${FULFILLER[extra]}`, `Escalates if not acknowledged within ${ESCALATION_HOURS} hours.`, { ref: s.taskRef, opKey: taskKey });
  sim.record({
    id: "task",
    title: "Fulfilment task",
    ref: s.taskRef,
    status: "Pending — not acknowledged",
    tone: "warn",
    fields: [
      { label: "Task", value: `${extra} for ${s.res.room}` },
      { label: "Assigned to", value: FULFILLER[extra] },
      { label: "Created from", value: `Payment event ${s.payRef}` },
      { label: "Escalation", value: `After ${ESCALATION_HOURS} hours without acknowledgement` },
    ],
  });
}

function fulfilmentActions(s: State): DemoAction[] {
  const a: DemoAction[] = [
    { id: "ack", label: `${s.escalations === 0 ? FULFILLER[s.chosen!] : ESCALATE_TO[s.escalations - 1]}: acknowledge task`, actor: "staff", tone: "primary" },
    { id: "replay", label: "Payment provider resends the same event", actor: "clock", hint: "Webhook retry — must not create a second task." },
  ];
  if (s.escalations < MAX_ESCALATIONS) a.push({ id: "wait", label: `Advance clock ${ESCALATION_HOURS} hours (no acknowledgement)`, actor: "clock" });
  return a;
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Interactive simulation using sample reservations and a sample checkout. No card details are collected, no payment is taken and no staff task is created.",
  assistantName: "Guest extras",
  channelLabel: "Pre-arrival email to the guest",
  fields: [
    { kind: "select", name: "reservation", label: "Reservation", options: RES_NAMES },
    { kind: "number", name: "arrival_days", label: "Arrival in (days)", min: 0, max: 30, helper: "Breakfast hampers need 24 hours’ notice." },
    { kind: "number", name: "breakfast_stock", label: "Breakfast hampers in stock for the stay", min: 0, max: 20 },
    { kind: "toggle", name: "same_day_arrival", label: "Room turnover: another guest arrives on checkout day" },
    { kind: "select", name: "extra", label: "Extra the guest wants", options: EXTRAS },
    { kind: "select", name: "payment_result", label: "Simulated payment result", options: ["Approved", "Declined"] },
  ],
  scenarios: [
    { id: "breakfast", label: "Breakfast added", kind: "success", description: "Two guests, two mornings, hampers in stock. Payment succeeds and the kitchen gets one task.", inputs: { reservation: RES_NAMES[0], arrival_days: 3, breakfast_stock: 6, same_day_arrival: false, extra: "Breakfast hamper", payment_result: "Approved" } },
    { id: "late_checkout", label: "Late checkout", kind: "success", description: "No arrival on the checkout day, so late checkout is offered and sold.", inputs: { reservation: RES_NAMES[1], arrival_days: 2, breakfast_stock: 4, same_day_arrival: false, extra: "Late checkout (2pm)", payment_result: "Approved" } },
    { id: "turnover_conflict", label: "Same-day arrival", kind: "exception", description: "The guest wants late checkout but the room turns over that day. Breakfast is offered instead.", inputs: { reservation: RES_NAMES[0], arrival_days: 3, breakfast_stock: 6, same_day_arrival: true, extra: "Late checkout (2pm)", payment_result: "Approved" } },
    { id: "payment_declined", label: "Payment declined", kind: "exception", description: "The sample payment fails. No purchase is confirmed and no task is created.", inputs: { reservation: RES_NAMES[1], arrival_days: 5, breakfast_stock: 4, same_day_arrival: false, extra: "Breakfast hamper", payment_result: "Declined" } },
    { id: "nothing_eligible", label: "Nothing available", kind: "exception", description: "Arrival is today and the room turns over at checkout. No offer is sent.", inputs: { reservation: RES_NAMES[1], arrival_days: 0, breakfast_stock: 4, same_day_arrival: true, extra: "Breakfast hamper", payment_result: "Approved" } },
  ],
  start(inputs, scenarioId) {
    const resName = String(inputs.reservation ?? RES_NAMES[0]);
    const res = RESERVATIONS[resName] ?? RESERVATIONS[RES_NAMES[0]];
    const sim = Sim.begin<State>("guest-extras", scenarioId, inputs, {
      step: "choosing",
      res,
      eligibility: [],
      chosen: null,
      offered: null,
      attempts: 0,
      payRef: "",
      receipt: "",
      taskRef: "",
      escalations: 0,
    });
    const s = sim.s;
    const arrival = Math.max(0, Math.round(sim.num("arrival_days")));

    // 1. Upcoming reservation
    sim.emit("reservation", "passed", `Reservation ${res.id} loaded`, `${res.guest}, ${res.room}, ${res.guests} guest${res.guests === 1 ? "" : "s"}, ${res.nights} night${res.nights === 1 ? "" : "s"}, arriving in ${arrival} day${arrival === 1 ? "" : "s"}.`, { ref: res.id });
    sim.record({
      id: "reservation",
      title: "Reservation",
      ref: res.id,
      status: "Confirmed stay",
      fields: [
        { label: "Guest", value: res.guest },
        { label: "Room", value: res.room },
        { label: "Stay", value: `${res.nights} night${res.nights === 1 ? "" : "s"}, ${res.guests} guest${res.guests === 1 ? "" : "s"}` },
        { label: "Arrival", value: arrival === 0 ? "Today" : `In ${arrival} day${arrival === 1 ? "" : "s"}` },
        { label: "Checkout-day arrival in room", value: sim.bool("same_day_arrival") ? "Yes" : "No", tone: sim.bool("same_day_arrival") ? "warn" : "default" },
      ],
    });

    // 2. Match available extras
    s.eligibility = evaluate(res, arrival, Math.max(0, Math.round(sim.num("breakfast_stock"))), sim.bool("same_day_arrival"));
    for (const e of s.eligibility) {
      sim.emit("check_rules", e.ok ? "passed" : "failed", `${e.extra}: ${e.ok ? "eligible" : "excluded"}`, e.reason);
    }
    sim.record({
      id: "extras",
      title: "Eligible extras",
      status: `${s.eligibility.filter((e) => e.ok).length} of ${EXTRAS.length} eligible`,
      fields: s.eligibility.map((e) => ({ label: `${e.extra} (${aud(e.price)})`, value: `${e.ok ? "Eligible" : "Excluded"} — ${e.reason}`, tone: e.ok ? ("ok" as const) : ("bad" as const) })),
    });
    const eligible = s.eligibility.filter((e) => e.ok);
    if (eligible.length === 0) {
      s.step = "done";
      sim.emit("unavailable", "stopped", "No eligible extras — no offer sent");
      return sim.finish("stopped", { kind: "exception", summary: "Neither extra passed the stay and capacity rules, so the guest was not sent an offer." }).done();
    }
    sim.emit("match", "passed", `${eligible.length} extra${eligible.length === 1 ? "" : "s"} matched to ${res.id}`);
    const offerKey = `${res.id}:offer`;
    sim.claim(offerKey, "match", "offer");
    sim.send({ channel: "email", to: res.email, summary: `Pre-arrival extras: ${eligible.map((e) => e.extra).join(", ")}`, status: "held", opKey: offerKey });
    sim.say("assistant", `Hi ${res.guest.split(" ")[0]}, looking forward to your stay at ${PROPERTY}. You can add: ${eligible.map((e) => `${e.extra} (${aud(e.price)})`).join("; ")}.`);

    const wanted = (EXTRAS as string[]).includes(sim.str("extra")) ? (sim.str("extra") as Extra) : "Breakfast hamper";
    const w = elig(s, wanted);
    if (!w.ok) {
      const alt = eligible[0].extra;
      s.offered = alt;
      sim.say("customer", `Could we have ${wanted.toLowerCase()}?`);
      sim.emit("unavailable", "blocked", `${wanted} unavailable`, w.reason);
      sim.say("assistant", `Sorry, ${wanted.toLowerCase()} isn’t available for this stay: ${w.reason.charAt(0).toLowerCase() + w.reason.slice(1)}. Would ${alt.toLowerCase()} (${aud(elig(s, alt).price)}) help instead?`);
      return sim
        .wait("waiting_customer", [
          { id: "choose_alt", label: `Add ${alt.toLowerCase()} instead`, actor: "customer", tone: "primary" },
          { id: "decline", label: "No thanks", actor: "customer" },
        ])
        .done();
    }
    s.offered = wanted;
    return sim
      .wait("waiting_customer", [
        { id: "select", label: `Add ${wanted.toLowerCase()}`, actor: "customer", tone: "primary" },
        { id: "decline", label: "No thanks", actor: "customer" },
      ])
      .done();
  },

  act(run, actionId) {
    const sim = Sim.from(run);
    const s = sim.s;

    switch (actionId) {
      case "select":
      case "choose_alt": {
        if (s.step !== "choosing" || !s.offered) return sim.done();
        sim.advance(HOUR);
        if (actionId === "choose_alt") sim.emit("unavailable", "info", `Alternative offered: ${s.offered}`);
        goToCheckout(sim, s.offered);
        return sim.done();
      }

      case "decline": {
        sim.advance(30);
        sim.say("customer", "No thanks, we’re fine.");
        s.step = "done";
        sim.emit("select", "stopped", "Guest declined — nothing charged");
        if (sim.getRecord("purchase")) sim.patch("purchase", { status: "Not purchased", tone: "muted" });
        return sim.finish("stopped", { kind: "exception", summary: "The guest declined the extra. No purchase or fulfilment task was created." }).done();
      }

      case "pay":
      case "retry": {
        if (s.step !== "checkout" && s.step !== "payment_failed") return sim.done();
        sim.advance(5);
        s.attempts += 1;
        const result = actionId === "retry" ? "Approved" : sim.str("payment_result", "Approved");
        sim.emit("verify", "started", actionId === "retry" ? "Retrying with another sample card" : "Waiting for payment event");
        if (result === "Declined") {
          s.step = "payment_failed";
          sim.emit("check_payment", "failed", "Payment declined — no verified payment event");
          sim.emit("payfailed", "failed", "Payment failed — purchase not confirmed", "No receipt, no guest confirmation and no fulfilment task.");
          sim.patch("purchase", { status: "Not confirmed — payment declined", tone: "bad", fields: [{ label: "Payment", value: "Declined (simulated)", tone: "bad" }] });
          sim.say("assistant", "That payment didn’t go through, so nothing has been added to your stay. You can try another card or leave it.");
          return sim
            .wait("waiting_customer", [
              { id: "retry", label: "Try another sample card", actor: "customer", tone: "primary" },
              { id: "exit", label: "Leave it", actor: "customer" },
            ])
            .done();
        }
        s.payRef = sim.ref("PAY");
        paymentEvent(sim, false);
        return sim.wait("waiting_staff", fulfilmentActions(s)).done();
      }

      case "exit": {
        s.step = "done";
        sim.emit("payfailed", "stopped", "Guest exited after failed payment");
        sim.patch("purchase", { status: "Not confirmed — abandoned after failed payment", tone: "bad" });
        return sim.finish("stopped", { kind: "exception", summary: "The payment failed and the guest left checkout. No purchase was confirmed and no fulfilment task exists." }).done();
      }

      case "replay": {
        if (s.step !== "fulfilment") return sim.done();
        sim.advance(2);
        paymentEvent(sim, true);
        sim.patch("task", { fields: [{ label: "Duplicate events ignored", value: "Yes — one task kept", tone: "ok" }] });
        return sim.wait("waiting_staff", fulfilmentActions(s)).done();
      }

      case "wait": {
        if (s.step !== "fulfilment" || s.escalations >= MAX_ESCALATIONS) return sim.done();
        sim.advance(ESCALATION_HOURS * HOUR);
        s.escalations += 1;
        const to = ESCALATE_TO[s.escalations - 1];
        const key = `${s.taskRef}:escalate:${s.escalations}`;
        if (!sim.claim(key, "notack", "escalation")) return sim.done();
        sim.emit("notack", "waiting", `Not acknowledged after ${ESCALATION_HOURS * s.escalations} hours — escalated to ${to}`, undefined, { opKey: key });
        sim.send({ channel: "task", to, summary: `Escalation ${s.escalations}: ${s.taskRef} not acknowledged`, status: "simulated", opKey: key });
        sim.patch("task", { status: `Pending — escalated to ${to}`, tone: "bad", fields: [{ label: "Escalated to", value: to, tone: "bad" }] });
        return sim.wait("waiting_staff", fulfilmentActions(s)).done();
      }

      case "ack": {
        if (s.step !== "fulfilment") return sim.done();
        sim.advance(10);
        const who = s.escalations === 0 ? FULFILLER[s.chosen!] : ESCALATE_TO[s.escalations - 1];
        sim.say("staff", `${who}: on it — ${s.chosen} for ${s.res.room} is scheduled.`);
        sim.emit("check_ack", "passed", `Task ${s.taskRef} acknowledged by ${who}`);
        sim.emit("confirm", "confirmed", "Delivery responsibility confirmed", `${who} owns delivery of ${s.chosen}.`, { ref: s.taskRef });
        sim.patch("task", { status: `Acknowledged — ${who}`, tone: "ok" });
        s.step = "done";
        return sim
          .finish("completed", {
            kind: "success",
            summary: `Payment ${s.payRef} was verified, receipt ${s.receipt} issued and one fulfilment task ${s.taskRef} was acknowledged by ${who}.`,
          })
          .done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const guestExtras: Product = {
  id: "guest-extras",
  no: 16,
  slug: "guest-extras",
  name: "Guest Extras",
  outcome: "Offer useful extras before guests arrive.",
  sectorLabel: "Small accommodation",
  sectors: ["Accommodation"],
  outcomes: ["Convert sales"],
  definition:
    "Matches upcoming stays with available extras and creates both a purchase record and a fulfilment task. Each extra is checked against the stay and the property's capacity before it is offered, and fulfilment starts only from a verified payment event.",
  situation:
    "A guest arriving in a few days could add a breakfast hamper or a late checkout. Late checkout is not possible when another guest arrives in the same room that day, and breakfast depends on hamper stock and 24 hours’ notice.",
  endState:
    "Guests are offered only extras the property can deliver, every paid extra has a receipt and exactly one task, and someone on staff has acknowledged responsibility for it.",
  handles: [
    "Checks each extra against stay dates, stock and room turnover, with the reason shown",
    "Offers an alternative when the requested extra is unavailable",
    "Runs a sample checkout and confirms the purchase only after a verified payment event",
    "Creates one fulfilment task per payment, even if the event arrives twice",
    "Escalates tasks that are not acknowledged in time",
  ],
  boundaries: [
    "Never offers late checkout when the room has a same-day arrival",
    "A failed payment produces no confirmed purchase and no task",
    "The demo collects no card details and takes no payment",
  ],
  delivered: [
    { title: "Guest confirmation", body: "A short note confirming the extra, the price and the receipt number, sent after the payment is verified." },
    { title: "Fulfilment task", body: "Assigned to kitchen or housekeeping with room, date and extra; pending until acknowledged, then escalated if ignored." },
    { title: "Purchase record", body: "Reservation, extra, price rule, payment reference and receipt, linked to the single task it created." },
  ],
  deployment: {
    rules: [
      "Which extras you sell, their prices and notice periods",
      "Stock limits and turnover rules per room",
      "Who fulfils each extra and who is next in the escalation chain",
      "Acknowledgement time before escalation",
    ],
    systems: ["Property booking system", "Extras inventory", "Payment provider", "Staff task system"],
  },
  measures: ["Fulfilled extras contribution per stay", "Fulfilment failure rate", "Share of offered stays that add an extra"],
  reliability: ["Duplicate fulfilment tasks from repeated payment events (target: zero)", "Late checkouts sold against a same-day arrival (target: zero)", "Tasks acknowledged before escalation"],
  harness: {
    systems:
      "Production connects property bookings, extras inventory, a payment provider and the staff task system. The demo uses two sample reservations, a stock fixture, a simulated payment event and an outbox that holds guest messages.",
    controls: [
      "Eligibility and availability rules per extra, with the reason recorded",
      "Payment verification before any purchase is confirmed",
      "Idempotent task creation keyed on the payment event",
      "Fulfilment acknowledgement by a named staff member",
      "Escalation timer for unacknowledged tasks",
    ],
  },
  ctaLine: "Want this offering extras from your own booking system?",
  graph: {
    nodes: [
      { id: "reservation", kind: "action", row: 0, title: "Upcoming reservation", input: "Reservation from the booking system", rule: "Stay dates, room, guests", output: "Reservation context", failure: "—", system: "Property bookings (demo: fixture)" },
      { id: "match", kind: "action", row: 1, title: "Match available extras", input: "Reservation, stock, turnover", rule: "Only eligible extras are offered", output: "Eligible extras with reasons; offer message", failure: "None eligible → no offer", system: "Extras inventory (demo: fixture); email (held)" },
      { id: "select", kind: "action", row: 2, title: "Guest selects option", input: "Guest choice", rule: "Catalogue price; sample checkout without card details", output: "Purchase awaiting payment", failure: "Guest declines → stop", system: "Sample checkout" },
      { id: "verify", kind: "action", row: 3, title: "Verify purchase event", input: "Payment event", rule: "Purchase confirmed only on a verified event; deduplicated by event id", output: "Receipt and guest confirmation", failure: "Declined → payment failed", system: "Payment provider (demo: simulated event)" },
      { id: "task", kind: "action", row: 4, title: "Create fulfilment task", input: "Verified purchase", rule: "One task per payment event", output: "Pending task assigned to staff", failure: "Not acknowledged → escalate", system: "Staff tasks (demo: simulated)" },
      { id: "confirm", kind: "action", row: 5, title: "Confirm delivery responsibility", input: "Staff acknowledgement", rule: "Named person accepts the task", output: "Acknowledged task", failure: "—", system: "Staff tasks (demo: staff action)" },
      { id: "unavailable", kind: "branch", row: 0.9, title: "Unavailable extra", input: "Requested extra fails a rule", rule: "Explain why; offer an eligible alternative", output: "Alternative offer", failure: "Nothing eligible → stop" },
      { id: "payfailed", kind: "branch", row: 2.5, title: "Payment failed", input: "Declined payment", rule: "No purchase, no task; retry or exit", output: "Unconfirmed purchase", failure: "Guest exits → stop" },
      { id: "notack", kind: "branch", row: 4.3, title: "Not acknowledged", input: `No acknowledgement in ${ESCALATION_HOURS} hours`, rule: "Escalate to duty manager, then owner", output: "Escalated task", failure: "—" },
      { id: "check_rules", kind: "check", row: 0.6, title: "Stay and capacity rules", input: "Arrival date, stock, room turnover", rule: "24 hours’ notice for breakfast; no late checkout with same-day arrival", output: "Eligible / excluded with reason", failure: "Excluded extras are not offered" },
      { id: "check_payment", kind: "check", row: 2.9, title: "Verified payment", input: "Payment provider event", rule: "Event succeeded and matches the purchase", output: "Verified payment reference", failure: "Declined → no confirmation" },
      { id: "check_ack", kind: "check", row: 4.9, title: "Fulfilment acknowledgement", input: "Staff response", rule: "Task owner acknowledges before the stay", output: "Acknowledged by name", failure: "Timer escalates" },
    ],
    edges: [
      { from: "reservation", to: "match", kind: "flow" },
      { from: "match", to: "select", kind: "flow" },
      { from: "select", to: "verify", kind: "flow" },
      { from: "verify", to: "task", kind: "flow" },
      { from: "task", to: "confirm", kind: "flow" },
      { from: "match", to: "unavailable", kind: "return" },
      { from: "unavailable", to: "match", kind: "return", label: "alternative option" },
      { from: "verify", to: "payfailed", kind: "return" },
      { from: "payfailed", to: "select", kind: "return", label: "retry or exit" },
      { from: "task", to: "notack", kind: "return" },
      { from: "notack", to: "task", kind: "return", label: "staff escalation" },
      { from: "check_rules", to: "match", kind: "check" },
      { from: "check_payment", to: "verify", kind: "check" },
      { from: "check_ack", to: "confirm", kind: "check" },
    ],
  },
  demo,
};
