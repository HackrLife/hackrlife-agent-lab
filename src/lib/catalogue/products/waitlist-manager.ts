import type { DemoAction, DemoDefinition, Product, RecordField } from "../types";
import { Sim, aud } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

interface Slot {
  id: string;
  label: string;
  hour: number;
  duration: number;
  service: string;
  price: number;
}

const SLOTS: Record<string, Slot> = {
  "Tue 10:00 · 60-min full groom": { id: "tue-1000-60", label: "Tue 10:00", hour: 10, duration: 60, service: "Full groom", price: 85 },
  "Tue 14:00 · 60-min full groom": { id: "tue-1400-60", label: "Tue 14:00", hour: 14, duration: 60, service: "Full groom", price: 85 },
  "Tue 10:00 · 90-min large-dog groom": { id: "tue-1000-90", label: "Tue 10:00", hour: 10, duration: 90, service: "Large-dog groom", price: 120 },
};

const AVAILABILITY = ["Mornings", "Afternoons", "Any time"];

interface Cust {
  id: string;
  name: string;
  first: string;
  pet: string;
  duration: number;
  service: string;
  since: string;
  sinceOrder: number;
  /** Input field holding this customer's availability, or a fixed value. */
  availabilityField?: string;
  availability?: string;
}

const WAITLIST: Cust[] = [
  { id: "W-118", name: "Jack Nguyen", first: "Jack", pet: "Bruno (labrador)", duration: 90, service: "Large-dog groom", since: "20 Aug", sinceOrder: 1, availability: "Any time" },
  { id: "W-124", name: "Priya Shah", first: "Priya", pet: "Luna (toy poodle)", duration: 60, service: "Full groom", since: "2 Sep", sinceOrder: 2, availabilityField: "priya_availability" },
  { id: "W-131", name: "Ellie Brooks", first: "Ellie", pet: "Pepper (schnauzer)", duration: 60, service: "Full groom", since: "14 Sep", sinceOrder: 3, availabilityField: "ellie_availability" },
];

const RACE_ORDERS = ["Earlier offer’s reply arrives first", "New offer’s reply arrives first"];

type OfferStatus = "Offered — hold live" | "Accepted — booked" | "Declined — hold released" | "Expired — hold released" | "Accepted late — slot already taken" | "Lost the claim — slot already taken" | "Withdrawn — slot filled";

interface Offer {
  cid: string;
  token: string;
  status: OfferStatus;
  sentAt: number;
  holdUntil: number;
}

interface State {
  step: "offering" | "done";
  ranked: string[];
  cur: number;
  justExpired: number | null;
  offers: Offer[];
  bookingRef: string;
  winner: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function hhmm(minutes: number): string {
  const total = 9 * 60 + minutes;
  const m = total % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function slotOf(sim: Sim<State>): Slot {
  return SLOTS[sim.str("slot")] ?? SLOTS["Tue 10:00 · 60-min full groom"];
}

function holdMinutes(sim: Sim<State>): number {
  return Math.min(120, Math.max(5, Math.round(sim.num("hold_minutes", 30))));
}

function cust(id: string): Cust {
  return WAITLIST.find((c) => c.id === id) as Cust;
}

function availabilityOf(sim: Sim<State>, c: Cust): string {
  if (c.availabilityField) {
    const v = sim.str(c.availabilityField);
    return AVAILABILITY.includes(v) ? v : "Any time";
  }
  return c.availability ?? "Any time";
}

function fit(sim: Sim<State>, c: Cust, slot: Slot): { ok: boolean; reason: string } {
  if (c.duration !== slot.duration) return { ok: false, reason: `Needs ${c.duration} min ${c.service.toLowerCase()}; slot is ${slot.duration} min` };
  const av = availabilityOf(sim, c);
  const period = slot.hour < 12 ? "Mornings" : "Afternoons";
  if (av !== "Any time" && av !== period) return { ok: false, reason: `Available ${av.toLowerCase()} only; slot is ${slot.label}` };
  return { ok: true, reason: `${slot.duration}-min ${slot.service.toLowerCase()} matches; available ${av.toLowerCase()}; waiting since ${c.since}` };
}

function currentOffer(s: State): Offer | undefined {
  return s.offers.find((o) => o.cid === s.ranked[s.cur] && o.status === "Offered — hold live");
}

function setOffer(s: State, cid: string, status: OfferStatus) {
  const o = [...s.offers].reverse().find((x) => x.cid === cid);
  if (o) o.status = status;
}

function offerHistory(sim: Sim<State>): RecordField[] {
  return sim.s.offers.map((o) => {
    const c = cust(o.cid);
    const tone = o.status.startsWith("Accepted — booked") ? "ok" : o.status.startsWith("Offered") ? "warn" : o.status.startsWith("Expired") || o.status.startsWith("Declined") ? "muted" : "bad";
    return { label: `${o.token} · ${c.name}`, value: `${o.status} (sent ${hhmm(o.sentAt)}, hold to ${hhmm(o.holdUntil)})`, tone };
  });
}

function refreshOffers(sim: Sim<State>, status: string, tone: "ok" | "warn" | "bad" | "muted" | "default" = "default") {
  sim.record({ id: "offers", title: "Offer history", status, tone, fields: offerHistory(sim) });
}

function offerActions(sim: Sim<State>): DemoAction[] {
  const s = sim.s;
  const c = cust(s.ranked[s.cur]);
  const acts: DemoAction[] = [
    { id: "accept", label: `${c.first} accepts`, actor: "customer", tone: "primary", hint: "“Yes please, we’ll take it!”" },
  ];
  if (s.justExpired !== null) {
    const late = cust(s.ranked[s.justExpired]);
    acts.push({ id: "race", label: `${c.first} and ${late.first} accept within seconds`, actor: "customer", hint: `${late.first}’s reply was sent just before her hold expired and arrives at the same moment. Arrival order comes from the input.` });
  }
  acts.push({ id: "decline", label: `${c.first} declines`, actor: "customer", tone: "danger" });
  acts.push({ id: "expire", label: `Advance clock ${holdMinutes(sim)} min (no reply — offer expires)`, actor: "clock" });
  acts.push({ id: "dup_cancel", label: "Cancellation event delivered again", actor: "staff", hint: "Webhook retry from the booking system." });
  return acts;
}

/* ------------------------------------------------------------------ */
/* Workflow steps                                                      */
/* ------------------------------------------------------------------ */

function makeOffer(sim: Sim<State>) {
  const s = sim.s;
  const slot = slotOf(sim);
  const c = cust(s.ranked[s.cur]);
  const token = sim.ref("OFR");
  const mins = holdMinutes(sim);
  const holdUntil = sim.run.clock + mins;
  const holdKey = `hold:${slot.id}:${token}`;
  sim.claim(holdKey, "hold", "hold");
  sim.emit("hold", "confirmed", `Temporary hold for ${c.first} until ${hhmm(holdUntil)}`, `Token ${token}. Nobody else can take the slot while the hold is live.`, { opKey: holdKey, ref: token });
  sim.emit("check_hold", "passed", `Hold limited to ${mins} min`, `Expires ${hhmm(holdUntil)}; expiry releases it automatically.`);
  s.offers.push({ cid: c.id, token, status: "Offered — hold live", sentAt: sim.run.clock, holdUntil });
  const offerKey = `offer:${token}`;
  sim.claim(offerKey, "offer", "offer");
  sim.say("assistant", `Hi ${c.first}, a ${slot.duration}-minute ${slot.service.toLowerCase()} has opened tomorrow (${slot.label}) for ${c.pet.split(" ")[0]}. It’s held for you until ${hhmm(holdUntil)} — reply YES to book it.`);
  sim.send({ channel: "sms", to: c.name, summary: `Offer ${token}: ${slot.label} (${slot.duration} min), hold to ${hhmm(holdUntil)}`, status: "held", opKey: offerKey });
  sim.emit("offer", "waiting", `Offer ${token} sent to ${c.name}`, "Held in the demo outbox. One offer at a time.", { opKey: offerKey, ref: token });
  sim.patch("slot", { status: `Held for ${c.name} until ${hhmm(holdUntil)}`, tone: "warn" });
  refreshOffers(sim, `Offer ${s.offers.length} live`, "warn");
  sim.wait("waiting_customer", offerActions(sim));
}

function nextOrStop(sim: Sim<State>) {
  const s = sim.s;
  const slot = slotOf(sim);
  s.cur += 1;
  if (s.cur < s.ranked.length) {
    sim.emit("match", "info", `Next eligible customer: ${cust(s.ranked[s.cur]).name}`);
    makeOffer(sim);
    return;
  }
  s.step = "done";
  sim.emit("no_match", "stopped", "Waitlist exhausted — slot handed to staff", "No eligible customer accepted. The slot is released for staff or online booking.");
  sim.send({ channel: "task", to: "Front desk", summary: `Unfilled ${slot.label} slot — offer manually or open online`, status: "simulated" });
  sim.patch("slot", { status: "Open — handed to staff", tone: "bad" });
  refreshOffers(sim, "No acceptance", "muted");
  sim.finish("stopped", { kind: "exception", summary: `All ${s.ranked.length} eligible offer${s.ranked.length === 1 ? "" : "s"} ended without a booking, so the ${slot.label} slot was handed to the front desk. No slot is left on hold.` });
}

/** Validate then attempt the atomic claim. Returns true if this acceptance won the slot. */
function tryBook(sim: Sim<State>, cid: string, late: boolean): boolean {
  const s = sim.s;
  const slot = slotOf(sim);
  const c = cust(cid);
  const offer = [...s.offers].reverse().find((o) => o.cid === cid)!;
  sim.emit("validate", "started", `Acceptance from ${c.name}`, `Token ${offer.token}`);
  if (late) {
    sim.emit("validate", "passed", `${c.first}’s reply was sent inside her hold window`, `Sent ${hhmm(offer.holdUntil - 1)}, hold ended ${hhmm(offer.holdUntil)}. Valid, but the slot must still be claimable.`);
  } else {
    sim.emit("validate", "passed", `Token ${offer.token} valid; hold live until ${hhmm(offer.holdUntil)}`);
  }
  const slotKey = `slot:${slot.id}`;
  if (!sim.claim(slotKey, "check_atomic", "slot claim")) {
    sim.emit("hold_claimed", "stopped", `Slot already claimed — ${c.first} told it is unavailable`, "A courteous message is queued; the customer stays on the waitlist.");
    sim.say("assistant", `Sorry ${c.first} — the ${slot.label} slot was taken moments before your reply arrived. You’re still at the top of our waitlist and we’ll offer you the next suitable opening.`);
    sim.send({ channel: "sms", to: c.name, summary: `Courteous unavailable message (${offer.token})`, status: "held", opKey: `unavailable:${offer.token}` });
    setOffer(s, cid, late ? "Accepted late — slot already taken" : "Lost the claim — slot already taken");
    return false;
  }
  sim.emit("check_atomic", "passed", `Atomic slot claim won by ${c.first}`, `Key ${slotKey}. Any later claim on this key is rejected.`, { opKey: slotKey });
  s.bookingRef = sim.ref("BK");
  s.winner = cid;
  sim.send({ channel: "calendar", to: "Wagtail Grooming calendar", summary: `Book ${c.name} — ${slot.label}, ${slot.duration} min (${s.bookingRef})`, status: "simulated", opKey: slotKey });
  sim.emit("commit", "confirmed", `Booked ${c.name} into ${slot.label} as ${s.bookingRef}`, "Calendar write acknowledged (simulated adapter).", { opKey: slotKey, ref: s.bookingRef });
  setOffer(s, cid, "Accepted — booked");
  sim.say("assistant", `You’re booked, ${c.first}: ${slot.label} tomorrow for ${c.pet.split(" ")[0]} (${s.bookingRef}). See you then!`);
  sim.send({ channel: "sms", to: c.name, summary: `Booking confirmation ${s.bookingRef}`, status: "held", opKey: `confirm:${s.bookingRef}` });
  return true;
}

function closeRemaining(sim: Sim<State>) {
  const s = sim.s;
  const slot = slotOf(sim);
  let withdrawn = 0;
  for (const o of s.offers) {
    if (o.status === "Offered — hold live") {
      o.status = "Withdrawn — slot filled";
      withdrawn += 1;
    }
  }
  const notContacted = s.ranked.slice(s.cur + 1).map((id) => cust(id).name);
  sim.emit("commit", "passed", "Remaining offers stopped", `${withdrawn} live offer${withdrawn === 1 ? "" : "s"} withdrawn; ${notContacted.length ? `${notContacted.join(", ")} not contacted` : "no one else queued"}.`);
  const winner = cust(s.winner);
  sim.record({
    id: "booking",
    title: "Refilled appointment",
    ref: s.bookingRef,
    status: "Booked — calendar confirmed",
    tone: "ok",
    fields: [
      { label: "Customer", value: `${winner.name} · ${winner.pet}` },
      { label: "Slot", value: `${slot.label}, ${slot.duration}-min ${slot.service.toLowerCase()}` },
      { label: "Hours refilled", value: `${slot.duration / 60} h` },
      { label: "Revenue", value: `${aud(slot.price)} expected — counted as recovered only once the appointment is completed`, tone: "muted" },
    ],
  });
  sim.patch("slot", { status: `Refilled — ${s.bookingRef}`, tone: "ok" });
  s.step = "done";
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary:
    "Interactive simulation using a sample calendar and waitlist. No messages are sent and no real appointment is booked. The two-acceptance race is illustrated in a browser simulation and does not prove production concurrency.",
  assistantName: "Waitlist assistant",
  channelLabel: "SMS offers to waiting customers",
  fields: [
    { kind: "select", name: "slot", label: "Cancelled slot (tomorrow)", options: Object.keys(SLOTS) },
    { kind: "select", name: "priya_availability", label: "Priya Shah’s availability", options: AVAILABILITY, helper: "Priya wants a 60-min full groom, waiting since 2 Sep." },
    { kind: "select", name: "ellie_availability", label: "Ellie Brooks’s availability", options: AVAILABILITY, helper: "Ellie wants a 60-min full groom, waiting since 14 Sep. Jack Nguyen needs 90 min." },
    { kind: "number", name: "hold_minutes", label: "Offer hold", min: 5, max: 120, step: 5, suffix: "min" },
    { kind: "select", name: "race_order", label: "Response order when two accept together", options: RACE_ORDERS },
  ],
  scenarios: [
    { id: "first_accepts", label: "First match accepts", kind: "success", description: "A 60-minute slot opens tomorrow morning; two of three waiting customers fit and the first accepts.", inputs: { slot: "Tue 10:00 · 60-min full groom", priya_availability: "Mornings", ellie_availability: "Any time", hold_minutes: 30, race_order: RACE_ORDERS[1] } },
    { id: "expiry_next", label: "Offer expires", kind: "exception", description: "The first customer does not reply. The hold is released and the next match is offered.", inputs: { slot: "Tue 10:00 · 60-min full groom", priya_availability: "Mornings", ellie_availability: "Any time", hold_minutes: 30, race_order: RACE_ORDERS[1] } },
    { id: "two_accept", label: "Two accept together", kind: "exception", description: "The first customer’s late reply and the second customer’s acceptance arrive within seconds. Exactly one is booked.", inputs: { slot: "Tue 10:00 · 60-min full groom", priya_availability: "Any time", ellie_availability: "Mornings", hold_minutes: 20, race_order: RACE_ORDERS[0] } },
    { id: "large_dog", label: "90-minute slot", kind: "success", description: "The cancelled slot is a 90-minute large-dog groom, so only one waiting customer fits.", inputs: { slot: "Tue 10:00 · 90-min large-dog groom", priya_availability: "Any time", ellie_availability: "Any time", hold_minutes: 30, race_order: RACE_ORDERS[1] } },
    { id: "no_match", label: "No eligible match", kind: "exception", description: "An afternoon slot opens but both 60-minute customers are only free in the morning.", inputs: { slot: "Tue 14:00 · 60-min full groom", priya_availability: "Mornings", ellie_availability: "Mornings", hold_minutes: 30, race_order: RACE_ORDERS[1] } },
  ],

  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("waitlist-manager", scenarioId, inputs, { step: "offering", ranked: [], cur: 0, justExpired: null, offers: [], bookingRef: "", winner: "" });
    const s = sim.s;
    const slot = slotOf(sim);

    // 1. Cancellation event
    sim.say("system", `Wagtail Grooming: Oscar Reid cancelled tomorrow’s ${slot.label} ${slot.service.toLowerCase()} (${slot.duration} min).`);
    sim.emit("cancel", "started", `Cancellation received: ${slot.label}, ${slot.duration} min`, "Source: booking system event (fixture).");
    const cancelKey = `cancel:${slot.id}`;
    sim.claim(cancelKey, "cancel", "cancellation event");
    sim.record({
      id: "slot",
      title: "Cancelled slot",
      status: "Open — matching waitlist",
      tone: "warn",
      fields: [
        { label: "When", value: `Tomorrow ${slot.label}` },
        { label: "Service", value: `${slot.service}, ${slot.duration} min` },
        { label: "Cancelled by", value: "Oscar Reid (fictional)" },
      ],
    });
    sim.emit("cancel", "passed", "Slot released for refilling", undefined, { opKey: cancelKey });

    // 2. Match eligible waitlist
    sim.emit("match", "started", `Checking ${WAITLIST.length} waiting customers`);
    const fields: RecordField[] = [];
    const eligible: Cust[] = [];
    for (const c of WAITLIST) {
      const f = fit(sim, c, slot);
      sim.emit("check_fit", f.ok ? "passed" : "failed", `${c.name}: ${f.ok ? "eligible" : "excluded"}`, f.reason);
      if (f.ok) eligible.push(c);
      else fields.push({ label: `Excluded · ${c.name}`, value: f.reason, tone: "bad" });
    }
    eligible.sort((a, b) => a.sinceOrder - b.sinceOrder);
    s.ranked = eligible.map((c) => c.id);
    const rankedFields: RecordField[] = eligible.map((c, i) => ({ label: `#${i + 1} · ${c.name}`, value: fit(sim, c, slot).reason, tone: "ok" }));
    sim.record({ id: "matches", title: "Ranked eligible matches", status: `${eligible.length} of ${WAITLIST.length} eligible`, tone: eligible.length ? "ok" : "bad", fields: [...rankedFields, ...fields] });

    if (!eligible.length) {
      s.step = "done";
      sim.emit("match", "failed", "No waiting customer fits this slot");
      sim.emit("no_match", "stopped", "No eligible match — slot handed to staff", "Nobody is offered a slot they cannot use.");
      sim.send({ channel: "task", to: "Front desk", summary: `Unfilled ${slot.label} slot — no eligible waitlist match`, status: "simulated" });
      sim.patch("slot", { status: "Open — handed to staff", tone: "bad" });
      return sim.finish("stopped", { kind: "exception", summary: `No waiting customer fits the ${slot.label} ${slot.duration}-minute slot, so no offers were sent and the front desk was given a task instead.` }).done();
    }
    sim.emit("match", "passed", `${eligible.length} eligible, ranked by time on the waitlist`, eligible.map((c) => c.name).join(" → "));

    // 3–4. Hold and offer to the first match
    makeOffer(sim);
    return sim.done();
  },

  act(run, actionId) {
    const sim = Sim.from(run);
    const s = sim.s;
    if (s.step !== "offering") return sim.done();
    const slot = slotOf(sim);
    const c = cust(s.ranked[s.cur]);
    const live = currentOffer(s);
    if (!live) return sim.done();

    switch (actionId) {
      case "accept": {
        sim.advance(4);
        sim.say("customer", `${c.first}: Yes please, we’ll take it!`);
        s.justExpired = null;
        if (sim.run.clock > live.holdUntil) {
          // Not reachable through the UI (expiry is an explicit clock action) — defensive.
          sim.emit("validate", "failed", "Hold already expired");
          return sim.done();
        }
        tryBook(sim, c.id, false);
        closeRemaining(sim);
        refreshOffers(sim, "Filled", "ok");
        return sim.finish("completed", { kind: "success", summary: `${c.name} accepted within the hold and was booked as ${s.bookingRef} after the atomic slot claim. Remaining offers were stopped.` }).done();
      }

      case "race": {
        if (s.justExpired === null) return sim.done();
        const late = cust(s.ranked[s.justExpired]);
        sim.advance(1);
        sim.say("customer", `${late.first}: Yes! Sorry, only just saw this — we’ll take it. (sent ${hhmm(s.offers.find((o) => o.cid === late.id)!.holdUntil - 1)})`);
        sim.say("customer", `${c.first}: Yes please, we’ll take it!`);
        sim.emit("validate", "info", "Two acceptances arrived within seconds", `Processing order: ${sim.str("race_order")}. Both go through the same atomic claim.`);
        const order = sim.str("race_order") === RACE_ORDERS[0] ? [{ id: late.id, late: true }, { id: c.id, late: false }] : [{ id: c.id, late: false }, { id: late.id, late: true }];
        for (const r of order) tryBook(sim, r.id, r.late);
        if (s.winner === late.id) {
          sim.emit("check_hold", "info", `Hold for ${c.first} released — slot claimed first by ${late.first}`);
        }
        s.justExpired = null;
        closeRemaining(sim);
        const loser = order.map((o) => cust(o.id)).find((x) => x.id !== s.winner)!;
        refreshOffers(sim, "Filled — one booking", "ok");
        return sim
          .finish("completed", {
            kind: "success",
            summary: `Two acceptances arrived together; the atomic claim booked only ${cust(s.winner).name} (${s.bookingRef}) and ${loser.name} received a courteous unavailable message. The calendar shows one booking.`,
          })
          .done();
      }

      case "decline": {
        sim.advance(6);
        sim.say("customer", `${c.first}: Thanks, but we can’t make that one.`);
        setOffer(s, c.id, "Declined — hold released");
        sim.emit("offer", "info", `${c.name} declined`);
        sim.emit("check_hold", "info", `Hold ${live.token} released on decline`);
        s.justExpired = null;
        refreshOffers(sim, "Moving to next match", "warn");
        nextOrStop(sim);
        return sim.done();
      }

      case "expire": {
        const mins = live.holdUntil - sim.run.clock;
        sim.advance(Math.max(0, mins));
        setOffer(s, c.id, "Expired — hold released");
        sim.emit("check_hold", "info", `Hold expired at ${hhmm(live.holdUntil)} — released`, `Token ${live.token} can no longer be used to start a new claim.`);
        sim.emit("offer_expires", "info", `Offer to ${c.name} expired — next customer`, "Expiry releases the hold before anyone else is offered the slot.");
        sim.send({ channel: "sms", to: c.name, summary: `Offer ${live.token} expired notice`, status: "held", opKey: `expired:${live.token}` });
        s.justExpired = s.cur;
        refreshOffers(sim, "Offer expired", "warn");
        nextOrStop(sim);
        return sim.done();
      }

      case "dup_cancel": {
        sim.say("system", "The booking system delivered the same cancellation event again.");
        sim.claim(`cancel:${slot.id}`, "cancel", "cancellation event");
        sim.wait("waiting_customer", offerActions(sim));
        return sim.done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const waitlistManager: Product = {
  id: "waitlist-manager",
  no: 10,
  slug: "waitlist-manager",
  name: "Waitlist Manager",
  outcome: "Fill a cancelled slot before it goes to waste.",
  sectorLabel: "Salons groomers and appointment businesses",
  sectors: ["Appointments"],
  outcomes: ["Fill capacity"],
  definition:
    "When an appointment is cancelled, it matches the opening against waiting customers on service, duration and availability, then offers it to the best match with a time-limited hold. Offers go out one at a time and the slot is claimed atomically, so two people can never be booked into the same opening.",
  situation:
    "A 60-minute grooming slot opens tomorrow morning after a late cancellation. Three customers are on the waitlist, but one needs a 90-minute large-dog groom and the others have different availability; the owner would otherwise ring round between appointments.",
  endState:
    "The slot is refilled by an eligible customer, the calendar shows exactly one booking, expired offers are recorded, and anyone who replied too late gets a polite note and keeps their place.",
  handles: [
    "Excludes customers whose service, duration or availability does not fit",
    "Ranks eligible matches with the reasons shown",
    "Offers one customer at a time with a hold that expires on the clock",
    "Books exactly one customer through an atomic slot claim, even when two accept together",
    "Stops remaining offers once the slot is filled and tells late acceptors courteously",
  ],
  boundaries: [
    "Never offers a slot to a customer who cannot use it",
    "Never holds a slot past the expiry time",
    "The browser demo illustrates the race; it does not prove production concurrency",
    "The public demo sends no messages and writes to no real calendar",
  ],
  delivered: [
    { title: "Customer confirmation", body: "Booking reference, date, time and service for the winner; a courteous unavailable message for anyone who replied too late." },
    { title: "Owner handoff", body: "Front-desk task when no eligible customer accepts, with the offer history so nobody is contacted twice." },
    { title: "Refill record", body: "Cancelled slot, ranked matches with exclusion reasons, every offer token with its outcome, hours refilled and revenue counted only after completion." },
  ],
  deployment: {
    rules: [
      "Which services and durations can fill which slots",
      "Ranking order (time waiting, loyalty, flexibility)",
      "Hold length and how many offers to try before handing to staff",
      "Messages for offers, expiries and late replies",
    ],
    systems: ["Your booking system", "Waitlist preferences", "SMS or email messaging", "A slot reservation adapter with atomic claims"],
  },
  measures: ["Cancelled appointment hours refilled", "Completed revenue recovered from refilled slots"],
  reliability: ["Double bookings of one slot (target: zero)", "Offers sent after the slot was filled (target: zero)", "Holds left open past expiry (target: zero)"],
  harness: {
    systems:
      "Production uses the booking system, waitlist preferences, messaging and a server-side slot reservation adapter. The demo uses a fixture calendar with three fictional waiting customers and a browser-only claim that illustrates, but does not prove, atomic booking.",
    controls: [
      "Eligibility: service, duration and availability must all fit",
      "Time-limited hold; expiry releases it before the next offer",
      "Unique offer token per offer",
      "Atomic single booking on the slot key",
      "Stop remaining offers as soon as the slot is filled",
    ],
  },
  ctaLine: "Want this refilling cancellations in your own booking system?",
  graph: {
    nodes: [
      { id: "cancel", kind: "action", row: 0, title: "Cancellation event", input: "Booking-system cancellation", rule: "Deduplicate by slot; confirm the slot is now free", output: "Open slot", failure: "Repeat event → ignored", system: "Booking system (demo: fixture event)" },
      { id: "match", kind: "action", row: 1, title: "Match eligible waitlist", input: "Open slot, waitlist", rule: "Service, duration and availability fit; rank by time waiting", output: "Ranked eligible matches with reasons", failure: "None fit → no eligible match", system: "Waitlist (demo: 3 fixture customers)" },
      { id: "hold", kind: "action", row: 2, title: "Place temporary slot hold", input: "Top remaining match", rule: "One hold at a time, time-limited", output: "Hold with offer token", failure: "—", system: "Reservation adapter (demo: browser state)" },
      { id: "offer", kind: "action", row: 3, title: "Offer slot to customer", input: "Hold and token", rule: "One offer at a time; hold end stated", output: "Offer message", failure: "No reply by hold end → offer expires", system: "SMS (demo: held outbox)" },
      { id: "validate", kind: "action", row: 4, title: "Validate acceptance and hold", input: "Customer reply", rule: "Token matches; reply sent inside the hold window", output: "Valid acceptance", failure: "Slot already claimed → unavailable", system: "Session state" },
      { id: "commit", kind: "action", row: 5, title: "Commit booking and close offers", input: "Winning acceptance", rule: "Book once; withdraw every other offer", output: "Booking reference, offer history", failure: "Calendar write fails → no confirmation", system: "Calendar (demo: simulated adapter)" },
      { id: "offer_expires", kind: "branch", row: 1, title: "Offer expires", input: "Hold end reached with no reply", rule: "Release hold, then offer the next match", output: "Expired offer recorded", failure: "—" },
      { id: "hold_claimed", kind: "branch", row: 3.3, title: "Hold already claimed", input: "Acceptance after the slot was claimed", rule: "Reject politely; keep the customer on the waitlist", output: "Courteous unavailable message", failure: "—" },
      { id: "no_match", kind: "branch", row: 4.6, title: "No eligible match", input: "No fit, or every offer ended", rule: "Stop offers; hand the slot to staff", output: "Front-desk task", failure: "—" },
      { id: "check_fit", kind: "check", row: 1, title: "Service and duration fit", input: "Customer preferences, slot", rule: "Duration equal; availability covers the time", output: "Eligible / excluded with reason", failure: "Excluded customers are never offered" },
      { id: "check_hold", kind: "check", row: 2.3, title: "Time limited hold", input: "Hold and clock", rule: "Hold expires at a fixed time; decline or expiry releases it", output: "Live / released", failure: "Expired hold cannot start a booking" },
      { id: "check_atomic", kind: "check", row: 5, title: "Atomic single booking", input: "Slot key", rule: "First claim on the slot key wins; later claims rejected", output: "One booking", failure: "Second claim → hold already claimed" },
    ],
    edges: [
      { from: "cancel", to: "match", kind: "flow" },
      { from: "match", to: "hold", kind: "flow" },
      { from: "hold", to: "offer", kind: "flow" },
      { from: "offer", to: "validate", kind: "flow" },
      { from: "validate", to: "commit", kind: "flow" },
      { from: "offer", to: "offer_expires", kind: "return" },
      { from: "offer_expires", to: "match", kind: "return", label: "next customer" },
      { from: "validate", to: "hold_claimed", kind: "return" },
      { from: "match", to: "no_match", kind: "return" },
      { from: "check_fit", to: "match", kind: "check" },
      { from: "check_hold", to: "hold", kind: "check" },
      { from: "check_atomic", to: "commit", kind: "check" },
    ],
  },
  demo,
};
