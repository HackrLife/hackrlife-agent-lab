import type { DemoAction, DemoDefinition, Product } from "../types";
import { Sim, aud, fmtClock, MIN, affirms, mentions, negated, normaliseReply } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional) — Northside Auto                               */
/* ------------------------------------------------------------------ */

const GARAGE = "Northside Auto";
const ADVISER = "Dan Okafor (service adviser)";

interface Vehicle {
  id: string;
  label: string;
  rego: string;
}

const RETURNING = { id: "C-1042", name: "Sam Whitfield", phone: "0491 570 006" };
const NEW_CUSTOMER = { name: "Jordan Lee", phone: "0491 570 156" };

/** Vehicles already on file for C-1042. */
const ON_FILE: Vehicle[] = [
  { id: "V-3310", label: "2017 Toyota Corolla hatch", rego: "BKZ-42T" },
  { id: "V-3318", label: "2021 Toyota RAV4", rego: "DFL-07M" },
];

const VEHICLES = ["Toyota Corolla hatch (2017)", "Toyota — model not stated", "Mazda 3 (2015)", "Ford Ranger (2020)"];

/** Registration the caller gives for a vehicle not on file (unless details are missing). */
const STATED_REGO: Record<string, string> = {
  "Toyota Corolla hatch (2017)": "EJP-55K",
  "Mazda 3 (2015)": "EMZ-31B",
  "Ford Ranger (2020)": "FRD-20R",
};

type ApptKey = "brake" | "diag" | "steer" | "service";

interface Symptom {
  words: string;
  appt: ApptKey;
  /** What the caller adds when the urgent-safety toggle is on. */
  safetyWords: string;
  /** Topic used in the handoff label and price answer. */
  topic: string;
}

const SYMPTOMS: Record<string, Symptom> = {
  "Noise when braking": { words: "there’s a squealing noise when I brake, mostly at low speed", appt: "brake", safetyWords: "the brake pedal feels soft and goes further to the floor than usual", topic: "brakes" },
  "Dashboard warning light": { words: "the engine warning light came on yesterday and stayed on", appt: "diag", safetyWords: "the warning light is now flashing and the engine is losing power", topic: "engine warning light" },
  "Pulls to one side": { words: "it pulls to the left when I’m driving straight", appt: "steer", safetyWords: "the steering wheel shakes hard above 60 km/h", topic: "steering" },
  "Due for logbook service": { words: "it’s due for its logbook service", appt: "service", safetyWords: "there’s a strong smell of fuel since yesterday", topic: "fuel smell" },
};

/** Standard services have an approved catalogue price; inspections of unknown faults do not. */
const SERVICE_PRICE = 329;

/** Approved appointment types only. Anything else goes to the adviser. */
const APPT_TYPES: Record<ApptKey, { name: string; minutes: number }> = {
  brake: { name: "Brake inspection", minutes: 60 },
  diag: { name: "Diagnostic scan and inspection", minutes: 60 },
  steer: { name: "Steering and suspension inspection", minutes: 60 },
  service: { name: "Standard logbook service", minutes: 180 },
};

const DAYS = ["Tomorrow (Tue)", "Wed", "Thu", "Fri"];

/** Workshop capacity fixture: free bay minutes at each start time. Thursday is fully booked. */
const CAPACITY: Record<string, { time: string; free: number; bay: string }[]> = {
  "Tomorrow (Tue)": [
    { time: "08:30", free: 90, bay: "Bay 2" },
    { time: "13:00", free: 180, bay: "Bay 1" },
  ],
  Wed: [{ time: "10:00", free: 60, bay: "Bay 3" }],
  Thu: [],
  Fri: [
    { time: "08:00", free: 240, bay: "Bay 1" },
    { time: "14:00", free: 60, bay: "Bay 2" },
  ],
};

function dayWords(day: string) {
  return day.startsWith("Tomorrow") ? "tomorrow (Tuesday)" : { Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" }[day] ?? day;
}

type Step = "confirm_vehicle" | "details" | "safety" | "slot" | "done";

interface Slot {
  day: string;
  time: string;
  bay: string;
}

interface State {
  step: Step;
  isNew: boolean;
  customerId: string;
  customerName: string;
  vehicle: Vehicle | null;
  odometer: string | null;
  appt: ApptKey;
  offered: Slot[];
  clarifications: number;
  priceAsked: boolean;
  bookingRef: string | null;
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

function slotActions(s: State): DemoAction[] {
  const acts: DemoAction[] = s.offered.map((o, i) => ({
    id: `pick_${i}`,
    label: `Choose ${dayWords(o.day)} ${o.time}`,
    actor: "customer" as const,
    tone: i === 0 ? ("primary" as const) : ("default" as const),
  }));
  acts.push(
    s.appt === "service"
      ? { id: "ask_price", label: "Ask “How much is the service?”", actor: "customer", hint: "Standard service: approved list price." }
      : { id: "ask_price", label: "Ask “How much will it cost to fix?”", actor: "customer", hint: "No price is given for an unknown fault." },
  );
  acts.push({ id: "free", label: "Type or say your own reply", actor: "customer", freeText: { placeholder: "e.g. The morning one please" } });
  return acts;
}

function vehicleRecord(sim: Sim<State>, status: string, tone: "ok" | "warn" | "muted") {
  const s = sim.s;
  sim.record({
    id: "vehicle",
    title: "Vehicle record match",
    ref: s.vehicle?.id,
    status,
    tone,
    fields: [
      { label: "Vehicle", value: s.vehicle?.label ?? "Not confirmed", tone: s.vehicle ? "default" : "muted" },
      { label: "Registration", value: s.vehicle?.rego || "Missing", tone: s.vehicle?.rego ? "default" : "warn" },
      { label: "Odometer", value: s.odometer ?? "Not supplied", tone: s.odometer ? "default" : "muted" },
    ],
  });
}

function matchCustomer(sim: Sim<State>) {
  const s = sim.s;
  const vehicleInput = sim.str("vehicle");
  sim.emit("match", "started", "Matching caller to customer and vehicle records", s.isNew ? `Caller ID ${NEW_CUSTOMER.phone}` : `Caller ID ${RETURNING.phone}`);

  if (s.isNew) {
    s.customerId = sim.ref("C");
    s.customerName = NEW_CUSTOMER.name;
    sim.emit("check_match", "passed", "No existing customer for this number — new record", `Provisional customer ${s.customerId}; nothing merged with another customer.`);
    sim.record({ id: "customer", title: "Customer record", ref: s.customerId, status: "New customer (provisional)", tone: "warn", fields: [{ label: "Name", value: s.customerName }, { label: "Phone", value: NEW_CUSTOMER.phone }] });
    const known = vehicleInput !== "Toyota — model not stated";
    s.vehicle = known ? { id: sim.ref("V"), label: vehicleInput, rego: sim.bool("missing_details") ? "" : STATED_REGO[vehicleInput] ?? "" } : null;
  } else {
    s.customerId = RETURNING.id;
    s.customerName = RETURNING.name;
    sim.record({ id: "customer", title: "Customer record", ref: RETURNING.id, status: "Matched on phone number", tone: "ok", fields: [{ label: "Name", value: RETURNING.name }, { label: "Phone", value: RETURNING.phone }, { label: "Vehicles on file", value: ON_FILE.map((v) => `${v.label} (${v.rego})`).join("; ") }] });
    if (vehicleInput === "Toyota — model not stated") {
      s.step = "confirm_vehicle";
      sim.emit("check_match", "blocked", "Two vehicles match “the Toyota” — confirmation required", "The record is not chosen automatically.");
      sim.emit("multi", "waiting", "Multiple vehicle matches", ON_FILE.map((v) => `${v.id} ${v.label}`).join(" · "));
      vehicleRecord(sim, "Awaiting customer confirmation", "warn");
      sim.say("assistant", `Thanks Sam. We have two Toyotas on your file — the Corolla hatch (${ON_FILE[0].rego}) and the RAV4 (${ON_FILE[1].rego}). Which one is it?`);
      sim.wait("waiting_customer", [
        { id: "confirm_corolla", label: "“The Corolla”", actor: "customer", tone: "primary" },
        { id: "confirm_rav4", label: "“The RAV4”", actor: "customer" },
        { id: "free", label: "Type or say your own reply", actor: "customer", freeText: { placeholder: "e.g. The hatchback" } },
      ]);
      return;
    }
    const onFile = ON_FILE.find((v) => vehicleInput.startsWith("Toyota Corolla") && v.id === "V-3310");
    s.vehicle = onFile ? { ...onFile } : { id: sim.ref("V"), label: vehicleInput, rego: sim.bool("missing_details") ? "" : STATED_REGO[vehicleInput] ?? "" };
    if (!onFile) sim.emit("match", "info", "Vehicle not on file — added to existing customer", `${vehicleInput} linked to ${RETURNING.id}.`);
  }
  if (s.vehicle && s.vehicle.rego) {
    sim.emit("check_match", "passed", `Vehicle ${s.vehicle.id} verified`, `${s.vehicle.label}, ${s.vehicle.rego}, single match for ${s.customerId}.`);
  }
  afterVehicle(sim);
}

function afterVehicle(sim: Sim<State>) {
  const s = sim.s;
  const missing = sim.bool("missing_details") || !s.vehicle || !s.vehicle.rego;
  if (missing) {
    s.step = "details";
    vehicleRecord(sim, "Details missing", "warn");
    const need = !s.vehicle ? "the make, model and registration" : !s.vehicle.rego ? "the registration" : "the current odometer reading";
    sim.emit("missing", "waiting", "Missing vehicle details — asking the customer", `Needed: ${need}.`);
    sim.say("assistant", `Before I book anything, could you tell me ${need}${need !== "the current odometer reading" ? " and roughly what the odometer reads" : ""}?`);
    sim.wait("waiting_customer", [
      { id: "give_details", label: `“${detailsReply(s)}”`, actor: "customer", tone: "primary" },
      { id: "free", label: "Type or say your own reply", actor: "customer", freeText: { placeholder: "e.g. Rego is ABC-12D" } },
    ]);
    return;
  }
  sim.emit("match", "passed", "Customer and vehicle matched");
  vehicleRecord(sim, "Verified match", "ok");
  captureSymptoms(sim);
}

function captureSymptoms(sim: Sim<State>) {
  const s = sim.s;
  const symptom = SYMPTOMS[sim.str("symptom")] ?? SYMPTOMS["Noise when braking"];
  s.appt = symptom.appt;
  sim.emit("symptoms", "started", "Capturing reported symptoms");
  sim.record({
    id: "symptoms",
    title: "Reported symptoms",
    status: "Customer’s words — not a diagnosis",
    tone: "default",
    fields: [
      { label: "Customer said", value: `“${symptom.words}”` },
      { label: "Category", value: sim.str("symptom") },
      { label: "Urgent safety concern", value: sim.bool("safety") ? "Yes — reported by customer" : "No", tone: sim.bool("safety") ? "bad" : "default" },
    ],
  });
  if (sim.bool("safety")) {
    safetyHandoff(sim, `The customer says ${symptom.safetyWords}.`, symptom.topic);
    return;
  }
  sim.emit("symptoms", "passed", "Symptoms recorded verbatim");
  selectType(sim);
}

function safetyHandoff(sim: Sim<State>, reason: string, topic: string) {
  const s = sim.s;
  s.step = "safety";
  sim.emit("safety", "waiting", "Safety concern — configured staff handoff", reason);
  sim.say("assistant", "Thanks for telling me. If the car feels unsafe to drive, please don’t drive it. I’m putting you through to our service adviser now so a person can arrange the next step.");
  const key = `${s.customerId}:safety-handoff`;
  if (sim.claim(key, "safety", "handoff")) {
    sim.send({ channel: "voice", to: ADVISER, summary: `Live transfer — safety concern (${topic})`, status: "simulated", opKey: key });
  }
  sim.patch("symptoms", { status: "Safety concern — handed to adviser", tone: "bad" });
  sim.wait("waiting_staff", [
    { id: "adviser_take", label: "Adviser: take over the call", actor: "staff", tone: "primary" },
    { id: "adviser_no_answer", label: "Adviser does not answer (10 min)", actor: "staff", tone: "danger" },
  ]);
}

function selectType(sim: Sim<State>) {
  const s = sim.s;
  const t = APPT_TYPES[s.appt];
  sim.emit("appt", "started", "Selecting a permitted appointment type");
  sim.emit("check_diag", "passed", "No diagnosis or repair price generated", `Symptom mapped to an approved type only: ${t.name} (${t.minutes} min). The technician assesses the car.`);
  sim.emit("appt", "passed", `${t.name} · ${t.minutes} min`);
  checkCapacity(sim, sim.str("preferred_day", DAYS[0]));
}

function eligible(day: string, minutes: number): Slot[] {
  return (CAPACITY[day] ?? []).filter((c) => c.free >= minutes).map((c) => ({ day, time: c.time, bay: c.bay }));
}

function checkCapacity(sim: Sim<State>, day: string) {
  const s = sim.s;
  const t = APPT_TYPES[s.appt];
  sim.emit("capacity", "started", `Checking workshop capacity for ${dayWords(day)}`, `Needs one bay for ${t.minutes} min.`);
  let slots = eligible(day, t.minutes);
  let chosenDay = day;
  if (slots.length === 0) {
    const start = Math.max(0, DAYS.indexOf(day));
    const alt = [...DAYS.slice(start + 1), ...DAYS.slice(0, start)].find((d) => eligible(d, t.minutes).length > 0);
    sim.emit("nobay", "info", `No suitable bay on ${dayWords(day)}`, alt ? `Offering the next day with capacity: ${dayWords(alt)}.` : "No capacity this week.");
    if (!alt) {
      s.step = "done";
      sim.send({ channel: "task", to: ADVISER, summary: "Call back — no capacity this week", status: "simulated" });
      sim.finish("stopped", { kind: "exception", summary: "No bay had enough time this week, so nothing was booked and the adviser has a callback task." });
      return;
    }
    chosenDay = alt;
    slots = eligible(alt, t.minutes);
    sim.say("assistant", `We don’t have a free bay ${dayWords(day)}. The next opening is ${dayWords(alt)}:`);
  }
  s.offered = slots.slice(0, 2);
  s.step = "slot";
  sim.emit("capacity", "passed", `${s.offered.length} eligible slot${s.offered.length === 1 ? "" : "s"} on ${dayWords(chosenDay)}`, s.offered.map((o) => `${o.time} ${o.bay}`).join(" · "));
  sim.say("assistant", `I can book a ${t.name.toLowerCase()} ${dayWords(chosenDay)} at ${s.offered.map((o) => o.time).join(" or ")}. Which suits you?`);
  sim.wait("waiting_customer", slotActions(s));
}

function book(sim: Sim<State>, i: number) {
  const s = sim.s;
  const slot = s.offered[i];
  if (!slot) return;
  const t = APPT_TYPES[s.appt];
  const key = `${s.vehicle?.id}:${s.appt}:${slot.day}:${slot.time}`;
  if (!sim.claim(key, "book", "booking")) return;
  sim.emit("book", "started", "Writing booking to the workshop calendar", `${slot.day} ${slot.time}, ${slot.bay}`, { opKey: key });
  const ref = sim.ref("BK");
  s.bookingRef = ref;
  sim.send({ channel: "calendar", to: `Workshop calendar · ${slot.bay}`, summary: `${ref} ${t.name} ${slot.day} ${slot.time} (${t.minutes} min)`, status: "simulated", opKey: key });
  sim.emit("check_confirm", "passed", "Workshop calendar write confirmed", `Receipt for ${ref}; bay held for ${t.minutes} min.`, { ref });
  sim.record({
    id: "booking",
    title: "Inspection booking",
    ref,
    status: "Confirmed",
    tone: "ok",
    fields: [
      { label: "Appointment", value: `${t.name} (${t.minutes} min)` },
      { label: "When", value: `${dayWords(slot.day)} ${slot.time}, ${slot.bay}` },
      { label: "Customer", value: `${s.customerName} (${s.customerId})` },
      { label: "Vehicle", value: `${s.vehicle?.label} · ${s.vehicle?.rego} (${s.vehicle?.id})` },
      { label: "Booked at", value: fmtClock(sim.run.clock) },
    ],
  });
  sim.record({
    id: "briefing",
    title: "Technician briefing",
    ref,
    status: "Ready for technician",
    tone: "default",
    fields: [
      { label: "Reported", value: SYMPTOMS[sim.str("symptom")]?.words ?? "—" },
      { label: "Diagnosis", value: "None made — technician to assess", tone: "muted" },
      { label: "Price given", value: !s.priceAsked ? "None" : s.appt === "service" ? `Standard service list price ${aud(SERVICE_PRICE)} only` : "None — customer asked; told technician will assess first", tone: "muted" },
      { label: "Odometer", value: s.odometer ?? "Not supplied", tone: s.odometer ? "default" : "muted" },
      { label: "Customer type", value: s.isNew ? "New — confirm contact details at drop-off" : "Returning" },
    ],
  });
  const smsKey = `${key}:sms`;
  if (sim.claim(smsKey, "book", "confirmation")) {
    sim.send({ channel: "sms", to: s.isNew ? NEW_CUSTOMER.phone : RETURNING.phone, summary: `Booking ${ref} confirmation with drop-off time`, status: "held", opKey: smsKey });
  }
  sim.say("assistant", `You’re booked in: ${t.name.toLowerCase()} ${dayWords(slot.day)} at ${slot.time}, reference ${ref}. The technician will check the car and we’ll contact you with an estimate before any work is done.`);
  sim.emit("book", "confirmed", `Booking ${ref} confirmed with intake note`, undefined, { ref, opKey: key });
  s.step = "done";
  sim.finish("completed", { kind: "success", summary: `${t.name} ${ref} is booked after a verified calendar write, with the vehicle matched and the customer’s own words passed to the technician. No diagnosis or price was given.` });
}

function priceAnswer(sim: Sim<State>) {
  const s = sim.s;
  s.priceAsked = true;
  const symptom = SYMPTOMS[sim.str("symptom")] ?? SYMPTOMS["Noise when braking"];
  if (s.appt === "service") {
    sim.emit("check_diag", "passed", `Standard service price quoted from the approved list: ${aud(SERVICE_PRICE)}`, "Fixed catalogue price for a known job; extra work is quoted separately.");
    sim.say("assistant", `A standard logbook service is ${aud(SERVICE_PRICE)} on our price list. If the technician finds anything else that needs doing, we’ll send you an estimate to approve first — nothing extra is done without your OK.`);
  } else {
    sim.emit("check_diag", "blocked", "Repair price request not answered — technician will assess", "An unknown fault cannot produce a guaranteed price.");
    sim.say("assistant", `I can’t give a repair price before a technician has looked at the car — the cause of ${symptom.topic === "brakes" ? "a brake noise" : symptom.topic === "steering" ? "a car pulling to one side" : "a warning light"} can vary a lot. The technician will assess it at the inspection and the service adviser will send you an estimate to approve before any work starts.`);
  }
  sim.wait("waiting_customer", slotActions(s));
}

function clarify(sim: Sim<State>, text: string) {
  sim.s.clarifications += 1;
  sim.emit(sim.s.step === "slot" ? "capacity" : "match", "info", "Reply not understood — asking again", "The assistant does not guess.");
  sim.say("assistant", text);
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Interactive simulation using a sample workshop calendar and customer file. No call is connected, no message is sent and no real booking is created.",
  assistantName: `${GARAGE} receptionist`,
  channelLabel: "Phone call or text",
  voice: true,
  fields: [
    { kind: "select", name: "vehicle", label: "Vehicle the caller mentions", options: VEHICLES, helper: "“Toyota — model not stated” matches two vehicles for a returning customer." },
    { kind: "select", name: "customer", label: "Caller", options: ["Returning", "New"], helper: "Returning = Sam Whitfield (C-1042)." },
    { kind: "select", name: "symptom", label: "Reported symptom", options: Object.keys(SYMPTOMS) },
    { kind: "select", name: "preferred_day", label: "Preferred day", options: DAYS, helper: "Thursday is fully booked." },
    { kind: "toggle", name: "missing_details", label: "Vehicle details missing" },
    { kind: "toggle", name: "safety", label: "Urgent safety concern" },
  ],
  scenarios: [
    { id: "brake_noise", label: "Brake noise, tomorrow", kind: "success", description: "Returning customer, Corolla on file, wants to come in tomorrow.", inputs: { vehicle: VEHICLES[0], customer: "Returning", symptom: "Noise when braking", preferred_day: DAYS[0], missing_details: false, safety: false } },
    { id: "two_vehicles", label: "Two vehicles match", kind: "exception", description: "The caller says “the Toyota” and has two on file. The receptionist must ask which.", inputs: { vehicle: VEHICLES[1], customer: "Returning", symptom: "Noise when braking", preferred_day: DAYS[0], missing_details: false, safety: false } },
    { id: "new_missing", label: "New caller, details missing", kind: "exception", description: "A new customer has not given a registration. It is collected before booking.", inputs: { vehicle: VEHICLES[2], customer: "New", symptom: "Noise when braking", preferred_day: "Wed", missing_details: true, safety: false } },
    { id: "safety", label: "Urgent safety concern", kind: "exception", description: "The caller reports an urgent safety concern with the symptom. Automated booking stops and the adviser takes over.", inputs: { vehicle: VEHICLES[0], customer: "Returning", symptom: "Noise when braking", preferred_day: DAYS[0], missing_details: false, safety: true } },
    { id: "no_bay", label: "No bay on the chosen day", kind: "exception", description: "Thursday is full. The next day with a suitable bay is offered.", inputs: { vehicle: VEHICLES[0], customer: "Returning", symptom: "Due for logbook service", preferred_day: "Thu", missing_details: false, safety: false } },
  ],
  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("garage-receptionist", scenarioId, inputs, {
      step: "done",
      isNew: false,
      customerId: "",
      customerName: "",
      vehicle: null,
      odometer: null,
      appt: "brake",
      offered: [],
      clarifications: 0,
      priceAsked: false,
      bookingRef: null,
    });
    sim.s.isNew = sim.str("customer") === "New";
    const symptom = SYMPTOMS[sim.str("symptom")] ?? SYMPTOMS["Noise when braking"];
    const vehicle = sim.str("vehicle");
    const vehicleWords = vehicle === "Toyota — model not stated" ? "my Toyota" : `my ${vehicle.replace(/ \(\d{4}\)$/, "")}`;
    sim.say("customer", `Hi, ${vehicleWords} — ${symptom.words}${sim.bool("safety") ? `, and ${symptom.safetyWords}` : ""}. Can I bring it in ${dayWords(sim.str("preferred_day", DAYS[0]))}?`);
    sim.emit("intake", "started", "Call received", sim.s.isNew ? `Unknown number ${NEW_CUSTOMER.phone}` : `Known number ${RETURNING.phone}`);
    sim.emit("intake", "passed", "Enquiry captured");
    matchCustomer(sim);
    return sim.done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;
    sim.advance(1 * MIN);

    switch (actionId) {
      case "confirm_corolla":
      case "confirm_rav4": {
        if (s.step !== "confirm_vehicle") return sim.done();
        sim.say("customer", actionId === "confirm_corolla" ? "The Corolla." : "The RAV4.");
        confirmVehicle(sim, actionId === "confirm_corolla" ? ON_FILE[0] : ON_FILE[1]);
        return sim.done();
      }

      case "give_details": {
        if (s.step !== "details") return sim.done();
        sim.say("customer", detailsReply(s));
        if (!s.vehicle) s.vehicle = { id: sim.ref("V"), label: "2019 Toyota Yaris", rego: "EYT-19C" };
        else if (!s.vehicle.rego) s.vehicle.rego = STATED_REGO[s.vehicle.label] ?? "EYT-19C";
        s.odometer = s.vehicle.id === "V-3310" ? "96,400 km (customer stated)" : "142,000 km (customer stated)";
        sim.emit("missing", "passed", "Missing details collected");
        sim.emit("check_match", "passed", `Vehicle ${s.vehicle.id} details complete`, `${s.vehicle.label}, ${s.vehicle.rego}.`);
        afterVehicle2(sim);
        return sim.done();
      }

      case "pick_0":
      case "pick_1": {
        if (s.step !== "slot") return sim.done();
        const i = actionId === "pick_0" ? 0 : 1;
        if (!s.offered[i]) return sim.done();
        sim.say("customer", `${cap(dayWords(s.offered[i].day))} at ${s.offered[i].time} works.`);
        book(sim, i);
        return sim.done();
      }

      case "ask_price": {
        if (s.step !== "slot") return sim.done();
        sim.say("customer", s.appt === "service" ? "How much is the service?" : "How much will it cost to fix?");
        priceAnswer(sim);
        return sim.done();
      }

      case "adviser_take": {
        if (s.step !== "safety") return sim.done();
        s.step = "done";
        sim.say("staff", `Dan: Hi ${s.customerName.split(" ")[0]}, Dan from ${GARAGE}. Leave the car where it is — I’ll sort out getting it to us safely.`);
        sim.emit("safety", "confirmed", "Adviser took over — automated booking stopped");
        sim.patch("customer", { fields: [{ label: "Owner", value: ADVISER }] });
        return sim.finish("completed", { kind: "exception", summary: "A safety concern was reported, so the receptionist followed the configured handoff and the service adviser took over. No automated booking or advice was given." }).done();
      }

      case "adviser_no_answer": {
        if (s.step !== "safety") return sim.done();
        s.step = "done";
        sim.advance(10 * MIN);
        sim.emit("safety", "failed", "Adviser did not answer within 10 minutes");
        sim.send({ channel: "task", to: "Urgent callback queue (owner)", summary: "Safety concern — call customer back", status: "pending" });
        sim.say("assistant", "Our adviser is on another call. I’ve marked this urgent and someone will ring you back shortly. Please don’t drive the car if it feels unsafe.");
        return sim.finish("stopped", { kind: "exception", summary: "The adviser was not reached, so an urgent callback task is pending in the owner’s queue. Nothing was booked automatically." }).done();
      }

      case "free": {
        const text = String(payload ?? "").trim();
        const t = normaliseReply(text);
        sim.say("customer", text || "…");
        if (s.step === "confirm_vehicle") {
          const COROLLA = /\b(corolla|hatch|hatchback|bkz)/;
          const RAV = /\b(rav ?4?|dfl|suv)\b/;
          const c = mentions(t, COROLLA) && !negated(t, COROLLA);
          const r = mentions(t, RAV) && !negated(t, RAV);
          if (c && !r) return confirmVehicle(sim, ON_FILE[0]).done();
          if (r && !c) return confirmVehicle(sim, ON_FILE[1]).done();
          clarify(sim, `Sorry, I need to be sure which car — is it the Corolla hatch (${ON_FILE[0].rego}) or the RAV4 (${ON_FILE[1].rego})?`);
          return sim.done();
        }
        if (s.step === "details") {
          const rego = (text.match(/\b[a-z0-9]{2,3}[- ]?[a-z0-9]{2,3}\b/gi) ?? []).find((w) => /[a-z]/i.test(w) && /\d/.test(w));
          const km = text.match(/(\d[\d,]{3,})\s*(k|km)/i);
          if (km) s.odometer = `${km[1]} km (customer stated)`;
          if (s.vehicle?.rego && km) {
            sim.emit("missing", "passed", "Odometer reading collected");
            afterVehicle2(sim);
            return sim.done();
          }
          if (rego && !s.vehicle?.rego) {
            s.vehicle = { id: s.vehicle?.id ?? sim.ref("V"), label: s.vehicle?.label ?? "Vehicle (model to confirm at drop-off)", rego: rego.toUpperCase() };
            sim.emit("missing", "passed", `Registration ${s.vehicle.rego} collected`);
            sim.emit("check_match", "passed", `Vehicle ${s.vehicle.id} details complete`);
            afterVehicle2(sim);
            return sim.done();
          }
          clarify(sim, s.vehicle?.rego ? "Sorry, I didn’t catch the odometer reading — roughly how many kilometres is it on?" : "Sorry, I didn’t catch a registration. Could you read it out, for example ABC-12D?");
          return sim.done();
        }
        if (s.step === "slot") {
          // Phrases that are unsafe even though they contain a negation word.
          const HARD_SAFETY = /\b(not safe|won't stop|can't stop|doesn't stop|pedal|smoke|smoking|burning|fuel smell|smell of fuel|flashing)\b/;
          const SOFT_SAFETY = /\b(unsafe|dangerous|scared to drive)\b/;
          if (mentions(t, HARD_SAFETY) || (mentions(t, SOFT_SAFETY) && !negated(t, SOFT_SAFETY))) {
            safetyHandoff(sim, `Customer said: “${text}”.`, "reported by customer");
            return sim.done();
          }
          const PRICE = /\b(price|cost|how much|cheap|cheaper|quote)\b|\$/;
          if (mentions(t, PRICE)) {
            priceAnswer(sim);
            return sim.done();
          }
          const CANCEL = /\b(cancel|never mind|forget it|don't book|do not book)\b/;
          if ((mentions(t, CANCEL) && !negated(t, /\b(cancel|never mind|forget it)\b/)) || /^\s*(no|nope|nah)\b(?!.*\b(book|slot|time|\d))/.test(t)) {
            s.step = "done";
            sim.emit("capacity", "stopped", "Customer ended the enquiry — nothing booked");
            sim.say("assistant", "No problem, nothing has been booked. Call or text us whenever you’re ready.");
            return sim.finish("stopped", { kind: "stopped", summary: "The customer ended the enquiry before choosing a time, so no booking was written." }).done();
          }
          const idx = s.offered.findIndex((o) => {
            const re = new RegExp(`\\b(${o.time}|${o.time.replace(/^0/, "")})\\b`);
            return mentions(t, re) && !negated(t, re);
          });
          const MORNING = /\b(first|earlier|earliest|morning)\b/;
          const LATER = /\b(second|later|afternoon)\b/;
          const pick =
            idx >= 0 ? idx
            : mentions(t, MORNING) && !negated(t, MORNING) ? 0
            : mentions(t, LATER) && !negated(t, LATER) && s.offered.length > 1 ? 1
            : affirms(t) && s.offered.length === 1 ? 0
            : -1;
          if (pick >= 0) {
            book(sim, pick);
            return sim.done();
          }
          clarify(sim, `Sorry, I didn’t catch which time suits. I have ${s.offered.map((o) => `${dayWords(o.day)} ${o.time}`).join(" or ")}.`);
          return sim.wait("waiting_customer", slotActions(s)).done();
        }
        return sim.done();
      }
    }
    return sim.done();
  },
};

function cap(x: string) {
  return x.charAt(0).toUpperCase() + x.slice(1);
}

function detailsReply(s: State): string {
  if (!s.vehicle) return "It’s a 2019 Toyota Yaris, rego EYT-19C, about 142,000 km.";
  if (!s.vehicle.rego) return `Rego is ${STATED_REGO[s.vehicle.label] ?? "EYT-19C"}, and it’s done about 142,000 km.`;
  return "It’s on about 96,400 km.";
}

function confirmVehicle(sim: Sim<State>, v: Vehicle) {
  sim.s.vehicle = { ...v };
  sim.emit("multi", "passed", `Customer confirmed ${v.label}`);
  sim.emit("check_match", "passed", `Vehicle ${v.id} verified`, `${v.label}, ${v.rego}, confirmed by the customer.`);
  afterVehicle(sim);
  return sim;
}

/** After details are collected: show the verified vehicle, then continue to symptoms. */
function afterVehicle2(sim: Sim<State>) {
  sim.emit("match", "passed", "Customer and vehicle matched");
  vehicleRecord(sim, "Verified match", "ok");
  captureSymptoms(sim);
}

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const garageReceptionist: Product = {
  id: "garage-receptionist",
  no: 6,
  slug: "garage-receptionist",
  name: "Garage Receptionist",
  outcome: "Collect the details before the car arrives.",
  sectorLabel: "Independent mechanics and mobile mechanics",
  sectors: ["Automotive"],
  outcomes: ["Capture enquiries"],
  definition:
    "A phone and text receptionist that matches each caller to their customer and vehicle records and reserves an inspection or an approved standard service in a bay with enough time. It records the symptoms in the customer’s own words for the technician and never diagnoses the vehicle or prices an unknown fault.",
  situation:
    "A driver calls while the mechanic is under a car: there’s a noise when braking and they want to bring it in tomorrow. Someone has to find the right vehicle, check the workshop has a bay free and write down what the customer heard — usually by stopping work.",
  endState:
    "Every call ends with a verified vehicle, the symptoms written down and either a confirmed inspection in a bay that fits or a person handling it. The technician starts with a briefing, not a phone message.",
  handles: [
    "Matches callers and vehicles, and asks when more than one vehicle fits",
    "Collects missing registration and odometer details before booking",
    "Maps symptoms to approved appointment types with set durations",
    "Offers only slots with a free bay long enough for the job",
    "Hands safety concerns straight to the service adviser",
  ],
  boundaries: [
    "Never diagnoses a fault or quotes a repair price — the technician assesses first",
    "Never picks between matching vehicles without the customer confirming",
    "Does not book when the customer reports an urgent safety concern",
  ],
  delivered: [
    { title: "Booking confirmation", body: "Inspection type, day, time and reference, with a note that an estimate follows the technician’s check." },
    { title: "Safety handoff", body: "Live transfer or urgent callback task for the service adviser, with the customer’s words and vehicle record." },
    { title: "Technician briefing", body: "Vehicle, odometer, reported symptoms verbatim, appointment length and a record that no diagnosis or price was given." },
  ],
  deployment: {
    rules: [
      "Your approved appointment types, durations and bay rules",
      "Which symptoms count as urgent safety concerns and who takes them",
      "Your customer and vehicle matching rules",
      "Opening hours, capacity and how far ahead to book",
    ],
    systems: ["Phone and SMS or chat", "Your garage management system", "Customer and vehicle history", "Workshop calendar"],
  },
  measures: ["Completed inspection bookings", "Reduction in intake interruptions for the workshop"],
  reliability: [
    "Bookings made on an unconfirmed vehicle (target: zero)",
    "Safety concerns booked without a handoff (target: zero)",
    "Duplicate calendar writes (target: zero)",
  ],
  harness: {
    systems:
      "Production connects telephony or chat, the garage management system, customer and vehicle history and the workshop calendar. The demo uses a fictional customer file for Northside Auto, a fixed capacity table and an outbox that holds every message.",
    controls: [
      "Identity and vehicle matching; ambiguous matches need customer confirmation",
      "Diagnosis stays with the technician; no price for an unknown fault",
      "Only approved appointment types, each with a set duration",
      "Safety concerns follow the configured adviser handoff",
      "Bookings are confirmed only after a verified calendar write",
    ],
  },
  ctaLine: "Want this answering calls for your workshop?",
  graph: {
    nodes: [
      { id: "intake", kind: "action", row: 0, title: "Call or message", input: "Call or text from a driver", rule: "Capture caller ID and request", output: "Enquiry", failure: "—", system: "Telephony/chat (demo: simulated call)" },
      { id: "match", kind: "action", row: 1, title: "Match customer and vehicle", input: "Caller ID, vehicle description", rule: "Match customer by phone, vehicle by model/rego", output: "Customer and vehicle record", failure: "Several matches → confirm; missing details → ask", system: "Garage management system (demo: fixture)" },
      { id: "symptoms", kind: "action", row: 2, title: "Capture reported symptoms", input: "Customer’s description", rule: "Record verbatim; flag safety concerns", output: "Reported symptoms record", failure: "Safety concern → adviser handoff", system: "Session state" },
      { id: "appt", kind: "action", row: 3, title: "Select permitted appointment type", input: "Symptom category", rule: "Map to approved types with set durations", output: "Appointment type and length", failure: "No approved type → adviser", system: "Approved type table (demo: fixture)" },
      { id: "capacity", kind: "action", row: 4, title: "Check workshop capacity", input: "Preferred day, duration", rule: "Bay free for the full duration", output: "Eligible slots", failure: "No bay → alternative day", system: "Workshop calendar (demo: fixture)" },
      { id: "book", kind: "action", row: 5, title: "Book inspection and intake note", input: "Chosen slot", rule: "One write per operation key; confirmation held", output: "Booking + technician briefing", failure: "Write not confirmed → no booking shown", system: "Workshop calendar + SMS (demo: simulated/held)" },
      { id: "multi", kind: "branch", row: 0.6, title: "Multiple vehicle matches", input: "More than one vehicle fits", rule: "Ask the customer which one", output: "Confirmed vehicle", failure: "—" },
      { id: "missing", kind: "branch", row: 1.4, title: "Missing vehicle details", input: "No rego or odometer", rule: "Ask before booking", output: "Completed vehicle record", failure: "—" },
      { id: "safety", kind: "branch", row: 2.5, title: "Safety concern", input: "Urgent safety concern reported", rule: "Stop; configured handoff to service adviser", output: "Live transfer or urgent callback", failure: "—" },
      { id: "nobay", kind: "branch", row: 4.3, title: "No suitable bay", input: "No slot long enough", rule: "Offer the next day with capacity", output: "Alternative slots", failure: "—" },
      { id: "check_match", kind: "check", row: 0.9, title: "Verified vehicle match", input: "Candidate records", rule: "Exactly one confirmed vehicle", output: "Verified vehicle ID", failure: "Ambiguous → blocked until confirmed" },
      { id: "check_diag", kind: "check", row: 3, title: "No automated diagnosis", input: "Symptom, price questions", rule: "No diagnosis; no price for an unknown fault", output: "Approved type only", failure: "Price request → technician will assess" },
      { id: "check_confirm", kind: "check", row: 5, title: "Workshop confirmation", input: "Calendar write", rule: "Receipt required before confirming", output: "Booking reference", failure: "No receipt → not confirmed" },
    ],
    edges: [
      { from: "intake", to: "match", kind: "flow" },
      { from: "match", to: "symptoms", kind: "flow" },
      { from: "symptoms", to: "appt", kind: "flow" },
      { from: "appt", to: "capacity", kind: "flow" },
      { from: "capacity", to: "book", kind: "flow" },
      { from: "match", to: "multi", kind: "return" },
      { from: "multi", to: "match", kind: "return", label: "confirm" },
      { from: "match", to: "missing", kind: "return" },
      { from: "missing", to: "match", kind: "return", label: "ask" },
      { from: "symptoms", to: "safety", kind: "return" },
      { from: "capacity", to: "nobay", kind: "return" },
      { from: "nobay", to: "capacity", kind: "return", label: "alternative day" },
      { from: "check_match", to: "match", kind: "check" },
      { from: "check_diag", to: "appt", kind: "check" },
      { from: "check_confirm", to: "book", kind: "check" },
    ],
  },
  demo,
};
