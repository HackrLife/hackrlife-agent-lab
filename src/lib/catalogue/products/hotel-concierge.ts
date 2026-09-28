import type { DemoDefinition, Product, Run } from "../types";
import { Sim, aud, HOUR } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

const PROPERTY = "Saltbush Guesthouse";

interface Room {
  id: string;
  name: string;
  maxGuests: number;
  maxAdults: number;
  childSpace: boolean;
  rate: number;
  note: string;
}

/** Sample inventory with deterministic occupancy rules. */
const ROOMS: Room[] = [
  { id: "garden", name: "Garden Queen", maxGuests: 2, maxAdults: 2, childSpace: false, rate: 165, note: "Queen bed, garden view" },
  { id: "loft", name: "Loft Twin", maxGuests: 2, maxAdults: 2, childSpace: false, rate: 180, note: "Two singles, upstairs" },
  { id: "courtyard", name: "Courtyard King", maxGuests: 3, maxAdults: 2, childSpace: true, rate: 210, note: "King bed plus a cot or child fold-out" },
  { id: "family", name: "Family Suite", maxGuests: 4, maxAdults: 2, childSpace: true, rate: 245, note: "Queen bed plus separate kids’ room with two singles" },
];

const DATES = ["Fri 14 Nov", "Fri 21 Nov", "Fri 28 Nov", "Sat 6 Dec"];
/** Rooms already sold for a stay starting on that date (sample PMS snapshot). */
const SOLD_OUT: Record<string, string[]> = {
  "Fri 14 Nov": ["garden"],
  "Fri 21 Nov": ["loft", "courtyard", "family"],
  "Fri 28 Nov": [],
  "Sat 6 Dec": ["family"],
};
const PARKING_FULL = ["Fri 21 Nov"];
const PARKING_RATE = 15;
const MAX_PAY_ATTEMPTS = 2;

/** Approved property facts — the only things the concierge may state. */
const FACTS: { keys: RegExp; answer: string }[] = [
  { keys: /breakfast/, answer: "Continental breakfast is included for every guest, served 7:30–10:00 in the dining room." },
  { keys: /park|\bcars?\b/, answer: `There are four on-site parking spaces at ${aud(PARKING_RATE)} per night, booked with the room. Unrestricted street parking is available on Banksia Lane.` },
  { keys: /check.?in|check.?out|arrive|arrival|late/, answer: "Check-in is from 2pm and check-out is by 10am. Self check-in with a key code is available until 9pm." },
  { keys: /cot|high.?chair|kid|child|baby/, answer: "We supply a cot and a high chair free of charge in the Courtyard King and Family Suite. Please request them at checkout." },
  { keys: /cancel|refund/, answer: "Free cancellation up to 7 days before arrival. Within 7 days the first night is charged." },
  { keys: /wifi|wi-fi|internet/, answer: "Free wifi is available throughout the guesthouse." },
  { keys: /pet|dog/, answer: "We are unable to accommodate pets, except assistance animals." },
];
const ACCESS = /(accessib|wheelchair|step.?free|disab|mobility|roll.?in|lift|ramp|grab rail|hearing loop)/;

type Step = "choosing_room" | "choosing_date" | "at_checkout" | "payment_failed" | "done";

interface State {
  step: Step;
  date: string;
  roomId: string | null;
  checkoutRef: string | null;
  attempt: number;
  failures: number;
  takenElsewhere: string[];
  unclear: number;
  handoffs: number;
}

/* ------------------------------------------------------------------ */
/* Deterministic rules                                                 */
/* ------------------------------------------------------------------ */

function party(sim: Sim<State>) {
  const adults = Math.max(0, Math.round(sim.num("adults", 2)));
  const children = Math.max(0, Math.round(sim.num("children", 0)));
  const nights = Math.max(0, Math.round(sim.num("nights", 2)));
  return { adults, children, guests: adults + children, nights, parking: sim.bool("parking"), requirement: sim.str("requirement", "None") };
}

function fitReason(room: Room, p: ReturnType<typeof party>): string | null {
  if (p.guests > room.maxGuests) return `sleeps ${room.maxGuests}, party is ${p.guests}`;
  if (p.adults > room.maxAdults) return `max ${room.maxAdults} adults`;
  if (p.children > 0 && !room.childSpace) return "no space for a child";
  return null;
}

function soldOut(sim: Sim<State>, date: string, roomId: string) {
  return (SOLD_OUT[date] ?? []).includes(roomId) || sim.s.takenElsewhere.includes(`${date}:${roomId}`);
}

function eligibleRooms(sim: Sim<State>, date: string) {
  const p = party(sim);
  return ROOMS.filter((r) => !fitReason(r, p) && !soldOut(sim, date, r.id));
}

function quote(sim: Sim<State>, room: Room) {
  const p = party(sim);
  const parkingOk = p.parking && !PARKING_FULL.includes(sim.s.date);
  const rooms = room.rate * p.nights;
  const parking = parkingOk ? PARKING_RATE * p.nights : 0;
  return { rooms, parking, total: rooms + parking, parkingOk };
}

function roomActions(sim: Sim<State>): Run["actions"] {
  const rooms = eligibleRooms(sim, sim.s.date);
  const actions: Run["actions"] = rooms.map((r, i) => ({
    id: `choose_${r.id}`,
    label: `Book ${r.name} — ${aud(r.rate)}/night`,
    actor: "customer" as const,
    tone: i === 0 ? ("primary" as const) : ("default" as const),
  }));
  actions.push(
    { id: "ask_breakfast", label: "Ask: “Is breakfast included?”", actor: "customer" },
    { id: "ask_access", label: "Ask: “Is the room step-free with a roll-in shower?”", actor: "customer", hint: "Not in the approved property facts." },
    { id: "free", label: "Type your own question", actor: "customer", freeText: { placeholder: "e.g. What time is check-in?" } },
  );
  return actions;
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

function findRooms(sim: Sim<State>) {
  const s = sim.s;
  const p = party(sim);
  sim.emit("find", "started", `Searching inventory for ${s.date}`, `${p.nights} night${p.nights === 1 ? "" : "s"}, ${p.adults} adult${p.adults === 1 ? "" : "s"}, ${p.children} child${p.children === 1 ? "" : "ren"}`);
  const rows = ROOMS.map((r) => {
    const why = fitReason(r, p);
    const gone = soldOut(sim, s.date, r.id);
    return { r, why, gone };
  });
  for (const { r, why } of rows) if (why) sim.emit("check_inventory", "failed", `${r.name} excluded — ${why}`, "Occupancy rule.");
  for (const { r, why, gone } of rows) if (!why && gone) sim.emit("check_inventory", "failed", `${r.name} sold out on ${s.date}`);
  const eligible = rows.filter((x) => !x.why && !x.gone).map((x) => x.r);
  sim.record({
    id: "match",
    title: "Room match",
    status: eligible.length ? `${eligible.length} eligible room${eligible.length === 1 ? "" : "s"}` : "No eligible room",
    tone: eligible.length ? "ok" : "bad",
    fields: rows.map(({ r, why, gone }) => ({
      label: r.name,
      value: why ? `Excluded — ${why}` : gone ? `Sold out ${s.date}` : `${aud(r.rate)}/night · ${aud(r.rate * p.nights)} for ${p.nights} nights`,
      tone: why || gone ? ("muted" as const) : ("ok" as const),
    })),
  });

  if (!eligible.length) {
    const fitsAny = ROOMS.some((r) => !fitReason(r, p));
    if (!fitsAny) {
      sim.emit("noroom", "stopped", `No single room sleeps a party of ${p.guests}`, "Handed to staff to quote connecting rooms.");
      sim.send({ channel: "task", to: "Front desk (Sam)", summary: `Quote two rooms for ${p.guests} guests, ${s.date}`, status: "simulated", opKey: `enquiry:${s.date}:multiroom` });
      sim.say("assistant", `None of our rooms sleeps ${p.guests} on its own. I’ve asked Sam at the front desk to put together a two-room option and email you — I won’t guess a price.`);
      s.step = "done";
      return sim.finish("stopped", { kind: "exception", summary: `No room meets the occupancy rules for ${p.guests} guests, so nothing was offered. Staff will quote a two-room option.` });
    }
    const alternatives = DATES.filter((d) => d !== s.date && eligibleRooms(sim, d).length > 0);
    sim.emit("noroom", "info", `No eligible room on ${s.date} — suggesting alternatives`, alternatives.join(", ") || "none found");
    sim.say("assistant", alternatives.length
      ? `Sorry, we’re fully booked for a party your size from ${s.date}. We do have space from ${alternatives.slice(0, 2).join(" or ")}. Would either work?`
      : `Sorry, we’re fully booked for a party your size on those dates and I can’t see an alternative nearby.`);
    s.step = "choosing_date";
    const actions: Run["actions"] = alternatives.slice(0, 2).map((d, i) => ({ id: `date_${DATES.indexOf(d)}`, label: `Try ${d} instead`, actor: "customer" as const, tone: i === 0 ? ("primary" as const) : ("default" as const) }));
    actions.push({ id: "no_thanks", label: "No thanks", actor: "customer", tone: "danger" });
    return sim.wait("waiting_customer", actions);
  }
  sim.emit("check_inventory", "passed", `${eligible.length} room${eligible.length === 1 ? "" : "s"} fit the party and are free`, "Live sample inventory and current rates.");
  sim.emit("find", "passed", `Matched: ${eligible.map((r) => r.name).join(", ")}`);
  return explain(sim, eligible);
}

function explain(sim: Sim<State>, eligible: Room[]) {
  const s = sim.s;
  const p = party(sim);
  sim.emit("explain", "started", "Explaining options and policies");
  const lines = eligible.map((r) => `${r.name} (${r.note}) — ${aud(r.rate)}/night, ${aud(r.rate * p.nights)} for ${p.nights} nights`);
  let parkingLine = "";
  if (p.parking) {
    parkingLine = PARKING_FULL.includes(s.date)
      ? ` On-site parking is fully booked for those dates; unrestricted street parking is available on Banksia Lane.`
      : ` On-site parking is available at ${aud(PARKING_RATE)} per night.`;
  }
  sim.say("assistant", `For ${s.date}, these rooms suit your party: ${lines.join("; ")}.${parkingLine} Breakfast is included and cancellation is free up to 7 days before arrival.`);
  sim.emit("check_facts", "passed", "Policies quoted from approved property facts", "Parking, breakfast and cancellation.");
  if (p.requirement.startsWith("Step-free")) {
    unsupported(sim, "Step-free access with a roll-in shower");
  } else if (p.requirement === "Cot or child bed") {
    sim.emit("check_facts", "passed", "Cot request covered by approved facts");
  }
  sim.emit("explain", "waiting", "Waiting for the guest to choose");
  s.step = "choosing_room";
  return sim.wait("waiting_customer", roomActions(sim));
}

function unsupported(sim: Sim<State>, topic: string) {
  const s = sim.s;
  sim.emit("check_facts", "blocked", `No approved fact for “${topic}”`, "The concierge does not guess or promise.");
  sim.say("assistant", `I don’t have confirmed information about ${topic.toLowerCase()}, so I won’t guess. I’ve asked our team to check the room and reply to you directly before you book.`);
  const key = `enquiry:handoff:${topic.toLowerCase().replace(/\s+/g, "-").slice(0, 40)}`;
  if (!sim.run.opKeys.includes(key)) {
    sim.claim(key, "unknown");
    s.handoffs += 1;
    sim.send({ channel: "task", to: "Front desk (Sam)", summary: `Guest question needs a verified answer: ${topic}`, status: "simulated", opKey: key });
    sim.emit("unknown", "info", "Unknown property detail — handed to staff", topic, { opKey: key });
    sim.record({ id: "handoff", title: "Staff question", status: "Assigned to front desk", tone: "warn", fields: [{ label: "Question", value: topic }, { label: "Promise made", value: "None", tone: "ok" }] });
  } else {
    sim.emit("unknown", "info", "Already with staff — not duplicated", topic);
  }
}

function openCheckout(sim: Sim<State>, room: Room) {
  const s = sim.s;
  const p = party(sim);
  s.roomId = room.id;
  sim.emit("checkout", "started", `Opening checkout for ${room.name}`);
  if (soldOut(sim, s.date, room.id)) return roomGone(sim, room);
  sim.emit("check_inventory", "passed", `Live recheck: ${room.name} still free on ${s.date}`, `Rate ${aud(room.rate)}/night confirmed current.`);
  const q = quote(sim, room);
  s.checkoutRef = sim.ref("CO");
  sim.record({
    id: "checkout",
    title: "Checkout summary",
    ref: s.checkoutRef,
    status: "Reservation intent — awaiting payment",
    tone: "warn",
    fields: [
      { label: "Room", value: room.name },
      { label: "Arrival", value: `${s.date}, ${p.nights} night${p.nights === 1 ? "" : "s"}` },
      { label: "Guests", value: `${p.adults} adult${p.adults === 1 ? "" : "s"}, ${p.children} child${p.children === 1 ? "" : "ren"}` },
      { label: "Room charge", value: aud(q.rooms) },
      { label: "Parking", value: p.parking ? (q.parkingOk ? aud(q.parking) : "Full — street parking") : "Not requested", tone: p.parking && !q.parkingOk ? "warn" : "default" },
      { label: "Total", value: aud(q.total) },
      { label: "Card details", value: "Not collected — simulated checkout", tone: "muted" },
    ],
  });
  sim.emit("checkout", "waiting", `Checkout ${s.checkoutRef} opened — ${aud(q.total)}`, "Sample checkout. No card details are collected; payment is a simulated event.", { ref: s.checkoutRef });
  sim.say("assistant", `Here’s your checkout for the ${room.name}: ${aud(q.total)} in total. This is a sample checkout, so you’ll just choose whether the payment succeeds or fails.`);
  s.step = "at_checkout";
  return sim.wait("waiting_customer", checkoutActions());
}

function checkoutActions(): Run["actions"] {
  return [
    { id: "pay_ok", label: "Simulate payment success event", actor: "customer", tone: "primary" },
    { id: "pay_fail", label: "Simulate payment failure event", actor: "customer", tone: "danger" },
    { id: "taken", label: "Another guest books this room first", actor: "clock", hint: "Tests the live inventory recheck." },
  ];
}

function roomGone(sim: Sim<State>, room: Room) {
  const s = sim.s;
  sim.emit("check_inventory", "failed", `Live recheck: ${room.name} no longer available`, "No payment is taken for a room that is gone.");
  sim.patch("checkout", { status: "Cancelled — room no longer available", tone: "bad" });
  const others = eligibleRooms(sim, s.date);
  sim.emit("noroom", "info", `${room.name} sold before payment`, others.length ? `Still free: ${others.map((r) => r.name).join(", ")}` : "Suggesting other dates.");
  if (others.length) {
    sim.say("assistant", `Sorry — the ${room.name} was just booked by someone else, so I haven’t taken any payment. The ${others.map((r) => r.name).join(" and ")} ${others.length === 1 ? "is" : "are"} still free for your dates.`);
    s.step = "choosing_room";
    return explain(sim, others);
  }
  const alternatives = DATES.filter((d) => d !== s.date && eligibleRooms(sim, d).length > 0);
  sim.say("assistant", `Sorry — that room was just booked by someone else, so I haven’t taken any payment. We do have space from ${alternatives.slice(0, 2).join(" or ")}.`);
  s.step = "choosing_date";
  const actions: Run["actions"] = alternatives.slice(0, 2).map((d, i) => ({ id: `date_${DATES.indexOf(d)}`, label: `Try ${d} instead`, actor: "customer" as const, tone: i === 0 ? ("primary" as const) : ("default" as const) }));
  actions.push({ id: "no_thanks", label: "No thanks", actor: "customer", tone: "danger" });
  return sim.wait("waiting_customer", actions);
}

function handleQuestion(sim: Sim<State>, text: string) {
  const s = sim.s;
  const t = text.toLowerCase();
  sim.advance(2);
  sim.say("customer", text);
  sim.emit("explain", "info", "Guest question received");
  if (ACCESS.test(t)) {
    unsupported(sim, "Step-free access and accessible bathroom details");
    return sim.wait("waiting_customer", roomActions(sim));
  }
  const fact = FACTS.find((f) => f.keys.test(t));
  if (fact) {
    sim.emit("check_facts", "passed", "Answered from approved property facts");
    sim.say("assistant", fact.answer);
    return sim.wait("waiting_customer", roomActions(sim));
  }
  if (/(cheap|discount|deal|price match|lower)/.test(t)) {
    sim.emit("check_facts", "passed", "Rates are fixed — no discount offered", "The concierge cannot change rates.");
    sim.say("assistant", "The rates shown are our current published rates for those dates, and I’m not able to change them.");
    return sim.wait("waiting_customer", roomActions(sim));
  }
  s.unclear += 1;
  if (s.unclear === 1) {
    sim.emit("explain", "info", "Question not understood — asking to clarify");
    sim.say("assistant", "Sorry, I didn’t quite follow. Would you like to book one of the rooms above, or ask about breakfast, parking, check-in, cots or cancellation?");
    return sim.wait("waiting_customer", roomActions(sim));
  }
  unsupported(sim, `Guest question: “${text.slice(0, 50)}”`);
  return sim.wait("waiting_customer", roomActions(sim));
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Uses a sample room inventory, rates and property facts. The checkout is simulated: no card details are collected, no payment is taken and no real booking is made.",
  assistantName: "Saltbush concierge",
  channelLabel: "Website chat",
  fields: [
    { kind: "select", name: "date", label: "Arrival date", options: DATES, helper: "Fri 21 Nov is sold out for families." },
    { kind: "number", name: "nights", label: "Nights", min: 1, max: 14 },
    { kind: "number", name: "adults", label: "Adults", min: 1, max: 6 },
    { kind: "number", name: "children", label: "Children", min: 0, max: 4 },
    { kind: "toggle", name: "parking", label: "Needs parking" },
    { kind: "select", name: "requirement", label: "Other requirement", options: ["None", "Cot or child bed", "Step-free access with roll-in shower"] },
  ],
  scenarios: [
    { id: "family_stay", label: "Family, two nights", kind: "success", description: "Two adults and a young child, two nights with parking. Choose a room and complete the sample checkout.", inputs: { date: "Fri 14 Nov", nights: 2, adults: 2, children: 1, parking: true, requirement: "Cot or child bed" } },
    { id: "sold_out", label: "Sold-out dates", kind: "exception", description: "The family’s first choice of dates is full. The concierge suggests dates that fit.", inputs: { date: "Fri 21 Nov", nights: 2, adults: 2, children: 1, parking: true, requirement: "Cot or child bed" } },
    { id: "accessibility", label: "Accessibility question", kind: "exception", description: "The guest needs step-free access. That is not in the approved facts, so staff must answer.", inputs: { date: "Fri 28 Nov", nights: 2, adults: 2, children: 0, parking: true, requirement: "Step-free access with roll-in shower" } },
    { id: "payment_failed", label: "Failed payment", kind: "exception", description: "A couple books one night. Trigger the failed payment event and see that no stay is confirmed.", inputs: { date: "Fri 28 Nov", nights: 1, adults: 2, children: 0, parking: false, requirement: "None" } },
    { id: "large_party", label: "Party too large", kind: "exception", description: "Five guests: no single room meets the occupancy rules.", inputs: { date: "Fri 14 Nov", nights: 2, adults: 2, children: 3, parking: true, requirement: "None" } },
  ],

  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("hotel-concierge", scenarioId, inputs, {
      step: "choosing_room",
      date: String(inputs.date ?? DATES[0]),
      roomId: null,
      checkoutRef: null,
      attempt: 0,
      failures: 0,
      takenElsewhere: [],
      unclear: 0,
      handoffs: 0,
    });
    if (!DATES.includes(sim.s.date)) sim.s.date = DATES[0];
    const p = party(sim);
    const extras = [p.parking ? "parking" : "", p.requirement !== "None" ? p.requirement.toLowerCase() : ""].filter(Boolean).join(" and ");
    sim.say("customer", `Hi, we’re ${p.adults} adult${p.adults === 1 ? "" : "s"}${p.children ? ` and ${p.children} child${p.children === 1 ? "" : "ren"}` : ""} looking for ${p.nights} night${p.nights === 1 ? "" : "s"} from ${sim.s.date}${extras ? `. We’ll need ${extras}` : ""}. What do you have?`);
    sim.emit("enquiry", "started", "Guest enquiry received", "Website chat");

    // Collect and validate
    sim.emit("collect", "started", "Reading dates and party needs");
    if (p.nights < 1 || p.nights > 14 || p.adults < 1) {
      sim.emit("collect", "failed", "Dates or party size not valid", "At least one adult and 1–14 nights are required.");
      sim.say("assistant", "Could you check the number of nights and adults? I need at least one adult and a stay of 1 to 14 nights.");
      sim.record({ id: "match", title: "Room match", status: "Not searched — invalid request", tone: "bad", fields: [{ label: "Reason", value: "Invalid nights or adults" }] });
      return sim.finish("failed", { kind: "failed", summary: "The request failed validation, so no inventory was searched. Fix the inputs and run again." }).done();
    }
    sim.emit("collect", "passed", `${sim.s.date}, ${p.nights} night${p.nights === 1 ? "" : "s"}, party of ${p.guests}`, [p.parking ? "Parking requested" : "", p.requirement !== "None" ? p.requirement : ""].filter(Boolean).join(" · ") || undefined);
    return findRooms(sim).done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;
    if (s.step === "done") return sim.done();

    if (actionId.startsWith("choose_") && s.step === "choosing_room") {
      const room = ROOMS.find((r) => `choose_${r.id}` === actionId);
      if (!room) return sim.done();
      sim.advance(3);
      sim.say("customer", `The ${room.name} sounds good, let’s book it.`);
      return openCheckout(sim, room).done();
    }

    if (actionId.startsWith("date_") && s.step === "choosing_date") {
      const d = DATES[Number(actionId.slice(5))];
      if (!d) return sim.done();
      sim.advance(2);
      sim.say("customer", `${d} works for us.`);
      s.date = d;
      sim.emit("collect", "passed", `Dates changed to ${d}`, "Alternative dates accepted.");
      return findRooms(sim).done();
    }

    switch (actionId) {
      case "no_thanks": {
        sim.say("customer", "No thanks, we’ll look elsewhere.");
        sim.emit("noroom", "stopped", "Guest declined alternatives");
        sim.patch("match", { status: "Closed — no suitable dates" });
        s.step = "done";
        return sim.finish("stopped", { kind: "exception", summary: "No eligible room was free on the requested dates and the guest declined the alternatives. Nothing was reserved." }).done();
      }
      case "ask_breakfast":
        return handleQuestion(sim, "Is breakfast included?").done();
      case "ask_access":
        return handleQuestion(sim, "Is the room step-free, with a roll-in shower? My dad uses a wheelchair.").done();
      case "free": {
        const text = (payload ?? "").trim();
        if (!text) return sim.done();
        return handleQuestion(sim, text).done();
      }

      case "taken": {
        if (s.step !== "at_checkout" || !s.roomId) return sim.done();
        sim.advance(5);
        const room = ROOMS.find((r) => r.id === s.roomId)!;
        s.takenElsewhere.push(`${s.date}:${room.id}`);
        sim.emit("checkout", "info", `Another channel booked the last ${room.name}`, "Sample inventory updated. The next step must recheck it.");
        return sim.wait("waiting_customer", checkoutActions()).done();
      }

      case "pay_ok":
      case "pay_fail": {
        if (!["at_checkout", "payment_failed"].includes(s.step) || !s.roomId) return sim.done();
        const room = ROOMS.find((r) => r.id === s.roomId)!;
        sim.advance(2);
        // Live recheck before any payment is submitted
        if (soldOut(sim, s.date, room.id)) return roomGone(sim, room).done();
        sim.emit("check_inventory", "passed", `Live recheck before payment: ${room.name} still free`);
        s.attempt += 1;
        const q = quote(sim, room);
        const payKey = `${s.checkoutRef}:payment:${s.attempt}`;
        sim.claim(payKey, "checkout", "payment attempt");
        const payRef = sim.ref("PAY");
        sim.emit("checkout", "passed", `Payment attempt ${s.attempt} submitted (simulated)`, `${aud(q.total)} · no card details collected`, { opKey: payKey });

        if (actionId === "pay_fail") {
          s.failures += 1;
          sim.send({ channel: "payment", to: "Payment provider (sample)", summary: `${payRef} failed — ${aud(q.total)}`, status: "failed", opKey: payKey });
          sim.emit("check_payment", "failed", `Payment event ${payRef}: failed`, "No booking is written without a success event.", { ref: payRef });
          sim.emit("failed", "info", "Checkout failed — no stay confirmed", `Attempt ${s.failures} of ${MAX_PAY_ATTEMPTS}.`);
          sim.record({
            id: "booking",
            title: "Booking",
            status: "Not confirmed — payment failed",
            tone: "bad",
            fields: [
              { label: "Room", value: room.name },
              { label: "Payment", value: `${payRef} failed`, tone: "bad" },
              { label: "Attempts", value: `${s.failures} of ${MAX_PAY_ATTEMPTS}` },
            ],
          });
          sim.patch("checkout", { status: "Payment failed — no booking", tone: "bad" });
          if (s.failures >= MAX_PAY_ATTEMPTS) {
            sim.emit("failed", "stopped", "Retry limit reached — checkout closed", "Room hold released. Front desk notified.");
            sim.send({ channel: "task", to: "Front desk (Sam)", summary: `Checkout ${s.checkoutRef} failed twice — contact guest`, status: "simulated", opKey: `${s.checkoutRef}:failed-task` });
            sim.patch("booking", { status: "Not confirmed — checkout closed after 2 failed payments" });
            sim.say("assistant", "The payment didn’t go through again, so your stay is not booked. Our front desk will get in touch to help.");
            s.step = "done";
            return sim.finish("failed", { kind: "failed", summary: `Both payment events failed, so no stay was confirmed. The room hold was released and staff were asked to follow up.` }).done();
          }
          sim.say("assistant", "The payment didn’t go through, so your stay is not booked yet. Your room is held for 15 minutes — you can try again safely without being charged twice.");
          s.step = "payment_failed";
          return sim
            .wait("waiting_customer", [
              { id: "pay_ok", label: "Retry: payment success event", actor: "customer", tone: "primary" },
              { id: "pay_fail", label: "Retry: payment fails again", actor: "customer", tone: "danger" },
              { id: "abandon", label: "Give up", actor: "customer" },
            ])
            .done();
        }

        // Success event
        sim.send({ channel: "payment", to: "Payment provider (sample)", summary: `${payRef} succeeded — ${aud(q.total)}`, status: "simulated", opKey: payKey });
        sim.emit("check_payment", "passed", `Payment event ${payRef}: succeeded`, `References checkout ${s.checkoutRef}.`, { ref: payRef });
        const bookKey = `${s.checkoutRef}:booking`;
        if (!sim.claim(bookKey, "verify", "booking")) return sim.done();
        const bk = sim.ref("BK");
        sim.send({ channel: "calendar", to: "Property management system (sample)", summary: `Booking ${bk}: ${room.name}, ${s.date}`, status: "simulated", opKey: bookKey });
        sim.emit("verify", "confirmed", `Booking ${bk} confirmed`, "Written only after the payment success event.", { opKey: bookKey, ref: bk });
        // Provider re-delivers the same success event: deduplicated.
        sim.emit("check_payment", "info", "Payment success event delivered twice by provider");
        sim.claim(bookKey, "verify", "booking");
        const p = party(sim);
        sim.record({
          id: "booking",
          title: "Booking",
          ref: bk,
          status: "Confirmed — paid",
          tone: "ok",
          fields: [
            { label: "Room", value: room.name },
            { label: "Arrival", value: `${s.date}, ${p.nights} night${p.nights === 1 ? "" : "s"}` },
            { label: "Guests", value: `${p.adults} adult${p.adults === 1 ? "" : "s"}, ${p.children} child${p.children === 1 ? "" : "ren"}` },
            { label: "Parking", value: p.parking ? (q.parkingOk ? "On-site space reserved" : "Street parking (on-site full)") : "Not requested" },
            { label: "Paid", value: `${aud(q.total)} (${payRef}, simulated)`, tone: "ok" },
            { label: "Policy", value: "Free cancellation until 7 days before arrival" },
          ],
        });
        sim.patch("checkout", { status: "Completed", tone: "ok" });
        sim.send({ channel: "email", to: "guest@family.example", summary: `Booking confirmation ${bk}`, status: "held", opKey: `${bk}:confirmation` });
        sim.say("assistant", `You’re booked! ${room.name}, ${s.date} for ${p.nights} night${p.nights === 1 ? "" : "s"}. Confirmation ${bk} is on its way by email.`);
        s.step = "done";
        return sim.finish("completed", { kind: "success", summary: `Booking ${bk} was confirmed after payment event ${payRef} succeeded. A duplicate delivery of the same event did not create a second booking.` }).done();
      }

      case "abandon": {
        sim.say("customer", "I’ll leave it for now, thanks.");
        sim.emit("failed", "stopped", "Guest abandoned after failed payment", "Room hold released.");
        sim.patch("booking", { status: "Not confirmed — abandoned after failed payment" });
        s.step = "done";
        return sim.finish("stopped", { kind: "exception", summary: "The payment failed and the guest stopped. No stay was confirmed and the room hold was released." }).done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const hotelConcierge: Product = {
  id: "hotel-concierge",
  no: 13,
  slug: "hotel-concierge",
  name: "Hotel Concierge",
  outcome: "Help guests find and book the right stay.",
  sectorLabel: "B and Bs, guesthouses and small hotels",
  sectors: ["Accommodation"],
  outcomes: ["Capture enquiries", "Convert sales"],
  definition:
    "Answers guest questions using only approved property information and matches their dates, party and requirements to rooms that are actually free at current rates. It then hands the guest to a verified checkout, and a booking is confirmed only when the payment system reports success.",
  situation:
    "A family asks the guesthouse’s website chat for two nights with parking and space for a young child. The owner is busy with arrivals and wants them offered only rooms that fit three people, with correct prices and policies, rather than an answer hours later.",
  endState:
    "Guests see which rooms suit them, get policy answers they can rely on and book directly. Questions the property has not documented go to staff, and the owner never sees a booking that was not paid.",
  handles: [
    "Matches party size and child needs to rooms using occupancy rules",
    "Shows current rates and totals, including parking, from live inventory",
    "Suggests alternative dates when the requested dates are sold out",
    "Answers policy questions from approved property facts only",
    "Rechecks inventory at checkout and confirms only after a payment success event",
  ],
  boundaries: [
    "Never invents accessibility or facility promises — unknown details go to staff",
    "Never changes or discounts rates",
    "The demo checkout collects no card details and takes no payment",
  ],
  delivered: [
    { title: "Booking confirmation", body: "Room, dates, guests, parking, amount paid, payment reference and cancellation policy — sent only after the success event." },
    { title: "Staff question handoff", body: "Guest question the approved facts cannot answer, such as step-free access, with a note that no promise was made." },
    { title: "Checkout and booking record", body: "Checkout session with its inventory recheck, each payment attempt and the verified booking written to the property system." },
  ],
  deployment: {
    rules: [
      "Room types, occupancy limits and child policies",
      "Rate plans, parking allocation and minimum stays",
      "Approved property facts, including verified accessibility details",
      "Payment provider events and hold times",
    ],
    systems: ["Property management system", "Booking engine", "Approved property information", "Payment status events"],
  },
  measures: ["Completed direct bookings", "Net booking contribution after payment and channel costs", "Enquiries handed to staff and answered"],
  reliability: [
    "Bookings confirmed without a payment success event (target: zero)",
    "Duplicate bookings from repeated payment events (target: zero)",
    "Rooms offered that failed the checkout recheck",
  ],
  harness: {
    systems:
      "Production uses the property management system, booking engine, approved property information and payment status events. The demo uses four sample rooms, a fixed sold-out calendar, a list of approved facts and simulated payment events.",
    controls: [
      "Live inventory recheck at checkout and before payment",
      "Deterministic occupancy rules for adults, children and room type",
      "Current rates only; no discounts from the assistant",
      "No invented accessibility promises — unknown details handed to staff",
      "Booking confirmed only from a verified, deduplicated payment event",
    ],
  },
  ctaLine: "Want this connected to your own booking engine?",
  graph: {
    nodes: [
      { id: "enquiry", kind: "action", row: 0, title: "Guest enquiry", input: "Website chat message", rule: "Start a session per guest", output: "Enquiry", failure: "—", system: "Website chat (demo: in-page)" },
      { id: "collect", kind: "action", row: 1, title: "Collect dates and party needs", input: "Dates, nights, adults, children, requirements", rule: "At least one adult; 1–14 nights", output: "Structured stay request", failure: "Invalid → ask again", system: "Session state" },
      { id: "find", kind: "action", row: 2, title: "Find eligible rooms and rates", input: "Stay request", rule: "Occupancy rules, sold-out dates, current rates", output: "Eligible rooms with totals", failure: "None free → alternatives; none fit → staff", system: "PMS inventory (demo: fixture)" },
      { id: "explain", kind: "action", row: 3, title: "Explain policies and options", input: "Eligible rooms + guest questions", rule: "State only approved property facts", output: "Options and answers", failure: "Unknown detail → staff", system: "Approved property facts (demo: fixture)" },
      { id: "checkout", kind: "action", row: 4, title: "Guest completes checkout", input: "Chosen room", rule: "Recheck inventory; no card details in demo", output: "Checkout session + payment attempt", failure: "Room gone → alternatives", system: "Booking engine (demo: simulated)" },
      { id: "verify", kind: "action", row: 5, title: "Verify booking and confirm", input: "Payment success event", rule: "Write booking once per checkout", output: "Confirmed booking reference", failure: "No success event → not confirmed", system: "PMS write (demo: simulated)" },
      { id: "noroom", kind: "branch", row: 1.5, title: "No available room", input: "No room fits or all sold", rule: "Suggest other dates; oversized party → staff", output: "Alternative dates", failure: "—" },
      { id: "unknown", kind: "branch", row: 3, title: "Unknown property detail", input: "Question outside approved facts", rule: "No guess, no promise; hand to staff", output: "Staff task", failure: "—" },
      { id: "failed", kind: "branch", row: 4.6, title: "Checkout failed", input: "Payment failure event", rule: `Hold room 15 min; max ${MAX_PAY_ATTEMPTS} attempts`, output: "Unconfirmed booking; retry or close", failure: "—" },
      { id: "check_inventory", kind: "check", row: 2, title: "Inventory and occupancy", input: "Party, dates, room", rule: "Party within room limits; room free now", output: "Eligible / excluded with reason", failure: "Fails → exclude or alternatives" },
      { id: "check_facts", kind: "check", row: 3.2, title: "Approved property facts", input: "Answer to be given", rule: "Must match an approved fact", output: "Answer allowed", failure: "Blocked → staff" },
      { id: "check_payment", kind: "check", row: 5, title: "Payment and booking event", input: "Payment provider event", rule: "Success event for this checkout; duplicates ignored", output: "Verified payment", failure: "Failed → no booking" },
    ],
    edges: [
      { from: "enquiry", to: "collect", kind: "flow" },
      { from: "collect", to: "find", kind: "flow" },
      { from: "find", to: "explain", kind: "flow" },
      { from: "explain", to: "checkout", kind: "flow" },
      { from: "checkout", to: "verify", kind: "flow" },
      { from: "find", to: "noroom", kind: "return" },
      { from: "noroom", to: "collect", kind: "return", label: "alternative dates" },
      { from: "explain", to: "unknown", kind: "return" },
      { from: "verify", to: "failed", kind: "return" },
      { from: "failed", to: "checkout", kind: "return", label: "retry safely" },
      { from: "check_inventory", to: "find", kind: "check" },
      { from: "check_facts", to: "explain", kind: "check" },
      { from: "check_payment", to: "verify", kind: "check" },
    ],
  },
  demo,
};
