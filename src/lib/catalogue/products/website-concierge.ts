import type { DemoAction, DemoDefinition, Product } from "../types";
import { Sim, aud } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

const BUSINESS = "Brightside Cleaning Co.";
const OWNER = "Jess (owner)";

const SERVICE_AREA: Record<string, string> = {
  "3000": "Melbourne",
  "3006": "Southbank",
  "3121": "Richmond",
  "3141": "South Yarra",
  "3181": "Prahran",
  "3182": "St Kilda",
};

const SERVICES = ["End-of-lease clean", "Regular clean", "Oven clean"];
const BEDROOMS = ["1", "2", "3", "4", "5+"];

/** Approved price list. End-of-lease above 4 bedrooms needs an owner quote. */
function price(service: string, bedrooms: string): number | null {
  if (service === "Oven clean") return 140;
  const table: Record<string, Record<string, number>> = {
    "End-of-lease clean": { "1": 290, "2": 360, "3": 450, "4": 540 },
    "Regular clean": { "1": 120, "2": 150, "3": 180, "4": 210 },
  };
  return table[service]?.[bedrooms] ?? null;
}

interface FaqEntry {
  topic: string;
  match: RegExp;
  answer: string;
}

/** Small approved FAQ. Nothing outside it is answered. */
const FAQ: FaqEntry[] = [
  { topic: "Supplies", match: /(supplies|products|equipment|vacuum|chemicals|bring)/, answer: "We bring all equipment and cleaning products. Please leave water and power connected." },
  { topic: "Bond-back re-clean", match: /(bond|guarantee|re-?clean|agent|inspection)/, answer: "End-of-lease cleans include a free re-clean of anything your agent flags within 72 hours of the clean." },
  { topic: "Pets", match: /\b(pets?|dogs?|cats?)\b/, answer: "We clean homes with pets. Let us know in advance so we bring the pet-hair attachment." },
  { topic: "Cancellation", match: /(cancel|reschedul|move the date|change the date)/, answer: "You can reschedule or cancel free of charge with at least 24 hours' notice." },
];
const PRICE_Q = /(price|cost|how much|cheaper|discount|quote|charge)/;
const UNKNOWN_POLICY = /(refund|money back|compensation|insurance|damage|breakage)/;
const LEAVE = /\b(bye|stop|no thanks|not now|goodbye)\b/;
const YES = /\b(yes|yeah|yep|sure|ok|okay|please|book|go ahead|sounds good|perfect)\b/;
const NO = /\b(no|nope|different|another|change)\b/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

const QUESTIONS = ["Is it available on my chosen day?", "Do you bring your own supplies?", "What is your refund policy?"];

const DAYS = ["Wednesday", "Thursday", "Friday", "Saturday"];
/** Sample scheduling fixture: Saturday is fully booked. */
const CALENDAR: Record<string, string[]> = {
  Wednesday: ["8:00 am", "1:00 pm"],
  Thursday: ["8:00 am"],
  Friday: ["8:00 am", "12:30 pm"],
  Saturday: [],
};
const MAX_CLARIFY = 3;

type Step = "faq" | "unknown" | "clarify" | "choose" | "confirm" | "after" | "done";

interface State {
  step: Step;
  postcode: string | null;
  name: string | null;
  email: string | null;
  asking: "postcode" | "contact" | null;
  clarifyCount: number;
  escalated: boolean;
  leadRef: string | null;
  offered: string[]; // "Friday 8:00 am"
  selected: string | null;
  takenSlot: string | null;
  takenApplied: boolean;
  refreshes: number;
  bookingKey: string | null;
  bookingRef: string | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function brief(sim: Sim<State>) {
  return { service: sim.str("service"), bedrooms: sim.str("bedrooms"), day: sim.str("day") };
}

function svcLabel(sim: Sim<State>) {
  const b = brief(sim);
  return b.service === "Oven clean" ? "oven clean" : `${b.bedrooms}-bedroom ${b.service.toLowerCase()}`;
}

const FREE: DemoAction = { id: "free", label: "Type a message", actor: "customer", freeText: { placeholder: "e.g. “Do you bring your own supplies?”" } };
const LEAVE_ACT: DemoAction = { id: "leave", label: "Close the chat", actor: "customer", tone: "danger" };

function stageActions(sim: Sim<State>): DemoAction[] {
  const s = sim.s;
  switch (s.step) {
    case "faq":
      return [{ id: "check_avail", label: `“Yes — is ${brief(sim).day} free?”`, actor: "customer", tone: "primary" }, FREE, LEAVE_ACT];
    case "unknown":
      return [
        { id: "check_avail", label: "“OK — can you check availability anyway?”", actor: "customer", tone: "primary" },
        { id: "wait_owner", label: "“I'll wait for the owner's answer.”", actor: "customer" },
        FREE,
        LEAVE_ACT,
      ];
    case "clarify":
      return s.asking === "postcode"
        ? [{ id: "share_postcode", label: "Give postcode", actor: "customer", tone: "primary", hint: `“${sim.str("postcode") || "(blank)"}”` }, FREE, LEAVE_ACT]
        : [{ id: "share_contact", label: "Give name and email", actor: "customer", tone: "primary", hint: `“${sim.str("name")}, ${sim.str("email") || "(blank)"}”` }, FREE, LEAVE_ACT];
    case "choose":
      return [
        ...s.offered.map((o, i) => ({ id: `pick_${i}`, label: o, actor: "customer" as const, tone: i === 0 ? ("primary" as const) : ("default" as const) })),
        FREE,
        LEAVE_ACT,
      ];
    case "confirm":
      return [
        { id: "confirm", label: "“Yes, book it.”", actor: "customer", tone: "primary" },
        { id: "rechoose", label: "“Show me the other times.”", actor: "customer" },
        FREE,
        LEAVE_ACT,
      ];
    case "after":
      return [
        { id: "finish", label: "“Thanks, that's all.”", actor: "customer", tone: "primary" },
        { id: "double_confirm", label: "Simulate a double-click on Confirm", actor: "customer", hint: "The booking request arrives twice." },
        FREE,
      ];
    default:
      return [];
  }
}

function wait(sim: Sim<State>) {
  return sim.wait("waiting_customer", stageActions(sim));
}

/* ------------------------------ Steps ------------------------------ */

function answerFaq(sim: Sim<State>, text: string): boolean {
  if (PRICE_Q.test(text)) {
    const b = brief(sim);
    const p = price(b.service, b.bedrooms);
    sim.emit("check_sources", "passed", "Answer grounded in approved price list");
    sim.emit("faq", "passed", "Answered from approved FAQ: prices");
    sim.say(
      "assistant",
      p === null
        ? `A ${svcLabel(sim)} isn't on our fixed price list, so the owner quotes it personally. Prices on the list are fixed — I can't offer discounts.`
        : `A ${svcLabel(sim)} is ${aud(p)} on our fixed price list. I can't offer discounts, but I can note a request for the owner.`,
    );
    return true;
  }
  const hit = FAQ.find((f) => f.match.test(text));
  if (!hit) return false;
  sim.emit("check_sources", "passed", `Approved source found: ${hit.topic}`);
  sim.emit("faq", "passed", `Answered from approved FAQ: ${hit.topic}`);
  sim.say("assistant", hit.answer);
  return true;
}

function escalateUnknown(sim: Sim<State>, question: string) {
  const s = sim.s;
  sim.emit("check_sources", "failed", "No approved source for this question", "The assistant does not invent policy.");
  if (!s.escalated) {
    s.escalated = true;
    const key = `escalate:${sim.run.runId}:policy`;
    sim.claim(key, "unknown", "escalation");
    sim.send({ channel: "task", to: OWNER, summary: `Unanswered policy question: “${question}”`, status: "simulated", opKey: key });
    sim.emit("unknown", "stopped", "Unknown answer — escalated to owner", "Owner task created. The question is not answered automatically.", { opKey: key });
    sim.record({ id: "escalation", title: "Owner question", status: "Waiting for owner — no answer given", tone: "warn", fields: [{ label: "Question", value: question }, { label: "Assistant answer", value: "None — not in approved FAQ", tone: "muted" }] });
  } else {
    sim.emit("unknown", "info", "Already escalated to owner");
  }
  sim.say("assistant", "I don't have an approved answer on that, so I won't guess. I've asked the owner to reply to you personally. I can still check availability if you like.");
  if (s.step === "faq" || s.step === "unknown") s.step = "unknown";
  return wait(sim);
}

function collect(sim: Sim<State>) {
  const s = sim.s;
  const b = brief(sim);
  sim.emit("collect", "started", "Collecting service requirements", `${b.service} · ${b.bedrooms} bedrooms · ${b.day}`);
  if (!SERVICES.includes(b.service) || !BEDROOMS.includes(b.bedrooms) || !DAYS.includes(b.day)) {
    s.step = "done";
    sim.emit("collect", "failed", "Service, size or day not recognised");
    return sim.finish("failed", { kind: "failed", summary: "The sample inputs are not valid options, so nothing was recorded. Reset and choose again." });
  }
  if (!s.postcode) return askFor(sim, "postcode");
  if (!s.email) return askFor(sim, "contact");
  return briefComplete(sim);
}

function askFor(sim: Sim<State>, what: "postcode" | "contact") {
  const s = sim.s;
  s.step = "clarify";
  s.asking = what;
  sim.emit("incomplete", "waiting", what === "postcode" ? "Brief incomplete: postcode" : "Brief incomplete: name and email", "Clarifying question asked.");
  sim.say("assistant", what === "postcode" ? "Which postcode is the property in?" : "What name and email should I put the booking under?");
  return wait(sim);
}

function clarifyFailed(sim: Sim<State>, msg: string) {
  const s = sim.s;
  s.clarifyCount += 1;
  if (s.clarifyCount >= MAX_CLARIFY) return callbackRequest(sim, "Brief could not be completed in chat");
  sim.emit("incomplete", "info", "Answer did not complete the brief", `Attempt ${s.clarifyCount} of ${MAX_CLARIFY}.`);
  sim.say("assistant", msg);
  return wait(sim);
}

function takePostcode(sim: Sim<State>, text: string) {
  const m = text.match(/\b\d{4}\b/);
  if (!m) return clarifyFailed(sim, "Sorry, I need a four-digit postcode — which one is the property in?");
  sim.s.postcode = m[0];
  sim.emit("incomplete", "passed", `Postcode ${m[0]} recorded`);
  return collect(sim);
}

function takeContact(sim: Sim<State>, text: string, name: string) {
  const m = text.match(EMAIL);
  if (!m) return clarifyFailed(sim, "That email doesn't look complete — could you type it again?");
  sim.s.email = m[0];
  sim.s.name = name.trim() || "Website visitor";
  sim.emit("incomplete", "passed", "Name and email validated");
  return collect(sim);
}

function briefComplete(sim: Sim<State>) {
  const s = sim.s;
  const b = brief(sim);
  sim.emit("collect", "passed", "Service requirements complete");
  const key = `lead:${s.email}`;
  if (!s.leadRef) {
    s.leadRef = sim.ref("EQ");
    if (sim.claim(key, "collect", "lead")) sim.send({ channel: "crm", to: "Sample CRM", summary: `Create enquiry ${s.leadRef}`, status: "simulated", opKey: key });
  }
  const p = price(b.service, b.bedrooms);
  sim.record({
    id: "lead",
    title: "Enquiry record",
    ref: s.leadRef,
    status: "Qualified enquiry — not booked",
    tone: "default",
    fields: [
      { label: "Visitor", value: `${s.name} · ${s.email}` },
      { label: "Service", value: `${b.service}${b.service === "Oven clean" ? "" : `, ${b.bedrooms} bedrooms`}` },
      { label: "Postcode", value: s.postcode ?? "" },
      { label: "Requested day", value: b.day },
      { label: "Price (approved list)", value: p === null ? "Owner quote needed" : aud(p), tone: p === null ? "warn" : "default" },
      { label: "Source", value: "Website chat" },
    ],
  });
  return checkFit(sim, false);
}

function checkFit(sim: Sim<State>, refresh: boolean) {
  const s = sim.s;
  const b = brief(sim);
  sim.emit("fit", "started", refresh ? "Refreshing availability" : "Checking fit and availability");
  const suburb = SERVICE_AREA[s.postcode ?? ""];
  if (!suburb) {
    sim.emit("check_capacity", "failed", `Postcode ${s.postcode} outside service area`);
    return callbackRequest(sim, `Postcode ${s.postcode} is outside the usual area`);
  }
  if (price(b.service, b.bedrooms) === null) {
    sim.emit("check_capacity", "failed", `${b.bedrooms}-bedroom ${b.service.toLowerCase()} needs an owner quote`, "Not on the approved price list.");
    return callbackRequest(sim, `Custom quote: ${b.bedrooms}-bedroom ${b.service.toLowerCase()}`);
  }
  const free = (d: string) => CALENDAR[d].map((t) => `${d} ${t}`).filter((x) => x !== s.takenSlot || !s.takenApplied);
  let offered = free(b.day);
  if (offered.length === 0) {
    const alt = DAYS.filter((d) => d !== b.day).flatMap(free).slice(0, 3);
    sim.emit("check_capacity", "failed", `${b.day} is fully booked`, `Offering nearest alternatives: ${alt.join(", ")}.`);
    sim.say("assistant", `${b.day} is fully booked, sorry. The nearest free times are below — would one of these work?`);
    offered = alt;
  } else {
    sim.emit("check_capacity", "passed", `${suburb} (${s.postcode}) in area; ${offered.length} free on ${b.day}`);
    if (!refresh) sim.say("assistant", `Good news — we can do your ${svcLabel(sim)} on ${b.day}. Which start time suits?`);
  }
  if (offered.length === 0) return callbackRequest(sim, "No capacity this week");
  s.offered = offered;
  if (sim.bool("slot_taken") && !s.takenSlot) s.takenSlot = offered[0];
  s.step = "choose";
  sim.emit("fit", "passed", `Offered ${offered.join(", ")}`, "Offered only — nothing is held yet.");
  sim.emit("choose", "waiting", "Waiting for visitor to choose a time");
  return wait(sim);
}

function select(sim: Sim<State>, idx: number) {
  const s = sim.s;
  const slot = s.offered[idx];
  if (!slot) return wait(sim);
  s.selected = slot;
  s.step = "confirm";
  const b = brief(sim);
  sim.emit("choose", "passed", `Visitor selected ${slot}`);
  sim.patch("lead", { fields: [{ label: "Selected time", value: `${slot} (not yet booked)`, tone: "warn" }] });
  sim.say("assistant", `To confirm: ${svcLabel(sim)} at postcode ${s.postcode}, ${slot}, ${aud(price(b.service, b.bedrooms) ?? 0)} for ${s.name} (${s.email}). Shall I book it?`);
  return wait(sim);
}

function confirmBooking(sim: Sim<State>) {
  const s = sim.s;
  const slot = s.selected!;
  sim.emit("save", "started", `Rechecking ${slot} before saving`);
  if (s.takenSlot === slot && !s.takenApplied) {
    s.takenApplied = true;
    s.refreshes += 1;
    sim.emit("check_booking", "failed", `${slot} was taken by another booking`, "Recheck at confirmation found the slot gone. Nothing was written.");
    sim.emit("slotgone", "info", "Slot no longer free — refreshing times", "No booking or duplicate enquiry created.");
    sim.say("assistant", `Sorry — ${slot} was just taken by another customer. Here are the times still free.`);
    s.selected = null;
    sim.patch("lead", { fields: [{ label: "Selected time", value: "None — previous choice taken", tone: "muted" }] });
    return checkFit(sim, true);
  }
  const key = `booking:${s.leadRef}`;
  s.bookingKey = key;
  if (!sim.claim(key, "save", "booking")) return wait(sim);
  const ref = sim.ref("BK");
  s.bookingRef = ref;
  sim.send({ channel: "calendar", to: "Sample scheduler", summary: `Book ${slot} — ${svcLabel(sim)}`, status: "simulated", opKey: key });
  sim.emit("check_booking", "passed", "Scheduler returned booked status", `Slot ${slot} still free at confirmation; write accepted.`, { opKey: key, ref });
  sim.emit("save", "confirmed", `Booking ${ref} confirmed`, undefined, { opKey: key, ref });
  const b = brief(sim);
  sim.record({
    id: "booking",
    title: "Appointment",
    ref,
    status: "Booking confirmed",
    tone: "ok",
    fields: [
      { label: "When", value: slot },
      { label: "Service", value: svcLabel(sim) },
      { label: "Price", value: aud(price(b.service, b.bedrooms) ?? 0) },
      { label: "Enquiry", value: s.leadRef ?? "" },
      { label: "Scheduler status", value: "Booked (sample scheduler)", tone: "ok" },
    ],
  });
  sim.patch("lead", { status: `Booked — ${ref}`, tone: "ok", fields: [{ label: "Selected time", value: slot, tone: "ok" }] });
  sim.send({ channel: "email", to: s.email ?? "", summary: `Booking confirmation ${ref}: ${slot}`, status: "held", opKey: `${key}:email` });
  sim.say("assistant", `Booked: ${slot}, reference ${ref}. A confirmation email is on its way. Anything else?`);
  s.step = "after";
  return wait(sim);
}

function callbackRequest(sim: Sim<State>, reason: string) {
  const s = sim.s;
  s.step = "done";
  const key = `callback:${s.email ?? sim.run.runId}`;
  if (sim.claim(key, "fit", "call-back request")) sim.send({ channel: "task", to: OWNER, summary: `Call-back request: ${reason}`, status: "simulated", opKey: key });
  sim.emit("fit", "stopped", "Owner call-back requested — not an appointment", reason, { opKey: key });
  sim.record({ id: "callback", title: "Owner call-back request", status: "Requested — not an appointment", tone: "warn", fields: [{ label: "Reason", value: reason }, { label: "Contact", value: s.email ?? "Not captured", tone: s.email ? "default" : "muted" }] });
  if (sim.getRecord("lead")) sim.patch("lead", { status: "Enquiry — owner call-back, not booked", tone: "warn" });
  sim.say("assistant", "I can't book that online, so I've passed your enquiry to the owner, who'll contact you. This is a call-back request, not a confirmed appointment.");
  return sim.finish("completed", { kind: "exception", summary: `${reason}. The enquiry was passed to the owner as a call-back request; no appointment was created.` });
}

function leave(sim: Sim<State>) {
  const s = sim.s;
  s.step = "done";
  sim.emit("visitor", "stopped", "Visitor closed the chat");
  if (sim.getRecord("lead")) sim.patch("lead", { status: "Enquiry saved — not booked", tone: "warn" });
  return sim.finish("stopped", {
    kind: "stopped",
    summary: sim.getRecord("lead") ? "The visitor left before confirming a time. The enquiry is saved as a lead, not an appointment." : "The visitor left before giving details. Nothing was booked.",
  });
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Uses a sample FAQ, price list and scheduler held in this page. No real booking is made and no email is sent.",
  assistantName: "Brightside assistant",
  channelLabel: "Website chat",
  fields: [
    { kind: "select", name: "first_question", label: "Visitor's first question", options: QUESTIONS, helper: "The refund question is not in the approved FAQ." },
    { kind: "select", name: "service", label: "Service", options: SERVICES },
    { kind: "select", name: "bedrooms", label: "Bedrooms", options: BEDROOMS, helper: "5+ bedroom cleans need an owner quote." },
    { kind: "text", name: "postcode", label: "Postcode", helper: `Service area: ${Object.keys(SERVICE_AREA).join(", ")}.` },
    { kind: "select", name: "day", label: "Preferred day", options: DAYS, helper: "Saturday is fully booked in the sample scheduler." },
    { kind: "text", name: "name", label: "Visitor name (sample)" },
    { kind: "text", name: "email", label: "Visitor email" },
    { kind: "toggle", name: "slot_taken", label: "Another customer takes the first time before you confirm" },
  ],
  scenarios: [
    { id: "friday_clean", label: "Friday end-of-lease clean", kind: "success", description: "Two-bedroom end-of-lease clean in Richmond on Friday.", inputs: { first_question: QUESTIONS[0], service: "End-of-lease clean", bedrooms: "2", postcode: "3121", day: "Friday", name: "Mia Chen", email: "mia@chen.example", slot_taken: false } },
    { id: "unknown_policy", label: "Unknown refund policy", kind: "exception", description: "The visitor asks about refunds. There is no approved answer, so it escalates.", inputs: { first_question: QUESTIONS[2], service: "Regular clean", bedrooms: "3", postcode: "3141", day: "Wednesday", name: "Oliver Grant", email: "oliver@grant.example", slot_taken: false } },
    { id: "fully_booked", label: "Fully booked day", kind: "exception", description: "Saturday has no capacity. Nearest free times are offered instead.", inputs: { first_question: QUESTIONS[1], service: "End-of-lease clean", bedrooms: "3", postcode: "3182", day: "Saturday", name: "Ava Russo", email: "ava@russo.example", slot_taken: false } },
    { id: "slot_taken", label: "Slot taken before confirmation", kind: "exception", description: "The chosen time goes to another customer before confirmation. Pick again; no duplicate is created.", inputs: { first_question: QUESTIONS[0], service: "End-of-lease clean", bedrooms: "2", postcode: "3181", day: "Friday", name: "Noah Patel", email: "noah@patel.example", slot_taken: true } },
    { id: "incomplete", label: "Incomplete details", kind: "exception", description: "No postcode and a mistyped email. The assistant asks until the brief is complete.", inputs: { first_question: QUESTIONS[0], service: "Oven clean", bedrooms: "1", postcode: "", day: "Thursday", name: "Leo Walsh", email: "leo.walsh@", slot_taken: false } },
  ],

  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("website-concierge", scenarioId, inputs, {
      step: "faq",
      postcode: null,
      name: null,
      email: null,
      asking: null,
      clarifyCount: 0,
      escalated: false,
      leadRef: null,
      offered: [],
      selected: null,
      takenSlot: null,
      takenApplied: false,
      refreshes: 0,
      bookingKey: null,
      bookingRef: null,
    });
    const pc = sim.str("postcode").trim();
    if (/^\d{4}$/.test(pc)) sim.s.postcode = pc;
    const q = sim.str("first_question");
    const b = brief(sim);
    sim.say("assistant", `Hi, welcome to ${BUSINESS}. How can I help?`);
    const said =
      q === QUESTIONS[0]
        ? `Is a ${svcLabel(sim)} available on ${b.day}?`
        : q === QUESTIONS[1]
          ? "Do you bring your own supplies and equipment?"
          : "What's your refund policy if I'm not happy with the clean?";
    sim.say("customer", said);
    sim.emit("visitor", "started", "Visitor question received", said);

    if (q === QUESTIONS[0]) {
      sim.emit("faq", "info", "Availability question — no FAQ answer needed");
      return collect(sim).done();
    }
    if (UNKNOWN_POLICY.test(said.toLowerCase())) return escalateUnknown(sim, said).done();
    answerFaq(sim, said.toLowerCase());
    sim.say("assistant", `Would you like me to check availability for a ${svcLabel(sim)} on ${b.day}?`);
    return wait(sim).done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;
    sim.advance(1);

    const pick = actionId.match(/^pick_(\d+)$/);
    if (pick) {
      const slot = s.offered[Number(pick[1])];
      sim.say("customer", slot ? `${slot}, please.` : "That one, please.");
      return select(sim, Number(pick[1])).done();
    }

    switch (actionId) {
      case "check_avail":
        sim.say("customer", `Yes please — is ${brief(sim).day} free?`);
        return collect(sim).done();
      case "wait_owner": {
        sim.say("customer", `I'll wait for the owner. It's ${sim.str("name")}, ${sim.str("email")}.`);
        const m = sim.str("email").match(EMAIL);
        if (m) s.email = m[0];
        return callbackRequest(sim, "Visitor is waiting for an answer the FAQ does not cover").done();
      }
      case "share_postcode":
        sim.say("customer", sim.str("postcode") ? `It's ${sim.str("postcode")}.` : "Not sure, sorry.");
        return takePostcode(sim, sim.str("postcode")).done();
      case "share_contact":
        sim.say("customer", `${sim.str("name")}, ${sim.str("email")}`);
        return takeContact(sim, sim.str("email"), sim.str("name")).done();
      case "confirm":
        sim.say("customer", "Yes, book it.");
        return confirmBooking(sim).done();
      case "rechoose":
        sim.say("customer", "Show me the other times.");
        s.step = "choose";
        s.selected = null;
        sim.emit("choose", "waiting", "Visitor wants a different time");
        return wait(sim).done();
      case "double_confirm":
        sim.emit("save", "info", "Booking request received again");
        sim.claim(s.bookingKey ?? "booking", "save", "booking");
        return wait(sim).done();
      case "finish":
        sim.say("customer", "Thanks, that's all.");
        s.step = "done";
        return sim.finish("completed", { kind: "success", summary: `Booked ${s.selected} as ${s.bookingRef} after a fresh availability check at confirmation. Enquiry ${s.leadRef} is linked to one booking.` }).done();
      case "leave":
        sim.say("customer", "(closes the chat)");
        return leave(sim).done();
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
  if (!text) {
    sim.say("assistant", "Sorry, I didn't catch that — could you type it again?");
    return wait(sim);
  }
  if (UNKNOWN_POLICY.test(text)) return escalateUnknown(sim, raw.trim());

  if (s.step === "after") {
    if (answerFaq(sim, text)) return wait(sim);
    if (LEAVE.test(text) || YES.test(text) || /thank/.test(text)) {
      s.step = "done";
      return sim.finish("completed", { kind: "success", summary: `Booked ${s.selected} as ${s.bookingRef} after a fresh availability check at confirmation.` });
    }
  }
  if (LEAVE.test(text)) return leave(sim);

  switch (s.step) {
    case "clarify":
      if (s.asking === "postcode" && /\b\d{4}\b/.test(text)) return takePostcode(sim, text);
      if (s.asking === "contact" && EMAIL.test(text)) {
        const name = raw.replace(EMAIL, "").replace(/[,.;]/g, " ").replace(/\b(it's|my name is|i'm|email|is)\b/gi, " ").trim();
        return takeContact(sim, raw, name || sim.str("name"));
      }
      if (answerFaq(sim, text)) return wait(sim);
      return clarifyFailed(sim, s.asking === "postcode" ? "Which four-digit postcode is the property in?" : "Could you type your name and a full email address?");
    case "choose": {
      const idx = s.offered.findIndex((o) => {
        const [d, ...t] = o.toLowerCase().split(" ");
        return text.includes(d) && (text.includes(t[0]) || !s.offered.some((x) => x !== o && x.toLowerCase().startsWith(d)));
      });
      if (idx >= 0) return select(sim, idx);
      const dayIdx = s.offered.findIndex((o) => text.includes(o.split(" ")[0].toLowerCase()));
      if (dayIdx >= 0) return select(sim, dayIdx);
      if (/\b(first|earliest)\b/.test(text) || YES.test(text)) return select(sim, 0);
      break;
    }
    case "confirm":
      if (YES.test(text)) return confirmBooking(sim);
      if (NO.test(text)) {
        s.step = "choose";
        s.selected = null;
        sim.emit("choose", "waiting", "Visitor wants a different time");
        sim.say("assistant", "No problem — which of these times would suit?");
        return wait(sim);
      }
      break;
    case "faq":
    case "unknown":
      if (answerFaq(sim, text)) return wait(sim);
      if (YES.test(text) || /(availab|free on|book)/.test(text)) return collect(sim);
      break;
  }
  if (answerFaq(sim, text)) return wait(sim);
  sim.emit("faq", "info", "Message not matched — no answer invented");
  sim.say("assistant", "I'm not sure I understood. I can answer questions about supplies, the bond-back re-clean, pets, cancellations and prices, or help you book.");
  return wait(sim);
}

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const websiteConcierge: Product = {
  id: "website-concierge",
  no: 2,
  slug: "website-concierge",
  name: "Website Concierge",
  outcome: "Turn website questions into booked conversations.",
  sectorLabel: "Cross sector",
  sectors: ["Home services", "Appointments", "Local orders"],
  outcomes: ["Capture enquiries", "Convert sales"],
  definition:
    "A website assistant that answers visitors' questions from your approved material only and works out which service they need. It collects the details you require and helps the visitor book a suitable next step — a confirmed appointment when capacity allows, or a clearly labelled call-back request when it does not.",
  situation:
    "A visitor on a cleaning company's website asks whether a two-bedroom end-of-lease clean is available on Friday. It is late in the evening, the owner is not at the phone, and the visitor will book whichever company answers first.",
  endState:
    "Routine questions are answered accurately, unanswerable ones reach the owner untouched, and visitors who are ready leave the website with either a confirmed booking or an honest call-back request — never a lead that looks like an appointment.",
  handles: [
    "Answers from a small approved FAQ and price list",
    "Escalates questions the FAQ does not cover, such as refunds",
    "Collects service, size, postcode and contact details, asking for anything missing",
    "Checks service area and capacity, offering the nearest times when a day is full",
    "Rechecks the slot at confirmation and books it once",
  ],
  boundaries: [
    "Never invents a policy, price or discount",
    "Never presents an enquiry or call-back request as a booked appointment",
    "Does not quote jobs outside the approved price list — the owner does",
    "The public demo writes to no real scheduler and sends no email",
  ],
  delivered: [
    { title: "Booking confirmation", body: "Service, date and time, price from the approved list and a booking reference, sent only after the scheduler confirms." },
    { title: "Owner call-back request", body: "Unanswered question or unbookable job with the visitor's contact details, clearly marked as not an appointment." },
    { title: "Enquiry record", body: "One record per visitor with service, size, postcode, source and status from qualified enquiry to booked." },
  ],
  deployment: {
    rules: [
      "Your approved FAQ and price list",
      "Service area and which jobs need a custom quote",
      "Capacity rules by service and crew",
      "Which questions go to the owner and how quickly they are answered",
    ],
    systems: ["Website chat widget", "Approved knowledge base", "Scheduling tool", "CRM"],
  },
  measures: ["Qualified enquiries", "Attended appointments", "Conversion by source"],
  reliability: [
    "Answers given without an approved source (target: zero)",
    "Duplicate bookings from retries or taken slots (target: zero)",
    "Call-back requests answered within the agreed time",
  ],
  harness: {
    systems:
      "Production uses website chat, an approved knowledge base, a scheduling tool and a CRM. The public demo uses a sample FAQ, price list and scheduler with records kept in this browser session.",
    controls: [
      "Ground every answer in approved material; unknown stays unknown",
      "Validate contact and service fields before creating an enquiry",
      "Check service area and capacity rules",
      "Recheck availability at confirmation",
      "Never present a lead submission as a completed appointment",
    ],
  },
  ctaLine: "Want this answering questions on your own website?",
  graph: {
    nodes: [
      { id: "visitor", kind: "action", row: 0, title: "Visitor question", input: "Chat message", rule: "Start session; identify intent", output: "Conversation", failure: "Visitor leaves → enquiry saved if captured", system: "Website chat (demo: in-page chat)" },
      { id: "faq", kind: "action", row: 1, title: "Answer from approved FAQ", input: "Visitor question", rule: "Match against approved FAQ and price list only", output: "Grounded answer", failure: "No approved source → unknown answer", system: "Knowledge base (demo: sample FAQ)" },
      { id: "collect", kind: "action", row: 2, title: "Collect service requirements", input: "Service, size, postcode, day, contact", rule: "Required fields and email format", output: "Enquiry record (not a booking)", failure: "Missing or invalid → clarify", system: "CRM (demo: session record)" },
      { id: "fit", kind: "action", row: 3, title: "Check fit and availability", input: "Complete brief", rule: "Service area, price list, capacity by day", output: "Offered times", failure: "Out of area or custom job → owner call-back", system: "Scheduler (demo: fixture)" },
      { id: "choose", kind: "action", row: 4, title: "Choose appointment", input: "Offered times", rule: "Visitor picks one; summary read back", output: "Selected time (not held)", failure: "Slot taken → refresh", system: "Session state" },
      { id: "save", kind: "action", row: 5, title: "Save enquiry and booking", input: "Confirmed selection", rule: "Recheck, then one write per enquiry key", output: "Booking reference and confirmation", failure: "Slot gone → no write, re-select", system: "Scheduler + email (demo: fixture + held outbox)" },
      { id: "unknown", kind: "branch", row: 1, title: "Unknown answer", input: "Question with no approved source", rule: "Do not answer; escalate to owner", output: "Owner task", failure: "—" },
      { id: "incomplete", kind: "branch", row: 2.4, title: "Incomplete brief", input: "Missing postcode or invalid email", rule: `Ask again (max ${MAX_CLARIFY}), then owner call-back`, output: "Completed field", failure: "—" },
      { id: "slotgone", kind: "branch", row: 4.4, title: "Slot no longer free", input: "Recheck at confirmation fails", rule: "Discard selection; refresh availability", output: "New list of times", failure: "—" },
      { id: "check_sources", kind: "check", row: 0.8, title: "Approved sources", input: "Candidate answer", rule: "Must come from the approved FAQ or price list", output: "Grounded / not found", failure: "Not found → escalate, never invent" },
      { id: "check_capacity", kind: "check", row: 3, title: "Service and capacity rules", input: "Postcode, service, size, day", rule: "Area allowlist, price list, free capacity", output: "Pass / fail with reason", failure: "Full day → alternatives; out of rules → call-back" },
      { id: "check_booking", kind: "check", row: 5, title: "Booking status check", input: "Scheduler response", rule: "Slot free at confirmation and write returns booked", output: "Verified booking", failure: "Taken → no write, refresh" },
    ],
    edges: [
      { from: "visitor", to: "faq", kind: "flow" },
      { from: "faq", to: "collect", kind: "flow" },
      { from: "collect", to: "fit", kind: "flow" },
      { from: "fit", to: "choose", kind: "flow" },
      { from: "choose", to: "save", kind: "flow" },
      { from: "faq", to: "unknown", kind: "return" },
      { from: "collect", to: "incomplete", kind: "return" },
      { from: "incomplete", to: "collect", kind: "return", label: "clarify" },
      { from: "choose", to: "slotgone", kind: "return" },
      { from: "slotgone", to: "fit", kind: "return", label: "refresh" },
      { from: "check_sources", to: "faq", kind: "check" },
      { from: "check_capacity", to: "fit", kind: "check" },
      { from: "check_booking", to: "save", kind: "check" },
    ],
  },
  demo,
};
