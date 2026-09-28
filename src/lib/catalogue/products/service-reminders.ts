import type { DemoAction, DemoDefinition, Product } from "../types";
import { Sim, aud, DAY, HOUR } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional) — Northside Auto                               */
/* ------------------------------------------------------------------ */

const GARAGE = "Northside Auto";
const CUSTOMER = { id: "C-1042", name: "Sam Whitfield", phone: "0491 570 006" };
const VEHICLE = { id: "V-3310", label: "2017 Toyota Corolla hatch", rego: "BKZ-42T" };
const LAST_SERVICE = { ref: "RO-7702", odometer: 84200 };
const SERVICE_PRICE = 329; // approved price list: standard logbook service
const SERVICE_MINUTES = 180;
const MAX_REMINDERS = 2; // per cycle, 7 days apart
const READING_FRESH_MONTHS = 3; // older odometer readings are treated as unknown
const MAX_CHECKS = 12;

interface Rule {
  label: string;
  months: number | null;
  km: number;
}

const RULES: Record<string, Rule> = {
  "12 months or 15,000 km": { label: "12 months or 15,000 km, whichever comes first", months: 12, km: 15000 },
  "6 months or 10,000 km": { label: "6 months or 10,000 km, whichever comes first (severe use)", months: 6, km: 10000 },
  "10,000 km only (high-use)": { label: "10,000 km only — no date-based reminder (high-use vehicle)", months: null, km: 10000 },
};
const RULE_OPTIONS = Object.keys(RULES);

const SLOTS = [
  { day: "Tuesday", time: "08:00", bay: "Bay 1" },
  { day: "Friday", time: "08:00", bay: "Bay 1" },
];

type Step = "ask_mileage" | "offer" | "not_due" | "booked" | "done";

interface State {
  step: Step;
  months: number;
  odometer: number | null;
  readingAgeMonths: number;
  reminders: number;
  mileageRequests: number;
  checks: number;
  cycle: number;
  bookingRef: string | null;
  roRef: string | null;
}

type Level = "overdue" | "due" | "due soon" | "not due" | "unknown" | "n/a";

/* ------------------------------------------------------------------ */
/* Deterministic due calculation                                       */
/* ------------------------------------------------------------------ */

function rule(sim: Sim<State>): Rule {
  return RULES[sim.str("interval")] ?? RULES[RULE_OPTIONS[0]];
}

function fmtKm(n: number) {
  return `${n.toLocaleString("en-AU")} km`;
}

function evaluate(sim: Sim<State>) {
  const r = rule(sim);
  const s = sim.s;
  let date: Level = "n/a";
  let dateText = "No date component in this rule";
  if (r.months !== null) {
    date = s.months > r.months ? "overdue" : s.months === r.months ? "due" : s.months >= r.months - 1 ? "due soon" : "not due";
    dateText = `${s.months} of ${r.months} months → ${date}`;
  }
  const fresh = s.odometer !== null && s.readingAgeMonths <= READING_FRESH_MONTHS;
  let km: Level = "unknown";
  let kmSince: number | null = null;
  let kmText = s.odometer === null ? "Unknown — not estimated" : `Reading ${fmtKm(s.odometer)} is ${s.readingAgeMonths} months old — treated as unknown, not extrapolated`;
  if (fresh && s.odometer !== null) {
    kmSince = s.odometer - LAST_SERVICE.odometer;
    km = kmSince >= r.km ? "overdue" : kmSince >= r.km - 1000 ? "due soon" : "not due";
    kmText = `${fmtKm(s.odometer)} − ${fmtKm(LAST_SERVICE.odometer)} = ${fmtKm(kmSince)} of ${fmtKm(r.km)} → ${km}`;
  }
  const dueByDate = ["overdue", "due", "due soon"].includes(date);
  const dueByKm = ["overdue", "due soon"].includes(km);
  const due = dueByDate || dueByKm;
  const basis = dueByDate && dueByKm ? "date and mileage" : dueByDate ? "date" : dueByKm ? "mileage" : "none";
  const monthsToWindow = r.months !== null ? Math.max(1, r.months - 1 - s.months) : 1;
  return { r, date, dateText, km, kmText, kmSince, due, basis, dueByDate, dueByKm, monthsToWindow };
}

type Eval = ReturnType<typeof evaluate>;

function statusLine(e: Eval) {
  if (e.due) return `Due by ${e.basis}${e.km === "unknown" && e.dueByDate ? " (mileage unknown)" : ""}`;
  if (e.km === "unknown") return "Not due by date; mileage unknown";
  return "Not due";
}

function dueRecord(sim: Sim<State>, e: Eval) {
  const s = sim.s;
  sim.record({
    id: "due",
    title: "Due calculation",
    status: statusLine(e),
    tone: e.due ? "warn" : e.km === "unknown" ? "muted" : "ok",
    fields: [
      { label: "Approved rule", value: e.r.label },
      { label: "Last service", value: `${LAST_SERVICE.ref} · ${s.months} months ago at ${fmtKm(LAST_SERVICE.odometer)}` },
      { label: "Date rule", value: e.dateText, tone: e.dueByDate ? "warn" : "default" },
      { label: "Mileage rule", value: e.kmText, tone: e.km === "unknown" ? "muted" : e.dueByKm ? "warn" : "default" },
      { label: "Reminder basis", value: e.due ? `Permitted: due by ${e.basis}` : e.r.months === null && e.km === "unknown" ? "Not permitted — rule is mileage-only and mileage is unknown" : "Not due — no reminder" },
    ],
  });
}

function reminderState(sim: Sim<State>, status: string, tone: "ok" | "warn" | "bad" | "muted" | "default", fields: { label: string; value: string; tone?: "ok" | "warn" | "bad" | "muted" }[] = []) {
  if (!sim.getRecord("reminder")) {
    sim.record({ id: "reminder", title: "Reminder state", ref: VEHICLE.id, status, tone, fields: [{ label: "Vehicle", value: `${VEHICLE.label} · ${VEHICLE.rego}` }, { label: "Customer", value: `${CUSTOMER.name} (${CUSTOMER.id})` }, ...fields] });
  } else {
    sim.patch("reminder", { status, tone, fields });
  }
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

function mileageActions(): DemoAction[] {
  return [
    { id: "mileage_high", label: "Reply “Odometer says 99,800 km”", actor: "customer" },
    { id: "mileage_low", label: "Reply “It’s on 88,000 km”", actor: "customer" },
  ];
}

function offerActions(e: Eval): DemoAction[] {
  return [
    ...SLOTS.map((x, i) => ({ id: `slot_${i}`, label: `Book ${x.day} ${x.time}`, actor: "customer" as const, tone: i === 0 ? ("primary" as const) : ("default" as const) })),
    ...(e.km === "unknown" ? mileageActions() : []),
    { id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. It's on 97,500 km" } },
    { id: "no_reply", label: "Advance clock 7 days (no reply)", actor: "clock" },
  ];
}

function runCheck(sim: Sim<State>) {
  const s = sim.s;
  s.checks += 1;
  sim.emit("history", "started", `Reading service history for ${VEHICLE.id}`, `${VEHICLE.label} · ${VEHICLE.rego}`);
  sim.emit("history", "passed", `Last service ${LAST_SERVICE.ref}: ${s.months} months ago at ${fmtKm(LAST_SERVICE.odometer)}`);

  if (sim.bool("future_booking")) {
    s.step = "done";
    sim.emit("booked", "stopped", "Future service already booked — contact suppressed", "BK-6120 on the workshop calendar in 9 days.");
    sim.send({ channel: "sms", to: CUSTOMER.phone, summary: "Service reminder", status: "suppressed" });
    reminderState(sim, "Paused — service already booked (BK-6120)", "ok");
    sim.finish("stopped", { kind: "exception", summary: "A service is already booked for this vehicle, so no reminder was sent. Reminders resume after that service is completed." });
    return;
  }
  evaluateAndRoute(sim, "check");
}

/** origin: "check" = scheduled check, "reply" = customer just supplied mileage. */
function evaluateAndRoute(sim: Sim<State>, origin: "check" | "reply") {
  const s = sim.s;
  const e = evaluate(sim);
  sim.emit("evaluate", "started", "Evaluating date and mileage rules");
  sim.emit("check_rules", "passed", `Approved rule: ${e.r.label}`, `${e.dateText}. ${e.kmText}.`);
  dueRecord(sim, e);
  sim.emit("evaluate", "passed", statusLine(e));

  if (e.km === "unknown") {
    sim.emit("check_unknown", "passed", "Mileage unknown — not estimated", e.dueByDate ? "Date rule permits the reminder; mileage is requested, not assumed." : "No due claim is made without mileage.");
  }

  // Not due and mileage unknown: ask for it (no due claim).
  if (!e.due && e.km === "unknown") {
    if (s.mileageRequests >= 1 && origin === "check") {
      nextCheck(sim, e, "Mileage still unknown after one request");
      return;
    }
    askMileage(sim, e);
    return;
  }
  sim.emit("determine", "started", "Determining eligible due service");
  if (!e.due) {
    nextCheck(sim, e, "Date and mileage both below the due window");
    return;
  }
  sim.emit("determine", "passed", `Standard logbook service due by ${e.basis}`);
  offer(sim, e, origin);
}

function askMileage(sim: Sim<State>, e: Eval) {
  const s = sim.s;
  s.step = "ask_mileage";
  s.mileageRequests += 1;
  const key = `${VEHICLE.id}:c${s.cycle}:mileage-request`;
  if (!sim.claim(key, "askmileage", "mileage request")) return;
  sim.send({ channel: "sms", to: CUSTOMER.phone, summary: "Odometer request (no due claim)", status: "held", opKey: key });
  sim.emit("askmileage", "waiting", "Asked for current odometer reading", e.r.months === null ? "Mileage-only rule: no date-based reminder is permitted." : "Not due by date; mileage needed to check.", { opKey: key });
  sim.say("assistant", `Hi ${CUSTOMER.name.split(" ")[0]}, it’s ${GARAGE}. To keep your ${VEHICLE.label}’s service schedule accurate, could you reply with the current odometer reading?`);
  reminderState(sim, "Waiting for mileage", "muted", [{ label: "Cycle", value: String(s.cycle) }]);
  sim.wait("waiting_customer", [
    ...mileageActions(),
    { id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. 97,500 km" } },
    { id: "no_reply", label: "Advance clock 7 days (no reply)", actor: "clock" },
  ]);
}

function nextCheck(sim: Sim<State>, e: Eval, why: string) {
  const s = sim.s;
  if (s.checks >= MAX_CHECKS) {
    s.step = "done";
    sim.emit("notdue", "stopped", "Check limit reached for this demo");
    sim.finish("stopped", { kind: "exception", summary: "The vehicle did not become due within the demo’s check limit. No reminder was sent." });
    return;
  }
  s.step = "not_due";
  const n = e.monthsToWindow;
  sim.emit("notdue", "info", `Not due — next check in ${n} month${n === 1 ? "" : "s"}`, why);
  reminderState(sim, `Not due — next check in ${n} month${n === 1 ? "" : "s"}`, "default", [{ label: "Cycle", value: String(s.cycle) }]);
  sim.wait("running", [{ id: "advance_check", label: `Advance ${n} month${n === 1 ? "" : "s"} to the next check`, actor: "clock", tone: "primary" }]);
}

function offer(sim: Sim<State>, e: Eval, origin: "check" | "reply") {
  const s = sim.s;
  s.step = "offer";
  sim.emit("offer", "started", "Offering available appointments", "Contact preference: SMS allowed.");
  const service = `a standard logbook service (${aud(SERVICE_PRICE)}, about ${SERVICE_MINUTES / 60} hours)`;
  const slotText = SLOTS.map((x) => `${x.day} ${x.time}`).join(" or ");
  if (origin === "reply") {
    sim.say("assistant", `Thanks — that puts it at ${e.kmSince !== null ? fmtKm(e.kmSince) : "unknown distance"} since the last service, so it’s ${statusLine(e).toLowerCase()}. I can book ${service} ${slotText}.`);
    sim.emit("offer", "waiting", "Updated due status sent with appointments");
    reminderState(sim, `Reminded — ${statusLine(e)}`, "warn");
    sim.wait("waiting_customer", offerActions(e));
    return;
  }
  s.reminders += 1;
  const key = `${VEHICLE.id}:c${s.cycle}:reminder${s.reminders}`;
  if (!sim.claim(key, "offer", "reminder")) return;
  sim.send({ channel: "sms", to: CUSTOMER.phone, summary: `Service reminder ${s.reminders}/${MAX_REMINDERS} (${statusLine(e)})`, status: "held", opKey: key });
  sim.emit("offer", "waiting", `Reminder ${s.reminders} of ${MAX_REMINDERS} queued (held)`, undefined, { opKey: key });
  const why = e.dueByDate && e.dueByKm ? "by date and mileage" : e.dueByDate ? `by date (${s.months} months since the last service)` : `by mileage (${fmtKm(e.kmSince ?? 0)} since the last service)`;
  sim.say(
    "assistant",
    `Hi ${CUSTOMER.name.split(" ")[0]}, your ${VEHICLE.label} is ${e.dueByDate && e.date === "due soon" && !e.dueByKm ? "due soon" : "due"} for its service ${why}. I can book ${service} ${slotText}.` +
      (e.km === "unknown" ? " If you can, reply with the current odometer reading too — we haven’t got a recent one." : ""),
  );
  reminderState(sim, `Reminded — ${statusLine(e)}`, "warn", [{ label: "Reminders this cycle", value: `${s.reminders} of ${MAX_REMINDERS}` }]);
  sim.wait("waiting_customer", offerActions(e));
}

function submitMileage(sim: Sim<State>, km: number) {
  const s = sim.s;
  if (km < LAST_SERVICE.odometer || km > LAST_SERVICE.odometer + 150000) {
    sim.emit("mileage", "blocked", "Reading rejected — outside plausible range", `Must be at least ${fmtKm(LAST_SERVICE.odometer)} (last recorded).`);
    sim.say("assistant", `That’s ${km < LAST_SERVICE.odometer ? "lower than the reading we recorded at the last service" : "much higher than expected"}. Could you check the odometer and send it again?`);
    return;
  }
  const before = sim.getRecord("due")?.status ?? "—";
  s.odometer = km;
  s.readingAgeMonths = 0;
  sim.emit("mileage", "passed", `Mileage supplied: ${fmtKm(km)} — recalculating`, `Due state before: ${before}.`);
  evaluateAndRoute(sim, "reply");
}

function book(sim: Sim<State>, i: number) {
  const s = sim.s;
  const slot = SLOTS[i];
  const key = `${VEHICLE.id}:c${s.cycle}:booking`;
  if (!sim.claim(key, "book", "booking")) return;
  const ref = sim.ref("BK");
  s.bookingRef = ref;
  s.roRef = sim.ref("RO");
  sim.send({ channel: "calendar", to: `Workshop calendar · ${slot.bay}`, summary: `${ref} logbook service ${slot.day} ${slot.time} (${SERVICE_MINUTES} min)`, status: "simulated", opKey: key });
  sim.record({
    id: "booking",
    title: "Booking confirmation",
    ref,
    status: "Confirmed",
    tone: "ok",
    fields: [
      { label: "Service", value: `Standard logbook service · ${aud(SERVICE_PRICE)}` },
      { label: "When", value: `${slot.day} ${slot.time}, ${slot.bay}` },
      { label: "Vehicle", value: `${VEHICLE.label} · ${VEHICLE.rego}` },
      { label: "Odometer", value: s.odometer !== null && s.readingAgeMonths <= READING_FRESH_MONTHS ? `${fmtKm(s.odometer)} (customer supplied)` : "Unknown — recorded at the service", tone: s.odometer !== null ? "default" : "muted" },
    ],
  });
  sim.send({ channel: "sms", to: CUSTOMER.phone, summary: `Booking ${ref} confirmation`, status: "held", opKey: `${key}:sms` });
  sim.emit("book", "confirmed", `Booked ${ref} — reminders paused`, undefined, { ref, opKey: key });
  reminderState(sim, `Booked ${ref} — reminders paused until completion`, "ok");
  sim.say("assistant", `Booked: ${slot.day} at ${slot.time}, reference ${ref}. We’ll stop reminders now.`);
  s.step = "booked";
  sim.wait("waiting_staff", [
    { id: "complete", label: "Workshop: mark service completed", actor: "staff", tone: "primary" },
    { id: "complete_twice", label: "Completion event delivered twice", actor: "staff", hint: "The replay must not reset the cycle again." },
  ]);
}

function complete(sim: Sim<State>, times: number) {
  const s = sim.s;
  const r = rule(sim);
  const odo = s.odometer !== null && s.readingAgeMonths <= READING_FRESH_MONTHS ? s.odometer + 40 : 99850;
  const key = `${s.roRef}:completed`;
  for (let n = 0; n < times; n++) {
    if (!sim.claim(key, "book", "completion event")) continue;
    sim.advance(4 * DAY);
    sim.send({ channel: "crm", to: "Service history", summary: `${s.roRef} completed at ${fmtKm(odo)}`, status: "simulated", opKey: key });
    const nextDate = r.months !== null ? `${r.months} months from completion` : "No date component";
    const nextKm = fmtKm(odo + r.km);
    sim.emit("check_complete", "passed", "Completion resets the cycle once", `${s.roRef} at ${fmtKm(odo)}. Next due: ${nextDate} or ${nextKm}.`, { ref: s.roRef ?? undefined, opKey: key });
    s.cycle += 1;
    reminderState(sim, `Reset — cycle ${s.cycle} started`, "ok", [
      { label: "Last service", value: `${s.roRef} at ${fmtKm(odo)}` },
      { label: "Next due (date)", value: nextDate },
      { label: "Next due (mileage)", value: nextKm },
      { label: "Cycle", value: String(s.cycle) },
    ]);
    sim.patch("booking", { status: "Completed", tone: "ok" });
    sim.emit("book", "passed", "Reminder state reset for the next cycle");
  }
  if (times > 1) sim.say("system", "The completion event arrived twice. The second copy carried the same operation key and was ignored, so the cycle reset once.");
  s.step = "done";
  sim.finish("completed", { kind: "success", summary: `Service ${s.bookingRef} was booked and completed (${s.roRef}), and the reminder cycle reset once from the recorded odometer. No further reminders until the next due date.` });
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Interactive simulation using a sample service history and workshop calendar. No reminder is sent and no real booking is created.",
  assistantName: `${GARAGE} reminders`,
  channelLabel: "SMS thread",
  fields: [
    { kind: "number", name: "last_service_months", label: "Last service", min: 0, max: 24, suffix: "months ago" },
    { kind: "select", name: "interval", label: "Approved due interval", options: RULE_OPTIONS },
    { kind: "select", name: "mileage", label: "Mileage", options: ["Known", "Unknown"] },
    { kind: "number", name: "odometer", label: "Latest odometer reading", min: 0, max: 400000, step: 100, suffix: "km", helper: "Used only when mileage is known. Last service was at 84,200 km." },
    { kind: "toggle", name: "future_booking", label: "Future service already booked" },
  ],
  scenarios: [
    { id: "mileage_missing", label: "Due by date, mileage missing", kind: "success", description: "Twelve months since the last service and no recent odometer. The customer supplies it before booking.", inputs: { last_service_months: 12, interval: RULE_OPTIONS[0], mileage: "Unknown", odometer: 0, future_booking: false } },
    { id: "due_by_mileage", label: "Due by mileage", kind: "success", description: "Only 8 months, but 15,400 km driven since the last service.", inputs: { last_service_months: 8, interval: RULE_OPTIONS[0], mileage: "Known", odometer: 99600, future_booking: false } },
    { id: "already_booked", label: "Service already booked", kind: "exception", description: "A service is already on the calendar. No reminder is sent.", inputs: { last_service_months: 11, interval: RULE_OPTIONS[0], mileage: "Known", odometer: 97000, future_booking: true } },
    { id: "not_due", label: "Not due yet", kind: "exception", description: "Five months and 5,900 km. Advance the clock to the next check.", inputs: { last_service_months: 5, interval: RULE_OPTIONS[0], mileage: "Known", odometer: 90100, future_booking: false } },
    { id: "mileage_only", label: "Mileage-only rule, mileage unknown", kind: "exception", description: "The rule has no date component, so no date-based reminder is allowed. Mileage is requested instead.", inputs: { last_service_months: 8, interval: RULE_OPTIONS[2], mileage: "Unknown", odometer: 0, future_booking: false } },
  ],
  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("service-reminders", scenarioId, inputs, {
      step: "done",
      months: 0,
      odometer: null,
      readingAgeMonths: 0,
      reminders: 0,
      mileageRequests: 0,
      checks: 0,
      cycle: 1,
      bookingRef: null,
      roRef: null,
    });
    const s = sim.s;
    s.months = Math.max(0, Math.round(sim.num("last_service_months", 12)));
    s.odometer = sim.str("mileage") === "Known" && sim.num("odometer") > 0 ? Math.round(sim.num("odometer")) : null;
    runCheck(sim);
    return sim.done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;

    switch (actionId) {
      case "advance_check": {
        if (s.step !== "not_due") return sim.done();
        const n = evaluate(sim).monthsToWindow;
        sim.advance(n * 30 * DAY);
        s.months += n;
        s.readingAgeMonths += n;
        s.reminders = 0;
        s.mileageRequests = 0;
        sim.emit("notdue", "passed", `Next check reached (+${n} month${n === 1 ? "" : "s"})`);
        runCheck(sim);
        return sim.done();
      }

      case "mileage_high":
      case "mileage_low": {
        if (s.step !== "offer" && s.step !== "ask_mileage") return sim.done();
        sim.advance(2 * HOUR);
        const km = actionId === "mileage_high" ? 99800 : 88000;
        sim.say("customer", actionId === "mileage_high" ? "Odometer says 99,800 km." : "It’s on 88,000 km.");
        submitMileage(sim, km);
        return sim.done();
      }

      case "slot_0":
      case "slot_1": {
        if (s.step !== "offer") return sim.done();
        sim.advance(2 * HOUR);
        const i = actionId === "slot_0" ? 0 : 1;
        sim.say("customer", `${SLOTS[i].day} at ${SLOTS[i].time} please.`);
        book(sim, i);
        return sim.done();
      }

      case "no_reply": {
        if (s.step !== "offer" && s.step !== "ask_mileage") return sim.done();
        sim.advance(7 * DAY);
        const e = evaluate(sim);
        if (s.step === "ask_mileage") {
          sim.emit("askmileage", "info", "No mileage reply after 7 days", "Mileage stays unknown.");
          nextCheck(sim, e, "Mileage not supplied; one request per check");
          return sim.done();
        }
        if (s.reminders >= MAX_REMINDERS) {
          s.step = "done";
          sim.emit("offer", "stopped", `Contact limit reached (${MAX_REMINDERS} of ${MAX_REMINDERS})`);
          reminderState(sim, "No reply — reminders stopped for this cycle", "warn");
          return sim.finish("stopped", { kind: "exception", summary: `No reply after ${MAX_REMINDERS} reminders, so contact stopped at the limit for this cycle.` }).done();
        }
        offer(sim, e, "check");
        return sim.done();
      }

      case "complete":
      case "complete_twice": {
        if (s.step !== "booked") return sim.done();
        complete(sim, actionId === "complete_twice" ? 2 : 1);
        return sim.done();
      }

      case "free": {
        if (s.step !== "offer" && s.step !== "ask_mileage") return sim.done();
        const text = String(payload ?? "").trim();
        const t = text.toLowerCase();
        sim.advance(2 * HOUR);
        sim.say("customer", text || "…");
        if (/\bstop\b|unsubscribe|don.?t (contact|message|text)/.test(t)) {
          s.step = "done";
          sim.emit("offer", "stopped", "Opt-out recorded — reminders stopped");
          reminderState(sim, "Opted out of reminders", "bad", [{ label: "Contact preference", value: "No service reminders", tone: "bad" }]);
          return sim.finish("stopped", { kind: "stopped", summary: "The customer opted out, so no further service reminders will be sent." }).done();
        }
        const num = text.replace(/,/g, "").match(/\b(\d{4,6})\s*(k(m)?)?\b/i);
        if (num) {
          submitMileage(sim, Number(num[1]));
          return sim.done();
        }
        if (s.step === "offer") {
          const i = SLOTS.findIndex((x) => t.includes(x.day.toLowerCase()) || t.includes(x.day.slice(0, 3).toLowerCase()));
          if (i >= 0) {
            book(sim, i);
            return sim.done();
          }
          if (/(price|cost|how much|cheap)/.test(t)) {
            sim.emit("offer", "info", "Price question answered from the approved price list");
            sim.say("assistant", `A standard logbook service is ${aud(SERVICE_PRICE)}. Anything extra the technician finds is quoted for your approval first.`);
            return sim.done();
          }
          if (/^(no|nope|nah)\b|not now|later/.test(t)) {
            s.step = "done";
            sim.emit("offer", "stopped", "Customer declined this reminder");
            reminderState(sim, "Declined this cycle — no more reminders until next check", "muted");
            sim.say("assistant", "No problem. We won’t remind you again this cycle.");
            return sim.finish("stopped", { kind: "exception", summary: "The customer declined for now. Reminders for this cycle stopped; nothing was booked." }).done();
          }
        }
        sim.emit(s.step === "offer" ? "offer" : "askmileage", "info", "Reply not understood — asking again", "Mileage is never guessed from a reply.");
        sim.say("assistant", s.step === "offer" ? `Sorry, I didn’t catch that. Would ${SLOTS.map((x) => `${x.day} ${x.time}`).join(" or ")} suit? You can also send the odometer reading, e.g. 97,500 km.` : "Sorry, I didn’t catch a reading. Could you send the number on the odometer, e.g. 97,500 km?");
        return sim.done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const serviceReminders: Product = {
  id: "service-reminders",
  no: 9,
  slug: "service-reminders",
  name: "Service Reminders",
  outcome: "Bring customers back when service is due.",
  sectorLabel: "Independent automotive",
  sectors: ["Automotive"],
  outcomes: ["Grow repeat business"],
  definition:
    "Uses recorded service dates, approved maintenance intervals and reliable mileage to work out when each vehicle is due, and invites the customer to book at that point. Unknown mileage stays unknown: it is asked for, never estimated, and date-based reminders go out only where the approved rule allows.",
  situation:
    "A Corolla was last serviced twelve months ago, so it is due by date, but the garage has no recent odometer reading. The customer supplies it by text before choosing an appointment.",
  endState:
    "Customers hear from the garage when their car is actually due, with the reason shown. Nobody with a booking already is chased, and each completed service starts the next cycle once.",
  handles: [
    "Explains each due calculation against the approved date and mileage rule",
    "Asks for the odometer when it is missing or out of date",
    "Recalculates the due state when the customer supplies mileage",
    "Offers workshop appointments and confirms the booking",
    "Resets the reminder cycle once when the service is completed",
  ],
  boundaries: [
    "Never estimates mileage from averages or old readings",
    "Sends no date-based reminder where the rule is mileage-only",
    "Does not contact customers who already have a service booked",
  ],
  delivered: [
    { title: "Due explanation", body: "Rule, last service, months elapsed, kilometres since the last service (or ‘unknown’) and the reason the reminder is allowed." },
    { title: "Booking confirmation", body: "Service, day, time and reference, written to the workshop calendar with reminders paused." },
    { title: "Reminder state", body: "Per vehicle: not due, waiting for mileage, reminded, booked, or reset with the next due date and mileage." },
  ],
  deployment: {
    rules: [
      "Your approved service intervals by vehicle or plan",
      "How old an odometer reading can be before it counts as unknown",
      "Reminder windows, spacing and limits per cycle",
      "Contact preferences and opt-out handling",
    ],
    systems: ["Service history", "Approved maintenance rules", "Odometer input", "Workshop calendar", "SMS or email"],
  },
  measures: ["Completed returning services", "Reminder-to-booking conversion"],
  reliability: [
    "Reminders sent to vehicles with a booking already (target: zero)",
    "Cycle resets per completed service (target: exactly one)",
    "Reminders sent after opt-out (target: zero)",
  ],
  harness: {
    systems:
      "Production reads service history and approved maintenance rules, accepts odometer input and writes to the workshop calendar and messaging. The demo uses Sam Whitfield’s fictional Corolla at Northside Auto, three sample rules and an outbox that holds every message.",
    controls: [
      "Data freshness: odometer readings older than 3 months count as unknown",
      "Approved intervals only; each calculation is shown",
      "No guessed mileage; date-based reminders only where the rule permits",
      "Deduplication: an existing booking suppresses contact; one reset per completion",
      "Contact preferences and a two-reminder limit per cycle",
    ],
  },
  ctaLine: "Want this reminding your customers when their car is due?",
  graph: {
    nodes: [
      { id: "history", kind: "action", row: 0, title: "Read service history", input: "Vehicle and last repair order", rule: "Latest completed service; existing bookings", output: "Last service date and odometer", failure: "Future booking → already booked", system: "Service history (demo: fixture)" },
      { id: "evaluate", kind: "action", row: 1, title: "Evaluate date and mileage", input: "Months elapsed, odometer reading", rule: "Approved interval; 1-month / 1,000 km window", output: "Explained due calculation", failure: "Mileage unknown → stays unknown", system: "Maintenance rules (demo: fixture)" },
      { id: "askmileage", kind: "action", row: 2, title: "Ask for missing mileage if needed", input: "Unknown or stale mileage", rule: "One request per check; no due claim", output: "Mileage request in outbox", failure: "No reply → next check", system: "SMS (demo: held outbox)" },
      { id: "determine", kind: "action", row: 3, title: "Determine eligible due service", input: "Due calculation", rule: "Due by date (if permitted) or mileage", output: "Service due / not due", failure: "Not due → next check", system: "Session state" },
      { id: "offer", kind: "action", row: 4, title: "Offer available appointments", input: "Due service", rule: "Contact preference; max 2 reminders per cycle", output: "Reminder with slots", failure: "Opt-out or limit → stop", system: "Calendar + SMS (demo: fixture/held)" },
      { id: "book", kind: "action", row: 5, title: "Book and reset reminder state", input: "Chosen slot, completion event", rule: "One booking and one reset per operation key", output: "Booking + reset reminder state", failure: "Duplicate completion → ignored", system: "Workshop calendar + history (demo: simulated)" },
      { id: "mileage", kind: "branch", row: 0.6, title: "Mileage supplied", input: "Customer’s odometer reply", rule: "Plausibility check, then recalculate", output: "Updated due state", failure: "—" },
      { id: "notdue", kind: "branch", row: 2.6, title: "Not due", input: "Below the due window", rule: "Schedule the next check", output: "Next check date", failure: "—" },
      { id: "booked", kind: "branch", row: 4.3, title: "Already booked", input: "Future service on the calendar", rule: "Suppress contact", output: "Paused reminder state", failure: "—" },
      { id: "check_rules", kind: "check", row: 1, title: "Approved interval rules", input: "Rule, dates, readings", rule: "Only approved intervals; show the arithmetic", output: "Due calculation", failure: "No rule → no reminder" },
      { id: "check_unknown", kind: "check", row: 2, title: "Unknown stays unknown", input: "Missing or stale odometer", rule: "Never estimated or extrapolated", output: "Mileage marked unknown", failure: "—" },
      { id: "check_complete", kind: "check", row: 5, title: "Completion resets cycle", input: "Completion event", rule: "Reset once per repair order", output: "Next due date and mileage", failure: "Replay → ignored" },
    ],
    edges: [
      { from: "history", to: "evaluate", kind: "flow" },
      { from: "evaluate", to: "askmileage", kind: "flow" },
      { from: "askmileage", to: "determine", kind: "flow" },
      { from: "determine", to: "offer", kind: "flow" },
      { from: "offer", to: "book", kind: "flow" },
      { from: "askmileage", to: "mileage", kind: "return" },
      { from: "mileage", to: "evaluate", kind: "return", label: "recalculate" },
      { from: "determine", to: "notdue", kind: "return" },
      { from: "notdue", to: "history", kind: "return", label: "next check" },
      { from: "offer", to: "booked", kind: "return" },
      { from: "check_rules", to: "evaluate", kind: "check" },
      { from: "check_unknown", to: "askmileage", kind: "check" },
      { from: "check_complete", to: "book", kind: "check" },
    ],
  },
  demo,
};
