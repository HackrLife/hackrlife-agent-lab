import type { DemoAction, DemoDefinition, Product } from "../types";
import { Sim, aud, DAY, HOUR } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional) — Northside Auto                               */
/* ------------------------------------------------------------------ */

const GARAGE = "Northside Auto";
const ADVISER = "Dan Okafor (service adviser)";
const REVIEW_MONTHS = 3; // technician-set recontact date
const ESTIMATE_VALID_MONTHS = 6;
const MAX_INVITES = 2; // per cycle, 7 days apart
const MAX_POSTPONEMENTS = 1;

interface DeferredJob {
  id: string;
  customerId: string;
  customer: string;
  phone: string;
  vehicle: string;
  work: string;
  note: string;
  technician: string;
  estimateRef: string;
  originalPrice: number;
  currentPrice: number;
  priceReason: string;
  minutes: number;
}

const JOBS: Record<string, DeferredJob> = {
  "Front tyres — Mazda 3 (DJ-5012)": {
    id: "DJ-5012",
    customerId: "C-1187",
    customer: "Priya Nair",
    phone: "0491 570 157",
    vehicle: "2015 Mazda 3 · CRN-18P (V-3452)",
    work: "Replace two front tyres (fitted and balanced)",
    note: "Front tyres at 2.2 mm tread; replacement recommended within 3 months.",
    technician: "Aaron Petrov",
    estimateRef: "EST-2107",
    originalPrice: 398,
    currentPrice: 436,
    priceReason: "Supplier tyre price increased since the original estimate.",
    minutes: 60,
  },
  "Wheel alignment — Corolla (DJ-5019)": {
    id: "DJ-5019",
    customerId: "C-1042",
    customer: "Sam Whitfield",
    phone: "0491 570 006",
    vehicle: "2017 Toyota Corolla hatch · BKZ-42T (V-3310)",
    work: "Four-wheel alignment",
    note: "Steering wheel off-centre and early inner-edge tyre wear; alignment recommended.",
    technician: "Aaron Petrov",
    estimateRef: "EST-2188",
    originalPrice: 129,
    currentPrice: 129,
    priceReason: "",
    minutes: 60,
  },
};

const JOB_OPTIONS = Object.keys(JOBS);
const SLOTS = [
  { day: "Tuesday", time: "08:30", bay: "Bay 2" },
  { day: "Thursday", time: "13:00", bay: "Bay 1" },
];

type Step = "not_due" | "invite" | "refresh" | "slot" | "postponed" | "done";

interface State {
  step: Step;
  months: number;
  cycle: number;
  attempts: number;
  postponements: number;
  estVersion: number;
  price: number;
  bookingRef: string | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function job(sim: Sim<State>): DeferredJob {
  return JOBS[sim.str("job")] ?? JOBS[JOB_OPTIONS[0]];
}

function first(name: string) {
  return name.split(" ")[0];
}

function inviteActions(sim: Sim<State>): DemoAction[] {
  const planned = sim.str("reply", "Book");
  const base: DemoAction[] = [
    { id: "book", label: "Reply “Yes — I’ve got time now, can I book?”", actor: "customer", tone: planned === "Book" ? "primary" : "default" },
    { id: "postpone", label: "Reply “Not yet — remind me in 2 months”", actor: "customer", tone: planned === "Postpone" ? "primary" : "default" },
    { id: "decline", label: "Reply “No thanks, I’ve sorted it elsewhere”", actor: "customer", tone: planned === "Decline" ? "primary" : "danger" },
    { id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. Are the tyres still OK for now?" } },
    { id: "no_reply", label: "Advance clock 7 days (no reply)", actor: "clock" },
  ];
  // Put the visitor's planned reply first.
  return base.sort((a, b) => (b.tone === "primary" ? 1 : 0) - (a.tone === "primary" ? 1 : 0));
}

function deferredRecord(sim: Sim<State>, status: string, tone: "ok" | "warn" | "bad" | "muted" | "default", extra: { label: string; value: string; tone?: "ok" | "warn" | "bad" | "muted" }[] = []) {
  const j = job(sim);
  const existing = sim.getRecord("deferred");
  if (!existing) {
    sim.record({
      id: "deferred",
      title: "Deferred-job record",
      ref: j.id,
      status,
      tone,
      fields: [
        { label: "Customer", value: `${j.customer} (${j.customerId})` },
        { label: "Vehicle", value: j.vehicle },
        { label: "Work", value: j.work },
        { label: "Technician note", value: `${j.note} — ${j.technician}` },
        { label: "Marked", value: `${sim.num("elapsed_months", 3)} months ago` },
        ...extra,
      ],
    });
  } else {
    sim.patch("deferred", { status, tone, fields: extra });
  }
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

function fromReview(sim: Sim<State>) {
  const s = sim.s;
  const j = job(sim);
  sim.emit("review", "passed", `${j.id} reached its review date`, `${s.months} months since the technician deferred it.`);

  // Join to completed repair orders before any contact.
  sim.emit("history", "started", "Joining deferred job to completed repair orders");
  if (sim.bool("completed")) {
    s.step = "done";
    sim.emit("completed", "stopped", "Already completed — RO-7731 matches this work", "Completed at a visit 3 weeks ago. Invitation suppressed.");
    sim.send({ channel: "sms", to: j.phone, summary: `Invitation for ${j.id}`, status: "suppressed" });
    deferredRecord(sim, "Closed — completed on RO-7731", "ok", [{ label: "Closed by", value: "Repair order RO-7731 (completed-work join)", tone: "ok" }]);
    sim.finish("stopped", { kind: "exception", summary: `${j.work} was already completed on RO-7731, so no invitation was sent and the deferred job was closed.` });
    return;
  }
  sim.emit("history", "passed", `No completed repair order matches ${j.id}`);

  sim.emit("outstanding", "started", "Confirming work is still outstanding");
  sim.emit("check_tech", "passed", `Technician-marked work: ${j.technician}`, j.note);
  sim.emit("outstanding", "passed", "Still outstanding; no open booking for this work");
  s.attempts = 0;
  invite(sim);
}

function invite(sim: Sim<State>) {
  const s = sim.s;
  const j = job(sim);
  s.step = "invite";
  s.attempts += 1;
  sim.emit("check_contact", "passed", `Contact allowed: invitation ${s.attempts} of ${MAX_INVITES}`, "SMS consent on file; not opted out; 7 days between messages.");
  const key = `${j.id}:c${s.cycle}:invite${s.attempts}`;
  if (!sim.claim(key, "invite", "invitation")) return;
  sim.send({ channel: "sms", to: j.phone, summary: `Invitation ${s.attempts}/${MAX_INVITES} for ${j.id}${s.cycle > 1 ? " (agreed reminder)" : ""}`, status: "held", opKey: key });
  sim.emit("invite", "waiting", `Invitation ${s.attempts} of ${MAX_INVITES} queued (held)`, undefined, { opKey: key });
  sim.say(
    "assistant",
    s.attempts === 1
      ? `Hi ${first(j.customer)}, it’s ${GARAGE}. At your last visit ${first(j.technician)} noted: “${j.note}” Would you like to book the ${j.work.toLowerCase()} in? Reply BOOK, LATER or NO.`
      : `Hi ${first(j.customer)}, just checking whether you’d like to book the ${j.work.toLowerCase()} we noted last visit. Reply BOOK, LATER or NO.`,
  );
  deferredRecord(sim, "Invited — awaiting reply", "default", [{ label: "Invitations", value: `${s.attempts} of ${MAX_INVITES} (cycle ${s.cycle})` }]);
  sim.wait("waiting_customer", inviteActions(sim));
}

function refresh(sim: Sim<State>) {
  const s = sim.s;
  const j = job(sim);
  sim.emit("refresh", "started", `Checking ${j.estimateRef} v1 against the current price list`);
  const priceChanged = j.currentPrice !== j.originalPrice;
  const expired = s.months > ESTIMATE_VALID_MONTHS;
  if (priceChanged || expired) {
    s.estVersion = 2;
    s.price = j.currentPrice;
    s.step = "refresh";
    const why = priceChanged ? `${aud(j.originalPrice)} → ${aud(j.currentPrice)}. ${j.priceReason}` : `v1 is ${s.months} months old (valid ${ESTIMATE_VALID_MONTHS}); same price re-issued.`;
    sim.emit("pricechg", "waiting", priceChanged ? "Price changed — refreshed estimate requires approval" : "Estimate expired — refreshed estimate requires approval", why);
    sim.record({
      id: "estimate",
      title: "Current estimate",
      ref: `${j.estimateRef} v2`,
      status: "Refreshed — awaiting customer approval",
      tone: "warn",
      fields: [
        { label: "Work", value: j.work },
        { label: "Previous (v1)", value: aud(j.originalPrice), tone: "muted" },
        { label: "Current (v2)", value: aud(j.currentPrice) },
        { label: "Reason", value: priceChanged ? j.priceReason : "Original estimate expired" },
      ],
    });
    sim.send({ channel: "sms", to: j.phone, summary: `Refreshed estimate ${j.estimateRef} v2: ${aud(j.currentPrice)}`, status: "held" });
    sim.say("assistant", `Before booking: the price has been updated since your last visit. ${j.work} is now ${aud(j.currentPrice)} (was ${aud(j.originalPrice)}). Do you approve the updated estimate?`);
    sim.wait("waiting_customer", [
      { id: "approve_refreshed", label: `Approve updated estimate (${aud(j.currentPrice)})`, actor: "customer", tone: "primary" },
      { id: "decline_refreshed", label: "Decline at the new price", actor: "customer", tone: "danger" },
      { id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. OK, that's fine" } },
    ]);
    return;
  }
  s.price = j.originalPrice;
  sim.record({ id: "estimate", title: "Current estimate", ref: `${j.estimateRef} v1`, status: "Current — accepted when deferred", tone: "ok", fields: [{ label: "Work", value: j.work }, { label: "Price", value: aud(j.originalPrice) }] });
  sim.emit("check_quote", "passed", `${j.estimateRef} v1 still current at ${aud(j.originalPrice)}`, "No refresh needed.");
  offerSlots(sim);
}

function offerSlots(sim: Sim<State>) {
  const s = sim.s;
  s.step = "slot";
  sim.emit("refresh", "passed", `${SLOTS.length} workshop slots offered`, SLOTS.map((x) => `${x.day} ${x.time}`).join(" · "));
  sim.say("assistant", `Thanks. I can book you in ${SLOTS.map((x) => `${x.day} at ${x.time}`).join(" or ")}. Which suits?`);
  sim.wait("waiting_customer", [
    ...SLOTS.map((x, i) => ({ id: `slot_${i}`, label: `Choose ${x.day} ${x.time}`, actor: "customer" as const, tone: i === 0 ? ("primary" as const) : ("default" as const) })),
    { id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. Thursday afternoon" } },
  ]);
}

function book(sim: Sim<State>, i: number) {
  const s = sim.s;
  const j = job(sim);
  const slot = SLOTS[i];
  const key = `${j.id}:booking`;
  if (!sim.claim(key, "book", "booking")) return;
  const ref = sim.ref("BK");
  s.bookingRef = ref;
  sim.send({ channel: "calendar", to: `Workshop calendar · ${slot.bay}`, summary: `${ref} ${j.work} ${slot.day} ${slot.time} (${j.minutes} min)`, status: "simulated", opKey: key });
  sim.emit("check_quote", "passed", `Booking references accepted estimate ${j.estimateRef} v${s.estVersion}`, aud(s.price));
  sim.record({
    id: "booking",
    title: "Recovered repair booking",
    ref,
    status: "Confirmed",
    tone: "ok",
    fields: [
      { label: "Work", value: j.work },
      { label: "When", value: `${slot.day} ${slot.time}, ${slot.bay}` },
      { label: "Estimate", value: `${j.estimateRef} v${s.estVersion} · ${aud(s.price)}` },
      { label: "Vehicle", value: j.vehicle },
    ],
  });
  deferredRecord(sim, `Recovered — booked ${ref}`, "ok", [{ label: "Outcome", value: `Booked ${slot.day} ${slot.time}`, tone: "ok" }]);
  sim.send({ channel: "sms", to: j.phone, summary: `Booking ${ref} confirmation`, status: "held", opKey: `${key}:sms` });
  sim.emit("book", "confirmed", `Booked ${ref} and deferred record updated`, undefined, { ref, opKey: key });
  sim.say("assistant", `You’re booked for ${slot.day} at ${slot.time} (ref ${ref}), ${j.work.toLowerCase()} at ${aud(s.price)}.`);
  s.step = "done";
  sim.finish("completed", { kind: "success", summary: `Deferred job ${j.id} recovered: booking ${ref} references the accepted estimate ${j.estimateRef} v${s.estVersion} (${aud(s.price)}).` });
}

function declineOutreach(sim: Sim<State>, reason: string) {
  const j = job(sim);
  sim.s.step = "done";
  sim.emit("declined", "stopped", `Customer declined — outreach ended`, reason);
  sim.emit("check_contact", "stopped", "No further invitations for this job");
  deferredRecord(sim, "Closed — customer declined", "bad", [{ label: "Customer decision", value: reason, tone: "bad" }]);
  sim.say("assistant", "Understood, thanks for letting us know. We won’t message you about this again.");
  sim.finish("stopped", { kind: "exception", summary: `The customer declined ${j.work.toLowerCase()}. The decision is recorded and no further invitations will be sent.` });
}

function postpone(sim: Sim<State>) {
  const s = sim.s;
  const j = job(sim);
  if (s.postponements >= MAX_POSTPONEMENTS) {
    s.step = "done";
    sim.emit("postpone", "stopped", "Second postponement — outreach ended", `Limit is ${MAX_POSTPONEMENTS}. Job stays on the deferred list for the adviser.`);
    deferredRecord(sim, "Open — postponed twice, left for adviser", "warn", [{ label: "Next step", value: `Adviser to raise at next visit (${ADVISER})` }]);
    sim.say("assistant", "No problem. We’ll leave it with you — mention it at your next visit whenever you’re ready.");
    sim.finish("stopped", { kind: "exception", summary: "The customer postponed again, so automated reminders stopped at the limit. The job remains on the deferred list." });
    return;
  }
  s.postponements += 1;
  const key = `${j.id}:reminder`;
  if (!sim.claim(key, "postpone", "reminder")) return;
  const ref = sim.ref("RM");
  sim.send({ channel: "task", to: "Reminder scheduler", summary: `${ref}: re-invite ${j.id} in 2 months`, status: "simulated", opKey: key });
  sim.emit("postpone", "confirmed", `Customer postponed — one reminder set for 2 months`, `Reminder ${ref}. Other invitations cancelled.`, { ref, opKey: key });
  sim.record({ id: "reminder", title: "Agreed future reminder", ref, status: "Scheduled — in 2 months", tone: "default", fields: [{ label: "Job", value: j.id }, { label: "Agreed with customer", value: "Remind in 2 months" }] });
  deferredRecord(sim, "Postponed — reminder agreed", "warn", [{ label: "Customer decision", value: "Postponed 2 months" }]);
  sim.say("assistant", "No problem — I’ll check in again in two months.");
  s.step = "postponed";
  sim.wait("waiting_customer", [
    { id: "advance_reminder", label: "Advance 2 months to the agreed date", actor: "clock", tone: "primary" },
    { id: "postpone_dup", label: "Same reply delivered twice", actor: "customer", hint: "The duplicate must not create a second reminder." },
  ]);
}

function approveRefreshed(sim: Sim<State>) {
  const j = job(sim);
  sim.emit("pricechg", "passed", `Customer approved refreshed estimate v2 (${aud(j.currentPrice)})`);
  sim.emit("check_quote", "passed", "Current quote accepted", `${j.estimateRef} v2`);
  sim.patch("estimate", { status: "v2 accepted by customer", tone: "ok" });
  offerSlots(sim);
  return sim;
}

function declineRefreshed(sim: Sim<State>) {
  const j = job(sim);
  sim.patch("estimate", { status: "v2 declined", tone: "bad" });
  declineOutreach(sim, `Declined refreshed estimate at ${aud(j.currentPrice)}`);
  return sim;
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Interactive simulation using a sample deferred-work report and repair history. No message is sent and no real booking or reminder is created.",
  assistantName: `${GARAGE} follow-up`,
  channelLabel: "SMS thread",
  fields: [
    { kind: "select", name: "job", label: "Deferred job", options: JOB_OPTIONS, helper: "The tyre price has changed since the estimate; the alignment price has not." },
    { kind: "number", name: "elapsed_months", label: "Time since deferred", min: 1, max: 12, suffix: "months", helper: "Review date is 3 months; estimates are valid for 6." },
    { kind: "toggle", name: "completed", label: "Work completed since (at another visit)" },
    { kind: "select", name: "reply", label: "Customer’s intended reply", options: ["Book", "Postpone", "Decline"], helper: "Highlights that reply; you can still choose any." },
  ],
  scenarios: [
    { id: "recover_tyres", label: "Ready to book tyres", kind: "success", description: "Tyres postponed 3 months ago; the price has since risen, so the refreshed estimate is approved first.", inputs: { job: JOB_OPTIONS[0], elapsed_months: 3, completed: false, reply: "Book" } },
    { id: "unchanged_price", label: "Price unchanged", kind: "success", description: "Alignment deferred 3 months ago at the same price. Straight to a slot.", inputs: { job: JOB_OPTIONS[1], elapsed_months: 3, completed: false, reply: "Book" } },
    { id: "already_completed", label: "Already completed", kind: "exception", description: "The tyres were fitted at another visit. The invitation is suppressed.", inputs: { job: JOB_OPTIONS[0], elapsed_months: 3, completed: true, reply: "Book" } },
    { id: "postpone", label: "Customer postpones", kind: "exception", description: "The customer asks for a reminder in two months. Exactly one reminder is created.", inputs: { job: JOB_OPTIONS[0], elapsed_months: 3, completed: false, reply: "Postpone" } },
    { id: "decline", label: "Customer declines", kind: "exception", description: "The customer had it done elsewhere. Outreach ends.", inputs: { job: JOB_OPTIONS[1], elapsed_months: 3, completed: false, reply: "Decline" } },
    { id: "not_yet_due", label: "Not yet at review date", kind: "exception", description: "Deferred one month ago. Nothing is sent until the review date.", inputs: { job: JOB_OPTIONS[1], elapsed_months: 1, completed: false, reply: "Book" } },
  ],
  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("repair-follow-up", scenarioId, inputs, {
      step: "not_due",
      months: 0,
      cycle: 1,
      attempts: 0,
      postponements: 0,
      estVersion: 1,
      price: 0,
      bookingRef: null,
    });
    const s = sim.s;
    const j = job(sim);
    s.months = Math.max(0, Math.round(sim.num("elapsed_months", 3)));
    sim.emit("review", "started", `Deferred job ${j.id} on the report`, `${j.work} · ${j.customer}`);
    deferredRecord(sim, "Deferred — awaiting review date", "muted");
    if (s.months < REVIEW_MONTHS) {
      const wait = REVIEW_MONTHS - s.months;
      sim.emit("review", "waiting", `Review date in ${wait} month${wait === 1 ? "" : "s"} — no contact yet`);
      return sim.wait("running", [{ id: "advance_review", label: `Advance ${wait} month${wait === 1 ? "" : "s"} to the review date`, actor: "clock", tone: "primary" }]).done();
    }
    fromReview(sim);
    return sim.done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;
    const j = job(sim);

    switch (actionId) {
      case "advance_review": {
        if (s.step !== "not_due") return sim.done();
        const wait = REVIEW_MONTHS - s.months;
        sim.advance(wait * 30 * DAY);
        s.months = REVIEW_MONTHS;
        fromReview(sim);
        return sim.done();
      }

      case "no_reply": {
        if (s.step !== "invite") return sim.done();
        sim.advance(7 * DAY);
        if (s.attempts >= MAX_INVITES) {
          s.step = "done";
          sim.emit("check_contact", "stopped", `Contact limit reached (${MAX_INVITES} of ${MAX_INVITES})`, "No further messages this cycle.");
          deferredRecord(sim, "Open — no reply, back on deferred list", "warn");
          return sim.finish("stopped", { kind: "exception", summary: `No reply after ${MAX_INVITES} invitations, so outreach stopped at the contact limit. The job stays on the deferred list.` }).done();
        }
        invite(sim);
        return sim.done();
      }

      case "book": {
        if (s.step !== "invite") return sim.done();
        sim.advance(2 * HOUR);
        sim.say("customer", "Yes — I’ve got time now, can I book?");
        sim.emit("invite", "passed", "Customer wants to book");
        refresh(sim);
        return sim.done();
      }

      case "postpone": {
        if (s.step !== "invite") return sim.done();
        sim.advance(2 * HOUR);
        sim.say("customer", "Not yet — can you remind me in 2 months?");
        postpone(sim);
        return sim.done();
      }

      case "postpone_dup": {
        if (s.step !== "postponed") return sim.done();
        sim.say("customer", "Not yet — can you remind me in 2 months?");
        sim.claim(`${j.id}:reminder`, "postpone", "reminder");
        sim.say("system", "Same reply received again: the reminder already exists, so none was added.");
        return sim.done();
      }

      case "advance_reminder": {
        if (s.step !== "postponed") return sim.done();
        sim.advance(60 * DAY);
        s.months += 2;
        s.cycle += 1;
        sim.patch("reminder", { status: "Fired — agreed date reached", tone: "ok" });
        sim.emit("postpone", "passed", "Agreed reminder date reached", "Re-checking repair history before contacting.");
        fromReview(sim);
        return sim.done();
      }

      case "decline": {
        if (s.step !== "invite") return sim.done();
        sim.advance(2 * HOUR);
        sim.say("customer", "No thanks, I’ve sorted it elsewhere.");
        declineOutreach(sim, "Had the work done elsewhere");
        return sim.done();
      }

      case "approve_refreshed": {
        if (s.step !== "refresh") return sim.done();
        sim.advance(1 * HOUR);
        sim.say("customer", `Yes, I approve the updated estimate at ${aud(j.currentPrice)}.`);
        return approveRefreshed(sim).done();
      }

      case "decline_refreshed": {
        if (s.step !== "refresh") return sim.done();
        sim.say("customer", "That’s more than I expected — I’ll leave it for now.");
        return declineRefreshed(sim).done();
      }

      case "slot_0":
      case "slot_1": {
        if (s.step !== "slot") return sim.done();
        const i = actionId === "slot_0" ? 0 : 1;
        sim.advance(10);
        sim.say("customer", `${SLOTS[i].day} at ${SLOTS[i].time} please.`);
        book(sim, i);
        return sim.done();
      }

      case "free": {
        const text = String(payload ?? "").trim();
        const t = text.toLowerCase();
        if (!["invite", "refresh", "slot"].includes(s.step)) return sim.done();
        sim.advance(1 * HOUR);
        sim.say("customer", text || "…");

        if (s.step === "invite") {
          if (/\bstop\b|unsubscribe|don.?t (contact|message)/.test(t)) {
            declineOutreach(sim, "Asked not to be contacted");
            return sim.done();
          }
          if (/(worse|safe|still ok|legal|how bad|last longer|need it)/.test(t)) {
            sim.emit("check_tech", "info", "Condition question — no new diagnosis given", "Only the technician’s recorded note is repeated.");
            sim.say("assistant", `I can’t assess the car by message. At your last visit ${first(j.technician)} noted: “${j.note}” The technician will check it again when you come in. Would you like to book?`);
            return sim.wait("waiting_customer", inviteActions(sim)).done();
          }
          if (/(price|cost|cheap|how much|discount)/.test(t)) {
            sim.emit("invite", "info", "Price question — current estimate will be shown before booking", "The assistant does not change prices.");
            sim.say("assistant", "I can’t change prices, but if you’d like to book I’ll show you the current estimate to approve first.");
            return sim.wait("waiting_customer", inviteActions(sim)).done();
          }
          if (/(later|month|not now|not yet|postpone|remind|next)/.test(t)) {
            postpone(sim);
            return sim.done();
          }
          if (/^(no|nope|nah)\b|decline|elsewhere|not interested/.test(t)) {
            declineOutreach(sim, `Replied: “${text}”`);
            return sim.done();
          }
          if (/^(yes|yep|yeah|ok|sure)\b|book|come in|got time/.test(t)) {
            sim.emit("invite", "passed", "Customer wants to book");
            refresh(sim);
            return sim.done();
          }
          sim.emit("invite", "info", "Reply not understood — asking again");
          sim.say("assistant", "Sorry, I didn’t catch that. Reply BOOK to arrange it, LATER for a reminder, or NO if you don’t need it.");
          return sim.wait("waiting_customer", inviteActions(sim)).done();
        }

        if (s.step === "refresh") {
          if (/(cheap|discount|lower|too much|expensive)/.test(t)) {
            sim.emit("pricechg", "info", "Price objection — price not changed", "Only the service adviser can change an estimate.");
            sim.say("assistant", `I can’t change the price. You can approve the updated estimate at ${aud(j.currentPrice)} or decline it.`);
            return sim.done();
          }
          if (/^(yes|yep|ok|okay|sure|fine|approve)|that.?s fine|go ahead/.test(t)) return approveRefreshed(sim).done();
          if (/^(no|nope|nah)\b|decline|leave it/.test(t)) return declineRefreshed(sim).done();
          sim.emit("pricechg", "info", "Reply not understood — asking again");
          sim.say("assistant", `Do you approve the updated estimate of ${aud(j.currentPrice)}? Please reply yes or no.`);
          return sim.done();
        }

        // slot
        const i = SLOTS.findIndex((x) => t.includes(x.day.toLowerCase()) || t.includes(x.day.slice(0, 3).toLowerCase()) || t.includes(x.time));
        if (i >= 0) {
          book(sim, i);
          return sim.done();
        }
        sim.emit("refresh", "info", "Slot not recognised — asking again");
        sim.say("assistant", `Sorry, which suits: ${SLOTS.map((x) => `${x.day} ${x.time}`).join(" or ")}?`);
        return sim.done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const repairFollowUp: Product = {
  id: "repair-follow-up",
  no: 8,
  slug: "repair-follow-up",
  name: "Repair Follow-up",
  outcome: "Recover work customers postponed.",
  sectorLabel: "Independent automotive",
  sectors: ["Automotive"],
  outcomes: ["Convert sales", "Grow repeat business"],
  definition:
    "Identifies repairs a technician marked as deferred, checks the repair history to confirm the work is still outstanding and invites the customer back when the agreed review date arrives. It refreshes the estimate when the price has changed and records the customer’s decision to book, postpone or decline.",
  situation:
    "Three months ago a customer postponed two recommended front tyres. The tyre price has gone up since, and nobody is sure whether the tyres were fitted elsewhere or at a later visit. The deferred-work report sits unread.",
  endState:
    "Every deferred job either comes back as a booking at a price the customer approved, has one agreed reminder, or is closed with the customer’s decision. No one is chased for work already done.",
  handles: [
    "Joins deferred jobs to completed repair orders before any contact",
    "Invites the customer using the technician’s own note",
    "Refreshes changed or expired estimates and asks for approval before booking",
    "Records book, postpone or decline, with one reminder per postponement",
    "Stops at the contact limit and on decline or opt-out",
  ],
  boundaries: [
    "Makes no new diagnosis — only the technician’s recorded note is used",
    "Never books against an out-of-date price",
    "Never contacts customers about work already completed",
  ],
  delivered: [
    { title: "Booking confirmation", body: "Work, time and the accepted estimate version and price, sent to the customer and written to the workshop calendar." },
    { title: "Agreed reminder", body: "One dated reminder per postponement, with earlier invitations cancelled and the job still visible to the adviser." },
    { title: "Deferred-job record", body: "Status from deferred to recovered, postponed or closed, with the customer’s decision and the reason." },
  ],
  deployment: {
    rules: [
      "Which deferred work is eligible and the technician’s review dates",
      "Estimate validity and when a price change needs re-approval",
      "Contact limits, spacing and consent by channel",
      "How many postponements before the job returns to the adviser",
    ],
    systems: ["Repair history", "Deferred-work report", "Current estimates and price list", "Workshop calendar", "SMS or email"],
  },
  measures: ["Completed recovered jobs", "Contribution margin from deferred work"],
  reliability: [
    "Invitations sent for work already completed (target: zero)",
    "Bookings made on a superseded price (target: zero)",
    "Reminders created per postponement (target: exactly one)",
  ],
  harness: {
    systems:
      "Production reads repair history and the deferred-work report, checks current estimates and writes to the workshop calendar and messaging. The demo uses two fictional Northside Auto deferred jobs, a fixed price list and an outbox that holds every message.",
    controls: [
      "Only technician-selected deferred work is eligible",
      "Completed-work suppression before any contact",
      "No new diagnosis; the technician’s note is quoted as recorded",
      "Current estimate required; changes need customer approval",
      "Contact limits: two invitations per cycle, one postponement",
    ],
  },
  ctaLine: "Want this working through your deferred-work report?",
  graph: {
    nodes: [
      { id: "review", kind: "action", row: 0, title: "Deferred work reaches review date", input: "Deferred-work report", rule: "Technician-set review date (3 months)", output: "Job due for follow-up", failure: "Before review date → no contact", system: "Deferred-work report (demo: fixture)" },
      { id: "history", kind: "action", row: 1, title: "Check repair history", input: "Deferred job", rule: "Join to completed repair orders", output: "Outstanding or completed", failure: "Completed → suppress", system: "Repair history (demo: fixture)" },
      { id: "outstanding", kind: "action", row: 2, title: "Confirm work still outstanding", input: "Job with no completed match", rule: "Technician-marked; no open booking", output: "Eligible job", failure: "—", system: "Garage management system (demo: fixture)" },
      { id: "invite", kind: "action", row: 3, title: "Invite customer to return", input: "Eligible job, contact rules", rule: "Technician’s note only; max 2 per cycle", output: "Invitation in outbox", failure: "Postpone / decline / no reply", system: "SMS (demo: held outbox)" },
      { id: "refresh", kind: "action", row: 4, title: "Refresh estimate and select slot", input: "Booking request", rule: "Compare with current price list and validity", output: "Current estimate + slot choice", failure: "Price changed → approval required", system: "Estimates + calendar (demo: fixture)" },
      { id: "book", kind: "action", row: 5, title: "Book and update deferred record", input: "Chosen slot, accepted estimate", rule: "One booking per job operation key", output: "Booking + recovered record", failure: "—", system: "Workshop calendar (demo: simulated)" },
      { id: "completed", kind: "branch", row: 0.6, title: "Already completed", input: "Completed repair order matches", rule: "Suppress contact; close job", output: "Closed deferred record", failure: "—" },
      { id: "postpone", kind: "branch", row: 2.5, title: "Customer postpones", input: "Postpone reply", rule: "One reminder at the agreed date; max 1", output: "Scheduled reminder", failure: "—" },
      { id: "declined", kind: "branch", row: 3.3, title: "Customer declines", input: "Decline or opt-out", rule: "End outreach; record decision", output: "Closed deferred record", failure: "—" },
      { id: "pricechg", kind: "branch", row: 4.3, title: "Price changed", input: "Current price ≠ estimate, or expired", rule: "Refreshed estimate needs approval", output: "Estimate v2", failure: "—" },
      { id: "check_tech", kind: "check", row: 1.6, title: "Technician marked work", input: "Deferred job", rule: "Technician-selected; note quoted, no new diagnosis", output: "Eligible", failure: "Not marked → not contacted" },
      { id: "check_contact", kind: "check", row: 3, title: "Contact eligibility", input: "Consent, attempts, decisions", rule: "Consent; 2 per cycle, 7 days apart; stop on decline", output: "Allow / stop", failure: "Limit or decline → stop" },
      { id: "check_quote", kind: "check", row: 5, title: "Current quote accepted", input: "Estimate version", rule: "Booking must reference the accepted current version", output: "Accepted estimate", failure: "Not accepted → no booking" },
    ],
    edges: [
      { from: "review", to: "history", kind: "flow" },
      { from: "history", to: "outstanding", kind: "flow" },
      { from: "outstanding", to: "invite", kind: "flow" },
      { from: "invite", to: "refresh", kind: "flow" },
      { from: "refresh", to: "book", kind: "flow" },
      { from: "history", to: "completed", kind: "return" },
      { from: "invite", to: "postpone", kind: "return" },
      { from: "postpone", to: "review", kind: "return", label: "agreed date" },
      { from: "invite", to: "declined", kind: "return" },
      { from: "refresh", to: "pricechg", kind: "return" },
      { from: "pricechg", to: "refresh", kind: "return", label: "approval required" },
      { from: "check_tech", to: "outstanding", kind: "check" },
      { from: "check_contact", to: "invite", kind: "check" },
      { from: "check_quote", to: "book", kind: "check" },
    ],
  },
  demo,
};
