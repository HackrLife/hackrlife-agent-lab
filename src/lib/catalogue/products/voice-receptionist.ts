import type { DemoAction, DemoDefinition, Product } from "../types";
import { Sim, aud } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

const BUSINESS = "Harbourside Plumbing";
const OWNER = "Mick (owner)";

/** Postcode allowlist for the service area. */
const SERVICE_AREA: Record<string, string> = {
  "2010": "Surry Hills",
  "2011": "Potts Point",
  "2016": "Redfern",
  "2017": "Waterloo",
  "2021": "Paddington",
  "2031": "Randwick",
};

/** Referral partner used when a caller is outside the area. */
const REFERRAL_PARTNER = "Westside Plumbing (sample referral partner)";

interface ServiceRule {
  said: string;
  minutes: number;
  urgent?: boolean;
}

/** Service catalogue. Urgent jobs are never booked automatically. */
const SERVICES: Record<string, ServiceRule> = {
  "Leaking kitchen tap": { said: "Our kitchen tap has been leaking since last night", minutes: 60 },
  "Blocked drain": { said: "The shower drain is blocked and water is pooling", minutes: 90 },
  "Hot water not working": { said: "We've had no hot water since this morning", minutes: 120 },
  "Burst pipe — water everywhere": { said: "A pipe under the laundry sink has burst and there's water everywhere", minutes: 0, urgent: true },
};

const CALL_OUT_FEE = 95;
const PRICE_RULE = `There is a ${aud(CALL_OUT_FEE)} call-out fee, and Mick confirms the price on site before starting any work.`;
const URGENT_ADVICE = "If water is still running, turn off the main tap at the water meter.";

const DAYS = ["Tuesday", "Wednesday", "Thursday", "Friday"];
/** Fixture calendar for this week (Thursday is fully booked). */
const CALENDAR: Record<string, string[]> = {
  Tuesday: ["8:00 am", "1:30 pm"],
  Wednesday: ["10:00 am"],
  Thursday: [],
  Friday: ["9:00 am", "2:00 pm"],
};

const MAX_DAY_TRIES = 3;
const MAX_UNCLEAR = 3;
const MAX_WRITE_ATTEMPTS = 2;

type Step = "address" | "offer" | "noslot" | "readback" | "write_failed" | "after_booking" | "done";

interface State {
  step: Step;
  address: string | null;
  day: string;
  slotIdx: number;
  dayTries: number;
  unclear: number;
  writeAttempts: number;
  bookingKey: string | null;
  bookingRef: string | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const YES = /\b(yes|yeah|yep|sure|ok|okay|works|fine|sounds good|book it|go ahead|perfect)\b/;
const NO = /\b(no|nope|doesn't|does not|can't|cannot)\b/;
const URGENT = /(burst|flood|flooding|gas leak|smell gas|emergency|sparks|water everywhere)/;
const HANG_UP = /\b(stop|bye|goodbye|hang up|never mind|nevermind)\b/;
const PRICE = /(price|cost|cheaper|how much|charge|fee|quote)/;
const ADDRESS = /\d+[a-z]?(\/\d+)?\s+[a-z]{2,}/i;

function job(sim: Sim<State>): { name: string; rule: ServiceRule | undefined } {
  const name = sim.str("job");
  return { name, rule: SERVICES[name] };
}

function slotLabel(sim: Sim<State>) {
  const s = sim.s;
  return `${s.day} ${CALENDAR[s.day]?.[s.slotIdx] ?? ""}`.trim();
}

function findDay(text: string): string | undefined {
  return DAYS.find((d) => text.includes(d.toLowerCase()));
}

function intakeFields(sim: Sim<State>) {
  const j = job(sim);
  return [
    { label: "Caller", value: `${sim.str("customer_name")} · ${sim.str("phone")}` },
    { label: "Reported problem", value: j.rule ? j.rule.said : j.name || "Not stated" },
    { label: "Job type", value: j.name || "Unknown", tone: j.rule ? ("default" as const) : ("warn" as const) },
    { label: "Address", value: sim.s.address ?? "Not yet given", tone: sim.s.address ? ("default" as const) : ("muted" as const) },
    { label: "Postcode", value: sim.str("postcode") },
  ];
}

function calendarRecord(sim: Sim<State>, day: string, bookedSlot?: string) {
  const slots = CALENDAR[day] ?? [];
  sim.record({
    id: "calendar",
    title: `Sample calendar — ${day}`,
    status: slots.length === 0 ? "Fully booked" : bookedSlot ? `${bookedSlot} booked` : `${slots.length} free slot${slots.length === 1 ? "" : "s"}`,
    tone: slots.length === 0 ? "warn" : bookedSlot ? "ok" : "default",
    fields: slots.length
      ? slots.map((t) => ({ label: t, value: t === bookedSlot ? "Booked (this call)" : "Free", tone: t === bookedSlot ? ("ok" as const) : ("muted" as const) }))
      : [{ label: "All slots", value: "Taken by existing jobs", tone: "muted" as const }],
  });
}

const FREE: DemoAction = { id: "free", label: "Say something else", actor: "customer", freeText: { placeholder: "e.g. “Can you do Friday instead?”" } };
const HANG: DemoAction = { id: "hang_up", label: "Hang up without booking", actor: "customer", tone: "danger" };

function stageActions(sim: Sim<State>): DemoAction[] {
  const s = sim.s;
  switch (s.step) {
    case "address":
      return [
        { id: "give_address", label: "Give the street address", actor: "customer", tone: "primary", hint: `“${sim.str("address") || "(blank)"}”` },
        FREE,
        HANG,
      ];
    case "offer":
      return [
        { id: "accept_slot", label: "“Yes, that works.”", actor: "customer", tone: "primary" },
        { id: "other_time", label: "“Anything later?”", actor: "customer" },
        FREE,
        HANG,
      ];
    case "noslot":
      return [
        { id: "next_day", label: "“What about the next day?”", actor: "customer", tone: "primary" },
        { id: "no_day", label: "“None of those days suit.”", actor: "customer" },
        FREE,
        HANG,
      ];
    case "readback":
      return [
        { id: "confirm_booking", label: "“Yes, book it.”", actor: "customer", tone: "primary", hint: "Explicit confirmation — the calendar changes only now." },
        { id: "change", label: "“Actually, can we change the day?”", actor: "customer" },
        FREE,
        HANG,
      ];
    case "write_failed":
      return [
        { id: "retry_write", label: `Retry calendar write (attempt ${s.writeAttempts + 1} of ${MAX_WRITE_ATTEMPTS})`, actor: "staff", tone: "primary", hint: "Same booking key — cannot create a second booking." },
        { id: "staff_takeover", label: "Staff: take over and call back", actor: "staff" },
      ];
    case "after_booking":
      return [
        { id: "end_call", label: "“Great, thanks. Bye.”", actor: "customer", tone: "primary" },
        { id: "retry_booking", label: "Simulate network retry of the booking", actor: "customer", hint: "The booking request is delivered a second time." },
        { id: "free", label: "Say something else", actor: "customer", freeText: { placeholder: "e.g. “What does it cost?”" } },
      ];
    default:
      return [];
  }
}

function waitCustomer(sim: Sim<State>) {
  return sim.wait(sim.s.step === "write_failed" ? "waiting_staff" : "waiting_customer", stageActions(sim));
}

/* ------------------------------ Steps ------------------------------ */

function handoffStop(sim: Sim<State>, reason: "urgent" | "unclear", note: string) {
  const s = sim.s;
  s.step = "done";
  const key = `handoff:${sim.str("phone")}`;
  if (sim.claim(key, "outside", "staff handoff")) {
    sim.send({ channel: "task", to: OWNER, summary: reason === "urgent" ? `URGENT call-back: ${note}` : `Call-back needed: ${note}`, status: "simulated", opKey: key });
  }
  if (reason === "urgent") {
    sim.say("assistant", `That sounds urgent, so I'm passing you straight to Mick — he'll call you back on ${sim.str("phone")} within 15 minutes. ${URGENT_ADVICE}`);
    sim.send({ channel: "sms", to: sim.str("phone"), summary: "Urgent call-back notice with approved safety advice", status: "held", opKey: `${key}:sms` });
    sim.emit("outside", "stopped", "Urgent — handed to staff", "Owner policy: urgent jobs are never booked automatically. Owner notified with a summary.", { opKey: key });
  } else {
    sim.say("assistant", "I don't want to get this wrong, so I'll have Mick call you back to sort it out personally.");
    sim.emit("outside", "stopped", "Ambiguous request — handed to staff", `${MAX_UNCLEAR} unclear answers. Owner gets a call-back task with what was captured.`, { opKey: key });
  }
  sim.patch("intake", { status: reason === "urgent" ? "Urgent — staff call-back" : "Staff call-back — request unclear", tone: "warn", fields: [{ label: "Next step", value: "Owner calls back", tone: "warn" }] });
  return sim.finish("stopped", {
    kind: "exception",
    summary:
      reason === "urgent"
        ? "The job was urgent, so no slot was booked. The owner received a call-back task with the problem and address."
        : "The caller's request stayed unclear after repeated questions, so the assistant stopped and handed the call to staff instead of guessing.",
  });
}

function hangUp(sim: Sim<State>) {
  const s = sim.s;
  s.step = "done";
  sim.say("customer", "Actually, I'll sort it out later. Bye.");
  const key = `intake:${sim.str("phone")}`;
  if (sim.claim(key, "capture", "intake note")) {
    sim.send({ channel: "task", to: OWNER, summary: "Intake note — caller ended before booking", status: "simulated", opKey: key });
  }
  sim.emit("capture", "stopped", "Caller ended the call before booking", "Intake note sent to the owner for a call-back. No calendar change.");
  sim.patch("intake", { status: "Callback needed — not booked", tone: "warn" });
  return sim.finish("stopped", { kind: "stopped", summary: "The caller hung up before confirming a slot, so nothing was booked. The owner has the intake note to call back." });
}

function unclear(sim: Sim<State>, question: string) {
  const s = sim.s;
  s.unclear += 1;
  if (s.unclear >= MAX_UNCLEAR) return handoffStop(sim, "unclear", `${sim.str("customer_name")} — request unclear after ${MAX_UNCLEAR} questions`);
  sim.emit(s.step === "address" ? "missing" : "capture", "info", "Reply not understood — clarifying question", `Unclear answer ${s.unclear} of ${MAX_UNCLEAR} before staff handoff.`);
  sim.say("assistant", question);
  return waitCustomer(sim);
}

function captureAddress(sim: Sim<State>, text: string) {
  const s = sim.s;
  if (!ADDRESS.test(text)) {
    return unclear(sim, "Sorry, I need the street number and street name for the job — what's the address?");
  }
  s.address = text.trim().replace(/[.”"]+$/, "");
  sim.emit("missing", "passed", "Address supplied");
  sim.emit("capture", "passed", "Job and address captured", `${job(sim).name} · ${s.address}, ${sim.str("postcode")}`);
  sim.record({ id: "intake", title: "Owner intake note", status: "Captured", fields: intakeFields(sim) });
  return eligibility(sim);
}

function eligibility(sim: Sim<State>) {
  const s = sim.s;
  const pc = sim.str("postcode").trim();
  const j = job(sim);
  sim.emit("eligibility", "started", "Checking service rules", `Postcode ${pc} · ${j.name}`);

  if (j.rule?.urgent) {
    sim.emit("check_rules", "failed", "Urgent job — not bookable automatically", "Owner policy: urgent or unsafe jobs go to staff immediately.");
    return handoffStop(sim, "urgent", `${j.name} at ${s.address}, ${pc}`);
  }
  if (!j.rule) {
    sim.emit("check_rules", "failed", "Job not in the service catalogue");
    return handoffStop(sim, "unclear", `Unlisted job: ${j.name}`);
  }
  const suburb = SERVICE_AREA[pc];
  if (!suburb) {
    s.step = "done";
    sim.emit("check_rules", "failed", `Postcode ${pc} outside service area`, `Allowlist: ${Object.keys(SERVICE_AREA).join(", ")}.`);
    const key = `referral:${sim.str("phone")}`;
    sim.claim(key, "outside", "referral");
    const ref = sim.ref("RF");
    sim.say("assistant", `Sorry — postcode ${pc} is outside the area Mick covers, so I can't book a visit. I can text you the details of ${REFERRAL_PARTNER}, and I've noted a call-back in case Mick can help another way.`);
    sim.send({ channel: "sms", to: sim.str("phone"), summary: `Referral details: ${REFERRAL_PARTNER}`, status: "held", opKey: key });
    sim.send({ channel: "task", to: OWNER, summary: "Out-of-area caller — optional call-back", status: "simulated", opKey: `${key}:task` });
    sim.emit("outside", "stopped", "Outside area — referral and call-back note, no booking", undefined, { opKey: key, ref });
    sim.record({ id: "referral", title: "Referral / call-back", ref, status: "Referral sent — no booking", tone: "warn", fields: [{ label: "Reason", value: `Postcode ${pc} not in service area` }, { label: "Referred to", value: REFERRAL_PARTNER }, { label: "Calendar", value: "Unchanged", tone: "muted" }] });
    sim.patch("intake", { status: "Outside area — referred", tone: "warn" });
    return sim.finish("stopped", { kind: "exception", summary: `Postcode ${pc} is outside the service area, so the call ended with a referral and call-back note instead of a booking.` });
  }
  sim.emit("check_rules", "passed", "Service rules passed", `${suburb} (${pc}) is in the area; ${j.name} is a ${j.rule.minutes}-minute catalogue job.`);
  sim.emit("eligibility", "passed", "Eligible for a booked visit");
  return findVisit(sim, sim.str("preferred_day", "Tuesday"), 0);
}

function findVisit(sim: Sim<State>, day: string, idx: number) {
  const s = sim.s;
  if (!CALENDAR[day]) day = DAYS[0];
  s.day = day;
  const slots = CALENDAR[day];
  sim.emit("find", "started", `Checking ${day} in the sample calendar`);
  calendarRecord(sim, day);
  if (idx < slots.length) {
    s.slotIdx = idx;
    s.step = "offer";
    sim.emit("find", "passed", `Offered ${day} ${slots[idx]}`, "Offered only — nothing is held or written yet.");
    sim.say("assistant", `I can have Mick there on ${day} at ${slots[idx]}. Does that suit?`);
    return waitCustomer(sim);
  }
  s.dayTries += 1;
  const open = DAYS.filter((d) => CALENDAR[d].length > 0);
  sim.emit("noslot", "waiting", slots.length === 0 ? `No free slot on ${day}` : `No later slot on ${day}`, `Day attempt ${s.dayTries} of ${MAX_DAY_TRIES}.`);
  if (s.dayTries >= MAX_DAY_TRIES) return noDaySuits(sim, false);
  s.step = "noslot";
  sim.say("assistant", `Sorry, ${day} ${slots.length === 0 ? "is fully booked" : "has nothing later"}. This week I still have openings on ${open.join(", ")}. Would another day work?`);
  return waitCustomer(sim);
}

function nextDay(day: string): string | undefined {
  const i = DAYS.indexOf(day);
  return DAYS.slice(i + 1).find((d) => CALENDAR[d].length > 0);
}

function noDaySuits(sim: Sim<State>, said: boolean) {
  const s = sim.s;
  s.step = "done";
  if (said) sim.say("customer", "None of those days suit, sorry.");
  const key = `callback:${sim.str("phone")}`;
  if (sim.claim(key, "noslot", "call-back")) {
    sim.send({ channel: "task", to: OWNER, summary: "Call-back: no suitable slot this week", status: "simulated", opKey: key });
  }
  sim.say("assistant", "No problem. I've passed your details to Mick and he'll call you to find a time next week.");
  sim.emit("noslot", "stopped", "No suitable slot — call-back requested", "Loop stopped. No booking was created.");
  sim.patch("intake", { status: "Callback needed — no suitable slot", tone: "warn" });
  return sim.finish("stopped", { kind: "exception", summary: "No offered slot suited the caller, so the assistant stopped offering days and created a call-back task. The calendar was not changed." });
}

function readBack(sim: Sim<State>) {
  const s = sim.s;
  s.step = "readback";
  sim.emit("confirm", "waiting", "Details read back to caller", slotLabel(sim));
  sim.say(
    "assistant",
    `Let me read that back: ${job(sim).name.toLowerCase()} at ${s.address}, ${sim.str("postcode")}, on ${slotLabel(sim)}. Name ${sim.str("customer_name")}, mobile ${sim.str("phone")}. ${PRICE_RULE} Shall I book it?`,
  );
  return waitCustomer(sim);
}

function book(sim: Sim<State>) {
  const s = sim.s;
  sim.emit("check_confirm", "passed", "Explicit confirmation received", "Caller said yes after the read-back.");
  sim.emit("confirm", "confirmed", `Caller confirmed ${slotLabel(sim)}`);
  const slot = CALENDAR[s.day][s.slotIdx];
  const key = `booking:${sim.str("phone").replace(/\s/g, "")}:${s.day}:${slot}`;
  s.bookingKey = key;
  if (!sim.claim(key, "book", "booking")) return waitCustomer(sim);
  s.writeAttempts = 1;
  sim.emit("book", "started", "Writing booking to calendar", undefined, { opKey: key });
  if (!sim.bool("calendar_online")) {
    sim.send({ channel: "calendar", to: "Sample calendar", summary: `Book ${slotLabel(sim)} — connector unavailable`, status: "pending", opKey: key });
    return writeFailed(sim);
  }
  return writeOk(sim);
}

function writeFailed(sim: Sim<State>) {
  const s = sim.s;
  sim.emit("check_write", "failed", "Calendar write not verified", `Connector unavailable (attempt ${s.writeAttempts} of ${MAX_WRITE_ATTEMPTS}).`, { opKey: s.bookingKey ?? undefined });
  sim.emit("book", "waiting", "Booking pending — not confirmed");
  sim.record({
    id: "booking",
    title: "Appointment",
    status: "Pending — not booked",
    tone: "warn",
    fields: [
      { label: "Requested slot", value: slotLabel(sim) },
      { label: "Calendar receipt", value: "None — write not verified", tone: "bad" },
      { label: "Booking key", value: s.bookingKey ?? "" },
    ],
  });
  if (s.writeAttempts === 1) {
    sim.say("assistant", "I've got all your details, but I can't confirm the time in the calendar just now. Please don't treat this as booked yet — Mick's office will confirm with you shortly.");
  }
  s.step = "write_failed";
  if (s.writeAttempts >= MAX_WRITE_ATTEMPTS) return pendingHandoff(sim);
  return waitCustomer(sim);
}

function pendingHandoff(sim: Sim<State>) {
  const s = sim.s;
  s.step = "done";
  const key = `${s.bookingKey}:handoff`;
  if (sim.claim(key, "outside", "staff handoff")) {
    sim.send({ channel: "task", to: OWNER, summary: `Pending booking — confirm ${slotLabel(sim)} manually`, status: "simulated", opKey: key });
  }
  sim.emit("outside", "stopped", "Pending handoff to staff", "Calendar unavailable; the request is queued for a person to confirm.", { opKey: key });
  sim.patch("booking", { status: "Pending handoff — not booked", tone: "warn" });
  sim.patch("intake", { status: "Pending — staff to confirm slot", tone: "warn" });
  return sim.finish("stopped", { kind: "exception", summary: "The calendar write could not be verified, so no booking or confirmation was issued. The request is pending with staff." });
}

function writeOk(sim: Sim<State>) {
  const s = sim.s;
  const key = s.bookingKey!;
  const slot = CALENDAR[s.day][s.slotIdx];
  const ref = sim.ref("BK");
  s.bookingRef = ref;
  const existing = sim.run.outbox.find((o) => o.opKey === key);
  if (existing) {
    existing.status = "simulated";
    existing.summary = `Book ${slotLabel(sim)} — ${job(sim).name}`;
  } else {
    sim.send({ channel: "calendar", to: "Sample calendar", summary: `Book ${slotLabel(sim)} — ${job(sim).name}`, status: "simulated", opKey: key });
  }
  sim.emit("check_write", "passed", "Calendar write verified", `Receipt for ${slotLabel(sim)}.`, { opKey: key, ref });
  sim.emit("book", "confirmed", `Booking ${ref} confirmed`, undefined, { opKey: key, ref });
  calendarRecord(sim, s.day, slot);
  sim.record({
    id: "booking",
    title: "Appointment",
    ref,
    status: "Confirmed",
    tone: "ok",
    fields: [
      { label: "Slot", value: slotLabel(sim) },
      { label: "Job", value: job(sim).name },
      { label: "Address", value: `${s.address}, ${sim.str("postcode")}` },
      { label: "Calendar receipt", value: "Verified (sample calendar)", tone: "ok" },
      { label: "Booking key", value: key },
    ],
  });
  sim.send({ channel: "sms", to: sim.str("phone"), summary: `Confirmation ${ref}: ${slotLabel(sim)}, ${s.address}`, status: "held", opKey: `${key}:sms` });
  sim.send({ channel: "task", to: OWNER, summary: `Intake note for ${ref}`, status: "simulated", opKey: `${key}:intake` });
  sim.patch("intake", { status: `Booked — ${ref}`, tone: "ok", fields: [{ label: "Booking", value: `${ref} · ${slotLabel(sim)}`, tone: "ok" }] });
  sim.say("assistant", `You're booked for ${slotLabel(sim)}. Your reference is ${ref}, and I've texted you a confirmation. Anything else?`);
  s.step = "after_booking";
  return waitCustomer(sim);
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Uses a sample calendar, service area and job list. No real call is made, no text is sent and no appointment is created.",
  assistantName: "Harbourside receptionist",
  channelLabel: "Phone call",
  voice: true,
  fields: [
    { kind: "text", name: "customer_name", label: "Caller name (sample)" },
    { kind: "text", name: "phone", label: "Caller mobile" },
    { kind: "select", name: "job", label: "Reported job", options: Object.keys(SERVICES), helper: "A burst pipe is treated as urgent and handed to staff." },
    { kind: "text", name: "address", label: "Street address the caller gives", helper: "Needs a street number and name." },
    { kind: "text", name: "postcode", label: "Postcode", helper: `Service area: ${Object.keys(SERVICE_AREA).join(", ")}.` },
    { kind: "select", name: "preferred_day", label: "Preferred day", options: DAYS, helper: "Thursday is fully booked in the sample calendar." },
    { kind: "toggle", name: "calendar_online", label: "Calendar connector available", helper: "Turn off to simulate a calendar outage." },
  ],
  scenarios: [
    { id: "routine", label: "Routine job", kind: "success", description: "Leaking kitchen tap in Surry Hills; Tuesday has free slots.", inputs: { customer_name: "Sam Porter", phone: "0491 570 159", job: "Leaking kitchen tap", address: "14 Wattle Street, Surry Hills", postcode: "2010", preferred_day: "Tuesday", calendar_online: true } },
    { id: "outside_area", label: "Outside service area", kind: "exception", description: "Penrith postcode. Ends in a referral and call-back note, never a booking.", inputs: { customer_name: "Priya Nair", phone: "0491 570 110", job: "Blocked drain", address: "7 Station Road, Penrith", postcode: "2750", preferred_day: "Wednesday", calendar_online: true } },
    { id: "no_availability", label: "No availability", kind: "exception", description: "Caller wants Thursday, which is fully booked. Try another day.", inputs: { customer_name: "Tom Reilly", phone: "0491 570 313", job: "Hot water not working", address: "22 Crown Street, Redfern", postcode: "2016", preferred_day: "Thursday", calendar_online: true } },
    { id: "calendar_outage", label: "Calendar outage", kind: "exception", description: "Everything checks out, but the calendar write cannot be verified.", inputs: { customer_name: "Lena Brooks", phone: "0491 570 737", job: "Leaking kitchen tap", address: "5 Oxford Street, Paddington", postcode: "2021", preferred_day: "Friday", calendar_online: false } },
    { id: "urgent", label: "Urgent job", kind: "exception", description: "Burst pipe. Handed straight to staff with a summary.", inputs: { customer_name: "Ahmed Karim", phone: "0491 571 266", job: "Burst pipe — water everywhere", address: "9 Belmore Road, Randwick", postcode: "2031", preferred_day: "Tuesday", calendar_online: true } },
  ],

  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("voice-receptionist", scenarioId, inputs, {
      step: "address",
      address: null,
      day: "",
      slotIdx: 0,
      dayTries: 0,
      unclear: 0,
      writeAttempts: 0,
      bookingKey: null,
      bookingRef: null,
    });
    const j = job(sim);
    const pc = sim.str("postcode").trim();
    sim.say("system", `Incoming call to ${BUSINESS} (sample business) while Mick is on another job.`);
    sim.emit("call", "started", "Call answered", `${sim.str("customer_name")} · ${sim.str("phone")}`);
    sim.say("assistant", `${BUSINESS}, this is the booking assistant. Mick's on a job right now — how can I help?`);
    sim.say("customer", `Hi, it's ${sim.str("customer_name")}. ${j.rule ? j.rule.said : j.name}. I'm in ${pc}.`);
    sim.emit("call", "passed", "Caller identified");

    sim.emit("capture", "started", "Capturing job and address");
    sim.record({ id: "intake", title: "Owner intake note", status: "In progress", fields: intakeFields(sim) });
    if (!sim.str("customer_name").trim() || !/^\d{4}$/.test(pc) || !/\d{8,}/.test(sim.str("phone").replace(/\s/g, ""))) {
      sim.emit("capture", "failed", "Required fields invalid", "Name, a valid mobile and a four-digit postcode are required.");
      sim.patch("intake", { status: "Rejected at validation", tone: "bad" });
      return sim.finish("failed", { kind: "failed", summary: "The sample caller details failed validation (name, mobile or postcode), so nothing was captured. Fix the inputs and start again." }).done();
    }
    if (j.rule?.urgent) {
      sim.s.address = sim.str("address") || null;
      sim.emit("capture", "passed", "Urgent keywords detected — skipping to rules");
      return eligibility(sim).done();
    }
    sim.emit("missing", "waiting", "Missing: street address", "Asking the caller.");
    sim.say("assistant", "Sorry to hear that. What's the street address for the job?");
    return waitCustomer(sim).done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;
    sim.advance(1);

    switch (actionId) {
      case "give_address": {
        const a = sim.str("address");
        sim.say("customer", a ? `It's ${a}.` : "Um, I'm not sure of the number.");
        return captureAddress(sim, a).done();
      }
      case "accept_slot":
        sim.say("customer", "Yes, that works.");
        return readBack(sim).done();
      case "other_time": {
        sim.say("customer", "Have you got anything later?");
        const slots = CALENDAR[s.day] ?? [];
        if (s.slotIdx + 1 < slots.length) return findVisit(sim, s.day, s.slotIdx + 1).done();
        return findVisit(sim, s.day, slots.length).done();
      }
      case "next_day": {
        sim.say("customer", "What about the next day?");
        sim.emit("noslot", "info", "Trying another day");
        const d = nextDay(s.day);
        if (!d) return noDaySuits(sim, false).done();
        return findVisit(sim, d, 0).done();
      }
      case "no_day":
        return noDaySuits(sim, true).done();
      case "change": {
        sim.say("customer", "Actually, can we change the day?");
        const d = nextDay(s.day);
        if (!d) return noDaySuits(sim, false).done();
        sim.emit("noslot", "info", "Caller asked for another day");
        return findVisit(sim, d, 0).done();
      }
      case "confirm_booking":
        sim.say("customer", "Yes, book it.");
        return book(sim).done();
      case "retry_write": {
        s.writeAttempts += 1;
        sim.emit("book", "info", `Retrying calendar write with key ${s.bookingKey}`, "Same key: a success could never create a second booking.", { opKey: s.bookingKey ?? undefined });
        if (!sim.bool("calendar_online")) {
          const item = sim.run.outbox.find((o) => o.opKey === s.bookingKey);
          if (item) item.status = "failed";
          return writeFailed(sim).done();
        }
        return writeOk(sim).done();
      }
      case "staff_takeover":
        sim.say("staff", "Mick's office: I'll call the customer and put it in the diary by hand.");
        return pendingHandoff(sim).done();
      case "retry_booking": {
        sim.emit("book", "info", "Booking request delivered again (network retry)");
        sim.claim(s.bookingKey ?? "booking", "book", "booking");
        return waitCustomer(sim).done();
      }
      case "end_call":
        sim.say("customer", "Great, thanks. Bye.");
        s.step = "done";
        sim.emit("call", "passed", "Call ended");
        return sim.finish("completed", { kind: "success", summary: `Booked ${slotLabel(sim)} as ${s.bookingRef} after the caller confirmed the read-back and the calendar write was verified. One slot was used.` }).done();
      case "hang_up":
        return hangUp(sim).done();
      case "free":
        return handleFree(sim, payload ?? "").done();
    }
    return sim.done();
  },
};

function handleFree(sim: Sim<State>, raw: string) {
  const s = sim.s;
  const text = raw.trim().toLowerCase();
  sim.say("customer", raw.trim() || "…");
  if (!text) return unclear(sim, "Sorry, I didn't catch that. Could you say it again?");
  if (URGENT.test(text) && s.step !== "after_booking") {
    sim.emit("check_rules", "failed", "Caller described an urgent situation", "Owner policy: urgent jobs go to staff.");
    return handoffStop(sim, "urgent", `${raw.trim()} — ${s.address ?? "address not yet given"}`);
  }
  if (s.step === "after_booking") {
    if (PRICE.test(text)) {
      sim.emit("check_rules", "info", "Answered from approved pricing rule");
      sim.say("assistant", `${PRICE_RULE} Anything else?`);
      return waitCustomer(sim);
    }
    if (HANG_UP.test(text) || YES.test(text) || /\b(thanks|thank you|no thanks|that's all)\b/.test(text)) {
      s.step = "done";
      sim.emit("call", "passed", "Call ended");
      return sim.finish("completed", { kind: "success", summary: `Booked ${slotLabel(sim)} as ${s.bookingRef} after explicit confirmation and a verified calendar write.` });
    }
    sim.say("assistant", "I'll add that to Mick's note for the visit. Anything else?");
    sim.emit("capture", "info", "Extra detail added to the intake note");
    sim.patch("intake", { fields: [{ label: "Caller added", value: raw.trim() }] });
    return waitCustomer(sim);
  }
  if (HANG_UP.test(text)) return hangUp(sim);
  if (PRICE.test(text)) {
    sim.emit("check_rules", "info", "Answered from approved pricing rule", "No other price is quoted.");
    sim.say("assistant", PRICE_RULE);
    return waitCustomer(sim);
  }
  const day = findDay(text);
  switch (s.step) {
    case "address":
      return captureAddress(sim, raw);
    case "offer":
      if (day && day !== s.day) return findVisit(sim, day, 0);
      if (YES.test(text)) return readBack(sim);
      if (NO.test(text) || /(later|earlier|another|different|other)/.test(text)) {
        const slots = CALENDAR[s.day] ?? [];
        return findVisit(sim, s.day, Math.min(s.slotIdx + 1, slots.length));
      }
      return unclear(sim, `Would ${slotLabel(sim)} suit you? You can say yes, or name another day.`);
    case "noslot":
      if (day) return findVisit(sim, day, 0);
      if (YES.test(text)) {
        const d = nextDay(s.day);
        return d ? findVisit(sim, d, 0) : noDaySuits(sim, false);
      }
      if (NO.test(text)) return noDaySuits(sim, false);
      return unclear(sim, "Which day would suit you — Tuesday, Wednesday or Friday?");
    case "readback":
      if (day && day !== s.day) return findVisit(sim, day, 0);
      if (NO.test(text) || /change|wrong/.test(text)) {
        const d = nextDay(s.day);
        return d ? findVisit(sim, d, 0) : noDaySuits(sim, false);
      }
      if (YES.test(text)) return book(sim);
      return unclear(sim, "Just to be sure — shall I book that? Please say yes, or tell me what to change.");
    default:
      return waitCustomer(sim);
  }
}

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const voiceReceptionist: Product = {
  id: "voice-receptionist",
  no: 1,
  slug: "voice-receptionist",
  name: "Voice Receptionist",
  outcome: "Answer enquiries while you work.",
  sectorLabel: "Home services",
  sectors: ["Home services"],
  outcomes: ["Capture enquiries"],
  definition:
    "An inbound receptionist that answers the call, captures the job and address, checks the caller against your service area and job list, and offers an available visit from your calendar. Anything unusual, urgent or unclear is escalated to you with a useful summary instead of being booked.",
  situation:
    "A plumber is under a sink at one property when a customer calls about a leaking kitchen tap. The call goes to voicemail, the customer rings the next plumber on the list, and the job is gone before the first plumber has dried their hands.",
  endState:
    "Every call is answered, routine jobs in the area are booked into a confirmed slot with a read-back, and the owner gets an intake note with the problem and address — or a clear call-back task when the job needs a person.",
  handles: [
    "Asks for any missing detail, such as the street address",
    "Checks the postcode and job type against your service rules",
    "Offers free slots and tries another day when the preferred day is full",
    "Reads the details back and books only after the caller says yes",
    "Sends urgent, out-of-area or unclear calls to staff with a summary",
  ],
  boundaries: [
    "Never books an urgent job or a job outside the service area",
    "Never shows a booking as confirmed without a verified calendar write",
    "Quotes only the approved call-out fee; the owner prices the work on site",
    "The public demo makes no phone call and sends no text",
  ],
  delivered: [
    { title: "Caller confirmation", body: "Text with the booking reference, day and time, address and the approved call-out fee note." },
    { title: "Owner intake note", body: "Caller name and mobile, reported problem, job type, address and booking reference — or the reason it needs a call-back." },
    { title: "Calendar booking", body: "One appointment written with an idempotent booking key and a verified receipt; retries cannot double-book." },
  ],
  deployment: {
    rules: [
      "Your postcode allowlist and referral partners",
      "Your job catalogue, durations and which jobs count as urgent",
      "Calendar availability, travel buffers and working days",
      "Approved answers such as call-out fees",
      "Who takes urgent and unclear calls, and how quickly",
    ],
    systems: ["Business phone number (telephony)", "Business knowledge and service rules", "Calendar or job management system", "SMS or email confirmation"],
  },
  measures: ["Completed jobs from handled calls", "Staff time released from answering calls", "Failed bookings"],
  reliability: [
    "Double bookings from retries (target: zero)",
    "Confirmations sent without a verified calendar write (target: zero)",
    "Urgent calls handed to staff within the agreed time",
  ],
  harness: {
    systems:
      "Production requires telephony, business knowledge, a calendar or job system and confirmation messaging. The demo uses a fixture calendar, a sample postcode allowlist and job list, and a message outbox that holds every text.",
    controls: [
      "Validate required fields: name, mobile, address and postcode",
      "Apply approved service rules for area, job type and urgency",
      "Read back appointment details and require an explicit yes",
      "Write the booking with an idempotent booking key",
      "Hand urgent or ambiguous situations to staff under an owner-defined policy",
    ],
  },
  ctaLine: "Want this answering your own business line?",
  graph: {
    nodes: [
      { id: "call", kind: "action", row: 0, title: "Incoming call", input: "Inbound call", rule: "Greet, identify caller", output: "Call session with caller name and number", failure: "—", system: "Telephony (demo: browser voice or text)" },
      { id: "capture", kind: "action", row: 1, title: "Capture job and address", input: "Caller's description", rule: "Required: name, mobile, job, street address, postcode", output: "Owner intake note", failure: "Missing detail → ask; caller hangs up → call-back note", system: "Session state" },
      { id: "eligibility", kind: "action", row: 2, title: "Check service eligibility", input: "Postcode and job type", rule: "Postcode allowlist; job in catalogue; not urgent", output: "Eligible / not eligible", failure: "Outside area or urgent → stop or handoff", system: "Service rules (demo: fixture)" },
      { id: "find", kind: "action", row: 3, title: "Find an available visit", input: "Preferred day", rule: "Free slots in the calendar for that day", output: "Offered slot (not held)", failure: "No slot → try another day", system: "Calendar (demo: fixture calendar)" },
      { id: "confirm", kind: "action", row: 4, title: "Customer confirms slot", input: "Offered slot", rule: "Read back job, address, time; explicit yes", output: "Confirmed request", failure: "Caller changes day → back to find", system: "Session state" },
      { id: "book", kind: "action", row: 5, title: "Create booking and receipt", input: "Confirmed request", rule: "Idempotent booking key; verified write before confirmation", output: "Booking reference, confirmation text, intake note", failure: "Calendar unavailable → pending handoff", system: "Calendar + SMS (demo: fixture + held outbox)" },
      { id: "missing", kind: "branch", row: 1, title: "Missing details", input: "Required field absent", rule: "Ask one question at a time; 3 unclear answers → staff", output: "Completed field", failure: "—" },
      { id: "outside", kind: "branch", row: 2.4, title: "Outside area or urgent", input: "Failed service rule, urgency, outage or unclear request", rule: "Stop or human handoff", output: "Referral, call-back task or pending handoff", failure: "—" },
      { id: "noslot", kind: "branch", row: 3.6, title: "No suitable slot", input: "Day full or declined", rule: `Try another day (max ${MAX_DAY_TRIES}), then call-back`, output: "New offer or call-back task", failure: "—" },
      { id: "check_rules", kind: "check", row: 1.9, title: "Service rules", input: "Postcode, job, caller words", rule: "Allowlist, catalogue, urgency policy, approved price answer", output: "Pass / fail with reason", failure: "Fail → referral or staff handoff" },
      { id: "check_confirm", kind: "check", row: 4, title: "Explicit confirmation", input: "Caller reply after read-back", rule: "Only an explicit yes allows a calendar write", output: "Confirmation recorded", failure: "No yes → nothing written" },
      { id: "check_write", kind: "check", row: 5, title: "Verified calendar write", input: "Calendar response", rule: "Receipt must match booking key before confirming", output: "Verified receipt", failure: "Unverified → pending, never success" },
    ],
    edges: [
      { from: "call", to: "capture", kind: "flow" },
      { from: "capture", to: "eligibility", kind: "flow" },
      { from: "eligibility", to: "find", kind: "flow" },
      { from: "find", to: "confirm", kind: "flow" },
      { from: "confirm", to: "book", kind: "flow" },
      { from: "capture", to: "missing", kind: "return" },
      { from: "missing", to: "capture", kind: "return", label: "ask" },
      { from: "eligibility", to: "outside", kind: "return" },
      { from: "find", to: "noslot", kind: "return" },
      { from: "noslot", to: "find", kind: "return", label: "try another day" },
      { from: "check_rules", to: "eligibility", kind: "check" },
      { from: "check_confirm", to: "confirm", kind: "check" },
      { from: "check_write", to: "book", kind: "check" },
    ],
  },
  demo,
};
