import type { DemoDefinition, Product, Run } from "../types";
import { Sim, aud, DAY, HOUR, normaliseReply, affirms, declines, mentions, negated } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

const PROPERTY = "Driftwood Cottages";
const GUEST = { id: "G-3318", name: "Hannah Brooks", email: "hannah.brooks@mail.example" };
const ORIGINAL = { room: "Sea View Queen", weekend: "Fri 14 – Sun 16 Nov", nights: 2, rate: 190, quotedValidHours: 48 };
const ALTERNATIVES = [
  { id: "alt_room", room: "Garden Twin", weekend: "Fri 14 – Sun 16 Nov", rateDelta: -20 },
  { id: "alt_date", room: "Sea View Queen", weekend: "Fri 21 – Sun 23 Nov", rateDelta: 0 },
];
const MAX_CONTACTS = 3;
const OFFER_VALID_HOURS = 24;
const STALE_AFTER_DAYS = 14;

/** Approved answers for the question the guest left unresolved. */
const QUESTION_ANSWERS: Record<string, string | null> = {
  "Is there parking?": "Yes — each cottage has one free off-street space next to the door.",
  "Can we check in late?": "Yes — self check-in with a lockbox code is available until midnight.",
  "Is the spa heated in winter?": null, // not in approved property facts
};

type Step = "too_early" | "awaiting_reply" | "at_checkout" | "done";

interface Offer {
  version: number;
  room: string;
  weekend: string;
  rate: number;
  validUntil: number;
}

interface State {
  step: Step;
  enquiryRef: string;
  contacts: number;
  refreshes: number;
  offer: Offer | null;
  bookedElsewhere: boolean;
  optedOut: boolean;
  checkoutRef: string | null;
  unclear: number;
}

/** Ready-to-book reply that matches the guest's unresolved question. */
const READY_REPLY: Record<string, string> = {
  "Is there parking?": "Great, parking sorted. Let’s book it.",
  "Can we check in late?": "Perfect, late check-in works for us. Let’s book it.",
  "Is the spa heated in winter?": "Thanks for checking on the spa. We’re happy to go ahead and book.",
};

/** Hours since the original quote, including simulated time since the run started. */
function quoteAgeHours(sim: Sim<State>) {
  return Math.round((Math.max(0, sim.num("days_since", 2)) * DAY + sim.run.clock) / HOUR);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function roomSoldOut(sim: Sim<State>) {
  return sim.str("room_status", "Available") === "Sold out";
}

function alreadyBooked(sim: Sim<State>) {
  return sim.str("guest_status", "Not booked").startsWith("Already booked") || sim.s.bookedElsewhere;
}

/** Live rate from the sample booking engine. Moves by A$10 each time it is re-read after expiry. */
function liveRate(sim: Sim<State>, delta = 0) {
  return Math.max(50, sim.num("current_rate", 205) + delta + sim.s.refreshes * 10);
}

function replyActions(sim: Sim<State>): Run["actions"] {
  const s = sim.s;
  const soldOut = roomSoldOut(sim);
  const actions: Run["actions"] = [];
  if (!soldOut) actions.push({ id: "ready", label: "Reply: ready to book", actor: "customer", tone: "primary", hint: `“${READY_REPLY[sim.str("question", "Is there parking?")] ?? "Let’s book it."}”` });
  else
    for (const a of ALTERNATIVES)
      actions.push({ id: a.id, label: `Choose ${a.room}, ${a.weekend}`, actor: "customer", tone: a.id === "alt_room" ? "primary" : "default" });
  actions.push(
    { id: "not_now", label: "Reply: not now", actor: "customer", hint: "“We’ve decided not to go away that weekend.”" },
    { id: "opt_out", label: "Reply: stop messaging me", actor: "customer", tone: "danger" },
    { id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. Is it still available? We’d like to book." } },
    { id: "wait", label: `Advance clock 2 days (no reply)${s.contacts >= MAX_CONTACTS ? " — limit reached" : ""}`, actor: "clock" },
    { id: "booked_web", label: "Guest books on the website instead", actor: "clock", hint: "Booking arrives through another channel." },
  );
  return actions;
}

/** Steps 2–4: permission/status → refresh rates → address question → send follow-up. */
function followUpCycle(sim: Sim<State>): Sim<State> {
  const s = sim.s;
  const question = sim.str("question", "Is there parking?");

  // 2. Permission and booking status (every cycle)
  sim.emit("permission", "started", `Checking permission and booking status (contact ${s.contacts + 1})`);
  if (!sim.bool("permission")) {
    sim.emit("check_contact", "blocked", "No follow-up permission", "Guest did not agree to follow-up messages on the enquiry form.");
    sim.patch("enquiry", { status: "Closed — no permission", tone: "muted" });
    s.step = "done";
    return sim.finish("stopped", { kind: "exception", summary: "The guest did not give permission for follow-up, so no message was prepared and the enquiry was closed." });
  }
  if (alreadyBooked(sim)) {
    const ref = s.bookedElsewhere ? "BK-web" : sim.str("guest_status").match(/BK-\d+/)?.[0] ?? "existing booking";
    sim.emit("check_contact", "blocked", "Already booked — contact suppressed", `Booking ${ref} found for ${GUEST.id}. No follow-up is sent.`);
    sim.emit("booked", "stopped", `Already booked (${ref}) — follow-up stopped`);
    sim.send({ channel: "email", to: GUEST.email, summary: "Follow-up (suppressed: already booked)", status: "suppressed" });
    sim.patch("enquiry", { status: `Closed — already booked (${ref})`, tone: "ok" });
    sim.emit("record", "confirmed", "Enquiry closed: guest already booked");
    s.step = "done";
    return sim.finish("stopped", { kind: "exception", summary: `The guest already holds booking ${ref}, so the follow-up was suppressed and the enquiry closed. They receive no sales message.` });
  }
  if (s.contacts >= MAX_CONTACTS) {
    sim.emit("check_contact", "blocked", `Contact limit reached — ${MAX_CONTACTS} messages`, "No further follow-up.");
    sim.emit("noreply", "stopped", `No reply after ${MAX_CONTACTS} follow-ups`);
    sim.patch("enquiry", { status: "Closed — no reply", tone: "muted", fields: [{ label: "Close reason", value: `No reply after ${MAX_CONTACTS} follow-ups` }] });
    sim.emit("record", "stopped", "Enquiry closed: no reply at contact limit");
    s.step = "done";
    return sim.finish("stopped", { kind: "exception", summary: `The guest did not reply to ${MAX_CONTACTS} follow-ups, so the enquiry closed at the contact limit with the reason recorded.` });
  }
  sim.emit("check_contact", "passed", `Permission on file, not booked, ${s.contacts} of ${MAX_CONTACTS} contacts used`);

  // 3. Refresh rooms and rates (never reuse the original quote)
  sim.emit("refresh", "started", "Refreshing rooms and rates from the booking engine");
  const ageH = quoteAgeHours(sim);
  const ageText = ageH < 48 ? `${ageH} hours` : `${Math.floor(ageH / 24)} day${Math.floor(ageH / 24) === 1 ? "" : "s"}`;
  const quoteExpired = ageH >= ORIGINAL.quotedValidHours;
  if (quoteExpired) sim.emit("check_rate", "info", `Original quote ${aud(ORIGINAL.rate)}/night has expired`, `Quoted ${ageText} ago; quotes are valid ${ORIGINAL.quotedValidHours} hours. The live rate is used instead.`);
  else sim.emit("check_rate", "info", `Original quote ${aud(ORIGINAL.rate)}/night is ${ageText} old — rechecked live anyway`, `Within its ${ORIGINAL.quotedValidHours}-hour validity, but every offer reads the current rate.`);
  let body: string;
  if (roomSoldOut(sim)) {
    sim.emit("check_rate", "failed", `${ORIGINAL.room} sold out for ${ORIGINAL.weekend}`, "It cannot be offered as available.");
    sim.emit("soldout", "info", "Original room sold out — offering alternatives");
    const alts = ALTERNATIVES.map((a) => `${a.room}, ${a.weekend} at ${aud(liveRate(sim, a.rateDelta))}/night`);
    sim.record({
      id: "availability",
      title: "Live availability",
      status: "Original room sold out",
      tone: "warn",
      fields: [
        { label: `${ORIGINAL.room}, ${ORIGINAL.weekend}`, value: "Sold out", tone: "bad" },
        ...ALTERNATIVES.map((a) => ({ label: `${a.room}, ${a.weekend}`, value: `Available · ${aud(liveRate(sim, a.rateDelta))}/night (live)`, tone: "ok" as const })),
      ],
    });
    s.offer = null;
    body = `The ${ORIGINAL.room} has now sold out for ${ORIGINAL.weekend}, but I can offer: ${alts.join("; or ")}.`;
  } else {
    const rate = liveRate(sim);
    s.offer = { version: (s.offer?.version ?? 0) + 1, room: ORIGINAL.room, weekend: ORIGINAL.weekend, rate, validUntil: sim.run.clock + OFFER_VALID_HOURS * HOUR };
    sim.emit("check_rate", "passed", `Live rate ${aud(rate)}/night valid ${OFFER_VALID_HOURS}h`, `Rechecked now for offer v${s.offer.version}.`);
    sim.record({
      id: "availability",
      title: "Live availability",
      ref: `v${s.offer.version}`,
      status: "Available",
      tone: "ok",
      fields: [
        { label: "Room", value: `${ORIGINAL.room}, ${ORIGINAL.weekend}` },
        { label: "Original quote", value: quoteExpired ? `${aud(ORIGINAL.rate)}/night — expired, not used` : `${aud(ORIGINAL.rate)}/night — superseded by live recheck`, tone: "muted" },
        { label: "Current rate", value: `${aud(rate)}/night · ${aud(rate * ORIGINAL.nights)} for ${ORIGINAL.nights} nights`, tone: "ok" },
        { label: "Offer valid", value: `${OFFER_VALID_HOURS} hours from this message` },
      ],
    });
    body = `The ${ORIGINAL.room} is still free for ${ORIGINAL.weekend} at ${aud(rate)} a night (${aud(rate * ORIGINAL.nights)} for ${ORIGINAL.nights} nights). That rate is held for ${OFFER_VALID_HOURS} hours.`;
  }
  sim.emit("refresh", "passed", "Rooms and rates refreshed");

  // 4. Address the unresolved question
  const answer = QUESTION_ANSWERS[question];
  let qLine: string;
  if (answer) {
    sim.emit("question", "passed", `Unresolved question answered: “${question}”`, "From approved property facts.");
    qLine = `You asked “${question}” — ${answer}`;
  } else {
    sim.emit("question", "info", `No approved answer for “${question}”`, "Staff asked to confirm; nothing is promised.");
    const key = `${s.enquiryRef}:question-task`;
    if (!sim.run.opKeys.includes(key)) {
      sim.claim(key, "question", "staff task");
      sim.send({ channel: "task", to: "Owner (Nick)", summary: `Confirm for guest: “${question}”`, status: "simulated", opKey: key });
    }
    qLine = `You asked “${question}” — I’ve asked Nick to confirm that for you rather than guess.`;
  }

  // Send the tailored follow-up
  s.contacts += 1;
  const key = `${s.enquiryRef}:followup:${s.contacts}`;
  sim.claim(key, "question", "follow-up");
  sim.say("assistant", `Hi ${GUEST.name.split(" ")[0]}, it’s ${PROPERTY}. ${qLine} ${body} Reply to book, or “stop” and we won’t message again.`);
  sim.send({ channel: "email", to: GUEST.email, summary: `Follow-up ${s.contacts} of ${MAX_CONTACTS}${s.offer ? ` — offer v${s.offer.version} ${aud(s.offer.rate)}/night` : " — alternatives"}`, status: "held", opKey: key });
  sim.emit("question", "waiting", `Follow-up ${s.contacts} of ${MAX_CONTACTS} queued`, "Held in the demo outbox — nothing is sent.", { opKey: key });
  sim.patch("enquiry", { status: "Following up — awaiting guest", tone: "warn", fields: [{ label: "Follow-ups", value: `${s.contacts} of ${MAX_CONTACTS}` }] });
  s.step = "awaiting_reply";
  return sim.wait("waiting_customer", replyActions(sim));
}

function openCheckout(sim: Sim<State>, room: string, weekend: string, rateDelta: number) {
  const s = sim.s;
  // Recheck at the moment of the offer the guest accepts.
  if (!s.offer || s.offer.room !== room || s.offer.weekend !== weekend) {
    const rate = liveRate(sim, rateDelta);
    s.offer = { version: (s.offer?.version ?? 0) + 1, room, weekend, rate, validUntil: sim.run.clock + OFFER_VALID_HOURS * HOUR };
    sim.emit("check_rate", "passed", `Live rate for ${room}, ${weekend}: ${aud(rate)}/night`, `Offer v${s.offer.version}, valid ${OFFER_VALID_HOURS}h.`);
  } else if (sim.run.clock > s.offer.validUntil) {
    sim.emit("check_rate", "failed", `Offer v${s.offer.version} expired — rate must be refreshed`, `${aud(s.offer.rate)}/night is no longer guaranteed.`);
    s.refreshes += 1;
    const rate = liveRate(sim, rateDelta);
    s.offer = { version: s.offer.version + 1, room, weekend, rate, validUntil: sim.run.clock + OFFER_VALID_HOURS * HOUR };
    sim.emit("refresh", "passed", `Rate refreshed: ${aud(rate)}/night (offer v${s.offer.version})`);
    sim.say("assistant", `That rate has expired, so I’ve rechecked: the ${room} is ${aud(rate)} a night now (${aud(rate * ORIGINAL.nights)} total), held for ${OFFER_VALID_HOURS} hours. Still keen?`);
    s.step = "awaiting_reply";
    return sim.wait("waiting_customer", [
      { id: "accept_refreshed", label: `Accept refreshed rate ${aud(rate)}/night`, actor: "customer", tone: "primary" },
      { id: "not_now", label: "Reply: not now", actor: "customer" },
      { id: "opt_out", label: "Reply: stop messaging me", actor: "customer", tone: "danger" },
    ]);
  } else {
    sim.emit("check_rate", "passed", `Offer v${s.offer.version} still valid — ${aud(s.offer.rate)}/night`);
  }
  const o = s.offer!;
  s.checkoutRef = sim.ref("CS");
  const key = `${s.enquiryRef}:checkout:v${o.version}`;
  sim.claim(key, "checkout", "checkout session");
  sim.send({ channel: "crm", to: "Booking engine (sample)", summary: `Checkout session ${s.checkoutRef} — ${o.room}, ${o.weekend}`, status: "simulated", opKey: key });
  sim.emit("checkout", "confirmed", `Checkout session ${s.checkoutRef} recovered`, `${o.room}, ${o.weekend}, ${aud(o.rate)}/night (offer v${o.version}).`, { opKey: key, ref: s.checkoutRef });
  sim.record({
    id: "checkout",
    title: "Recovered checkout session",
    ref: s.checkoutRef,
    status: "Open — awaiting guest",
    tone: "warn",
    fields: [
      { label: "Room", value: `${o.room}, ${o.weekend}` },
      { label: "Rate", value: `${aud(o.rate)}/night (live, offer v${o.version})` },
      { label: "Total", value: aud(o.rate * ORIGINAL.nights) },
      { label: "Rate valid until", value: `${OFFER_VALID_HOURS}h after offer` },
    ],
  });
  sim.patch("enquiry", { status: "Returned to checkout", tone: "warn" });
  sim.say("assistant", `Here’s your booking link for the ${o.room}, ${o.weekend}: ${aud(o.rate * ORIGINAL.nights)} in total. It’s a sample checkout — no card details are collected.`);
  s.step = "at_checkout";
  return sim.wait("waiting_customer", [
    { id: "complete", label: "Complete booking (payment success event)", actor: "customer", tone: "primary" },
    { id: "wait", label: "Advance clock 2 days (checkout left open)", actor: "clock" },
    { id: "opt_out", label: "Reply: stop messaging me", actor: "customer", tone: "danger" },
  ]);
}

function handleReady(sim: Sim<State>, text: string) {
  sim.advance(3 * HOUR);
  sim.say("customer", text);
  sim.emit("question", "passed", "Reply classified: ready to book");
  if (roomSoldOut(sim)) {
    sim.emit("soldout", "info", "Original room still sold out — choose an alternative");
    sim.say("assistant", `The ${ORIGINAL.room} is sold out for ${ORIGINAL.weekend}, so I can’t book that one. Would the Garden Twin that weekend, or the ${ORIGINAL.room} the following weekend, suit?`);
    return sim.wait("waiting_customer", replyActions(sim));
  }
  return openCheckout(sim, ORIGINAL.room, ORIGINAL.weekend, 0);
}

function handleNotNow(sim: Sim<State>, text: string) {
  sim.advance(3 * HOUR);
  sim.say("customer", text);
  sim.emit("question", "info", "Reply classified: not now");
  sim.say("assistant", "No problem — thanks for letting us know. We won’t follow up on this enquiry again.");
  sim.patch("enquiry", { status: "Closed — guest not travelling", tone: "muted", fields: [{ label: "Close reason", value: "Guest declined" }] });
  sim.emit("record", "stopped", "Enquiry closed: guest declined");
  sim.s.step = "done";
  return sim.finish("stopped", { kind: "exception", summary: "The guest said they are no longer travelling, so the follow-up closed with that reason and no further messages." });
}

function handleOptOut(sim: Sim<State>, text: string) {
  sim.say("customer", text);
  sim.s.optedOut = true;
  sim.emit("check_contact", "stopped", "Opt-out recorded — sequence ended", "All scheduled follow-ups cancelled.");
  sim.emit("optout", "stopped", "Opt out — no further contact");
  sim.send({ channel: "crm", to: "Enquiry CRM", summary: `${GUEST.id} opted out of follow-up`, status: "simulated", opKey: `${sim.s.enquiryRef}:optout` });
  sim.patch("enquiry", { status: "Closed — opted out", tone: "bad", fields: [{ label: "Close reason", value: "Opted out" }] });
  if (sim.getRecord("checkout")) sim.patch("checkout", { status: "Closed — guest opted out", tone: "muted" });
  sim.s.step = "done";
  return sim.finish("stopped", { kind: "stopped", summary: "The guest opted out, so the follow-up sequence ended immediately and nothing further will be sent." });
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Uses a sample enquiry, booking list and room inventory. No messages are sent, no card details are collected and no real booking is made.",
  assistantName: "Driftwood Cottages",
  channelLabel: "Email thread with the guest",
  fields: [
    { kind: "number", name: "days_since", label: "Simulation date: days since enquiry", min: 0, max: 30, helper: `Follow-up starts after 1 day; enquiries older than ${STALE_AFTER_DAYS} days are closed.` },
    { kind: "select", name: "guest_status", label: "Guest booking status", options: ["Not booked", "Already booked (BK-2207)"] },
    { kind: "select", name: "room_status", label: `${ORIGINAL.room}, ${ORIGINAL.weekend}`, options: ["Available", "Sold out"] },
    { kind: "number", name: "current_rate", label: "Current live rate", min: 80, max: 600, suffix: "A$/night", helper: `Original quote was ${aud(ORIGINAL.rate)}/night.` },
    { kind: "select", name: "question", label: "Guest’s unresolved question", options: Object.keys(QUESTION_ANSWERS) },
    { kind: "toggle", name: "permission", label: "Agreed to follow-up" },
  ],
  scenarios: [
    { id: "ready_to_book", label: "Ready to book", kind: "success", description: "Two days after the enquiry. The room is free at a new rate; the guest wants to book once parking is confirmed.", inputs: { days_since: 2, guest_status: "Not booked", room_status: "Available", current_rate: 205, question: "Is there parking?", permission: true } },
    { id: "no_reply", label: "No reply", kind: "exception", description: "Advance the clock without a reply. Follow-up stops at the contact limit.", inputs: { days_since: 1, guest_status: "Not booked", room_status: "Available", current_rate: 190, question: "Can we check in late?", permission: true } },
    { id: "sold_out", label: "Room sold out", kind: "exception", description: "The requested room has sold out. Only rooms that are actually free are offered.", inputs: { days_since: 3, guest_status: "Not booked", room_status: "Sold out", current_rate: 215, question: "Is there parking?", permission: true } },
    { id: "already_booked", label: "Already booked", kind: "exception", description: "The guest booked by phone yesterday. No follow-up may be sent.", inputs: { days_since: 2, guest_status: "Already booked (BK-2207)", room_status: "Available", current_rate: 205, question: "Is there parking?", permission: true } },
  ],

  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("booking-follow-up", scenarioId, inputs, { step: "awaiting_reply", enquiryRef: "", contacts: 0, refreshes: 0, offer: null, bookedElsewhere: false, optedOut: false, checkoutRef: null, unclear: 0 });
    const days = Math.max(0, Math.round(sim.num("days_since", 2)));
    const question = sim.str("question", "Is there parking?");
    sim.s.enquiryRef = sim.ref("ENQ");
    sim.say("customer", `(Original enquiry, ${days} day${days === 1 ? "" : "s"} ago) Hi, do you have the ${ORIGINAL.room} for ${ORIGINAL.weekend}? ${question}`);
    sim.say("system", `Guest was quoted ${aud(ORIGINAL.rate)}/night and opened checkout, but did not finish.`);

    // 1. Unfinished enquiry ages
    sim.emit("ages", "started", `Unfinished enquiry ${sim.s.enquiryRef} is ${days} day${days === 1 ? "" : "s"} old`);
    sim.record({
      id: "enquiry",
      title: "Enquiry record",
      ref: sim.s.enquiryRef,
      status: "Unfinished",
      fields: [
        { label: "Guest", value: `${GUEST.name} (${GUEST.id})` },
        { label: "Asked for", value: `${ORIGINAL.room}, ${ORIGINAL.weekend}, ${ORIGINAL.nights} nights` },
        { label: "Original quote", value: `${aud(ORIGINAL.rate)}/night (valid ${ORIGINAL.quotedValidHours}h)` },
        { label: "Unresolved question", value: question },
        { label: "Follow-ups", value: `0 of ${MAX_CONTACTS}` },
      ],
    });
    if (days > STALE_AFTER_DAYS) {
      sim.emit("ages", "stopped", `Older than ${STALE_AFTER_DAYS} days — closed without contact`);
      sim.patch("enquiry", { status: "Closed — too old to follow up", tone: "muted" });
      sim.emit("record", "stopped", "Enquiry closed: stale");
      return sim.finish("stopped", { kind: "exception", summary: `The enquiry is ${days} days old, beyond the ${STALE_AFTER_DAYS}-day follow-up window, so it was closed without contacting the guest.` }).done();
    }
    if (days < 1) {
      sim.emit("ages", "waiting", "Too early — follow-up is due 24 hours after the enquiry");
      sim.s.step = "too_early";
      return sim.wait("running", [{ id: "tick", label: "Advance clock 1 day", actor: "clock", tone: "primary" }]).done();
    }
    sim.emit("ages", "passed", "Follow-up due");
    return followUpCycle(sim).done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;
    if (s.step === "done") return sim.done();

    switch (actionId) {
      case "tick": {
        sim.advance(1 * DAY);
        sim.emit("ages", "passed", "Follow-up due (24 hours elapsed)");
        return followUpCycle(sim).done();
      }

      case "wait": {
        sim.advance(2 * DAY);
        if (s.step === "at_checkout") {
          sim.emit("checkout", "info", "Checkout left open for 2 days");
          const o = s.offer!;
          if (sim.run.clock > o.validUntil) sim.emit("check_rate", "info", `Offer v${o.version} has now expired`, "Completing checkout will require a rate refresh.");
          return sim
            .wait("waiting_customer", [
              { id: "complete", label: "Complete booking (payment success event)", actor: "customer", tone: "primary" },
              { id: "opt_out", label: "Reply: stop messaging me", actor: "customer", tone: "danger" },
            ])
            .done();
        }
        sim.emit("noreply", "info", "No reply within 2 days");
        if (s.contacts < MAX_CONTACTS) sim.emit("noreply", "info", "Limited retry — rechecking status and rates first");
        return followUpCycle(sim).done();
      }

      case "booked_web": {
        sim.advance(6 * HOUR);
        s.bookedElsewhere = true;
        sim.emit("record", "info", "Booking BK-web received through the website", "Linked to the same guest ID.");
        sim.emit("check_booking", "passed", "Confirmed booking found for this guest — follow-up must stop");
        sim.emit("check_contact", "blocked", "Already booked — next follow-up suppressed");
        sim.emit("booked", "stopped", "Already booked — follow-up stopped");
        sim.patch("enquiry", { status: "Closed — booked via website (BK-web)", tone: "ok", fields: [{ label: "Close reason", value: "Confirmed booking through another channel" }] });
        s.step = "done";
        return sim.finish("completed", { kind: "success", summary: "The guest booked through the website. The confirmed booking was matched to the enquiry, so follow-up stopped and no further messages are queued." }).done();
      }

      case "accept_refreshed": {
        if (!s.offer) return sim.done();
        sim.advance(1 * HOUR);
        sim.say("customer", "Yes, that’s fine — go ahead.");
        sim.emit("question", "passed", `Guest accepted refreshed offer v${s.offer.version}`);
        const alt = ALTERNATIVES.find((a) => a.room === s.offer!.room && a.weekend === s.offer!.weekend);
        return openCheckout(sim, s.offer.room, s.offer.weekend, alt && roomSoldOut(sim) ? alt.rateDelta : 0).done();
      }

      case "ready":
        return handleReady(sim, READY_REPLY[sim.str("question", "Is there parking?")] ?? "Great, thanks. Let’s book it.").done();

      case "alt_room":
      case "alt_date": {
        if (!roomSoldOut(sim)) return sim.done();
        const alt = ALTERNATIVES.find((a) => a.id === actionId)!;
        sim.advance(3 * HOUR);
        sim.say("customer", `The ${alt.room}, ${alt.weekend} works for us.`);
        sim.emit("soldout", "passed", `Alternative chosen: ${alt.room}, ${alt.weekend}`, "Offer alternatives → refresh rate for this room.");
        return openCheckout(sim, alt.room, alt.weekend, alt.rateDelta).done();
      }

      case "not_now":
        return handleNotNow(sim, "We’ve decided not to go away that weekend, thanks.").done();

      case "opt_out":
        return handleOptOut(sim, "Please stop messaging me.").done();

      case "free": {
        const text = (payload ?? "").trim();
        if (!text) return sim.done();
        const t = normaliseReply(text);
        const STOP = /\b(stop|unsubscribe|opt out)\b/;
        const KEEN = /\b(book|keen|ready|love to|would love|please)\b/;
        if ((mentions(t, STOP) && !negated(t, STOP)) || /\b(don't|do not) (contact|message|email)\b/.test(t)) return handleOptOut(sim, text).done();
        if (declines(t) || /\b(cancel|decided not|elsewhere|not travelling|not going)\b/.test(t)) return handleNotNow(sim, text).done();
        if (affirms(t) || (mentions(t, KEEN) && !negated(t, KEEN))) return handleReady(sim, text).done();
        sim.advance(1 * HOUR);
        sim.say("customer", text);
        s.unclear += 1;
        if (s.unclear === 1) {
          sim.emit("question", "info", "Reply not understood — asking to clarify", "No booking action is taken.");
          sim.say("assistant", "Thanks for getting back to us! Would you like me to send the booking link, or would you prefer different dates?");
          return sim.wait("waiting_customer", replyActions(sim)).done();
        }
        const key = `${s.enquiryRef}:unclear-task`;
        if (!sim.run.opKeys.includes(key)) {
          sim.claim(key, "question", "staff task");
          sim.send({ channel: "task", to: "Owner (Nick)", summary: `Guest reply needs a person: “${text.slice(0, 60)}”`, status: "simulated", opKey: key });
        }
        sim.emit("question", "info", "Still unclear — handed to the owner", "Automated follow-up paused on human takeover.");
        sim.say("assistant", "Thanks — I’ve passed your message to Nick, who will reply personally.");
        sim.patch("enquiry", { status: "Handed to owner", tone: "warn", fields: [{ label: "Close reason", value: "Human takeover" }] });
        sim.emit("record", "stopped", "Automated follow-up stopped: human takeover");
        s.step = "done";
        return sim.finish("stopped", { kind: "exception", summary: "The guest’s reply could not be interpreted, so the owner took over and automated follow-up stopped." }).done();
      }

      case "complete": {
        if (s.step !== "at_checkout" || !s.offer) return sim.done();
        const o = s.offer;
        if (sim.run.clock > o.validUntil) {
          const alt = ALTERNATIVES.find((a) => a.room === o.room && a.weekend === o.weekend);
          return openCheckout(sim, o.room, o.weekend, alt && roomSoldOut(sim) ? alt.rateDelta : 0).done();
        }
        sim.advance(10);
        const key = `${s.checkoutRef}:booking`;
        if (!sim.claim(key, "record", "booking")) return sim.done();
        const bk = sim.ref("BK");
        const pay = sim.ref("PAY");
        sim.send({ channel: "payment", to: "Payment provider (sample)", summary: `${pay} succeeded — ${aud(o.rate * ORIGINAL.nights)}`, status: "simulated", opKey: `${key}:payment` });
        sim.emit("checkout", "passed", `Payment event ${pay} succeeded (simulated)`);
        sim.send({ channel: "calendar", to: "Booking engine (sample)", summary: `Booking ${bk}: ${o.room}, ${o.weekend}`, status: "simulated", opKey: key });
        sim.emit("check_booking", "passed", `Booking ${bk} verified in booking engine`, `Offer v${o.version} at ${aud(o.rate)}/night.`, { ref: bk });
        sim.emit("record", "confirmed", `Booking ${bk} recorded — follow-up stopped`, "Confirmed booking stops the sequence.", { opKey: key, ref: bk });
        sim.record({
          id: "booking",
          title: "Recovered booking",
          ref: bk,
          status: "Confirmed",
          tone: "ok",
          fields: [
            { label: "Guest", value: `${GUEST.name} (${GUEST.id})` },
            { label: "Stay", value: `${o.room}, ${o.weekend}` },
            { label: "Rate", value: `${aud(o.rate)}/night (live at offer v${o.version})` },
            { label: "Paid", value: `${aud(o.rate * ORIGINAL.nights)} (${pay}, simulated)`, tone: "ok" },
          ],
        });
        sim.patch("checkout", { status: "Completed", tone: "ok" });
        sim.patch("enquiry", { status: `Recovered — booking ${bk}`, tone: "ok", fields: [{ label: "Close reason", value: "Booked" }] });
        sim.say("assistant", `You’re booked — ${o.room}, ${o.weekend}. Confirmation ${bk} is ready to send (held in this demo).`);
        s.step = "done";
        return sim.finish("completed", { kind: "success", summary: `Booking ${bk} was verified in the booking engine at the live rate of ${aud(o.rate)}/night, so the follow-up sequence stopped.` }).done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const bookingFollowUp: Product = {
  id: "booking-follow-up",
  no: 14,
  slug: "booking-follow-up",
  name: "Booking Follow-up",
  outcome: "Recover unfinished booking enquiries.",
  sectorLabel: "Small accommodation",
  sectors: ["Accommodation"],
  outcomes: ["Convert sales"],
  definition:
    "Follows up eligible accommodation enquiries that stopped short of booking, using current availability and an answer to the question the guest left unresolved. It returns the guest to checkout at a freshly checked rate and stops as soon as they book, decline, opt out or reach the contact limit.",
  situation:
    "A guest asked about the Sea View Queen for a weekend and whether there was parking, opened the booking page and left. By the time the owner notices, the quoted rate has changed and the room may have sold.",
  endState:
    "Unfinished enquiries get a timely, accurate follow-up that answers the guest’s question and offers only what is actually available. Guests who already booked or opted out hear nothing, and every enquiry ends as a booking or a closed record with a reason.",
  handles: [
    "Checks permission and existing bookings before every follow-up",
    "Rechecks room and rate at every offer instead of reusing the original quote",
    "Answers the guest’s unresolved question from approved property facts",
    "Offers alternatives when the requested room has sold out",
    "Returns the guest to a checkout session and stops on booking, opt-out or the contact limit",
  ],
  boundaries: [
    "Never offers a sold-out room as available",
    "Never reuses a stale or expired rate",
    "Never contacts a guest who has already booked or opted out",
  ],
  delivered: [
    { title: "Recovered booking", body: "Booking reference, stay, live rate at the accepted offer and payment reference." },
    { title: "Owner handoff", body: "Questions the approved facts cannot answer, or replies that need a person, assigned to the owner with follow-up paused." },
    { title: "Enquiry record", body: "Original enquiry, each follow-up against the limit, rate refreshes and the close reason: booked, declined, opted out, no reply or already booked." },
  ],
  deployment: {
    rules: [
      "When an enquiry counts as unfinished and when follow-up starts",
      "Contact limits, spacing and follow-up permission rules",
      "Rate validity and how alternatives are chosen",
      "Approved answers to common guest questions",
    ],
    systems: ["Enquiry CRM", "Booking engine", "Property inventory", "Email or SMS with consent records"],
  },
  measures: [
    "Incremental recovered stays, separated from bookings that would have happened anyway",
    "Contribution from recovered stays",
    "Enquiries closed with a recorded reason",
  ],
  reliability: [
    "Follow-ups sent to guests who had already booked (target: zero)",
    "Offers made at a stale rate or for a sold-out room (target: zero)",
    "Messages sent after opt-out or above the contact limit (target: zero)",
  ],
  harness: {
    systems:
      "Production uses the enquiry CRM, booking engine, property inventory and an eligible messaging channel, with enquiries and bookings linked by customer ID. The demo uses one sample enquiry, a sample booking list and a room inventory whose rate you can edit.",
    controls: [
      "Permission check before every follow-up",
      "Booking deduplication: an existing booking suppresses contact",
      "Current inventory and rates rechecked at every offer; expired rates refreshed",
      `Contact limit of ${MAX_CONTACTS} follow-ups`,
      "Confirmed booking stops the sequence",
    ],
  },
  ctaLine: "Want this following up your actual unfinished enquiries?",
  graph: {
    nodes: [
      { id: "ages", kind: "action", row: 0, title: "Unfinished enquiry ages", input: "Enquiry with no booking", rule: `Due after 24 hours; closed after ${STALE_AFTER_DAYS} days`, output: "Follow-up due", failure: "Too old → close without contact", system: "Enquiry CRM (demo: fixture)" },
      { id: "permission", kind: "action", row: 1, title: "Check permission and booking status", input: "Guest ID", rule: "Permission on file; no existing booking; under contact limit", output: "Allowed / suppressed", failure: "Booked → stop; limit → close", system: "Enquiry CRM + bookings (demo: fixture)" },
      { id: "refresh", kind: "action", row: 2, title: "Refresh rooms and rates", input: "Requested room and dates", rule: "Live availability and rate every time; original quote never reused", output: "Current offer with version and expiry", failure: "Sold out → alternatives", system: "Booking engine (demo: fixture)" },
      { id: "question", kind: "action", row: 3, title: "Address unresolved question", input: "Guest’s question + current offer", rule: "Answer from approved facts; unknown → owner", output: "Tailored follow-up in outbox", failure: "Unclear reply twice → owner", system: "Email (demo: held outbox)" },
      { id: "checkout", kind: "action", row: 4, title: "Return guest to checkout", input: "Accepted offer", rule: `Rate valid ${OFFER_VALID_HOURS}h; expired → refresh first`, output: "Recovered checkout session", failure: "Expired → re-quote", system: "Booking engine (demo: simulated)" },
      { id: "record", kind: "action", row: 5, title: "Record booking or closed enquiry", input: "Booking event or stop reason", rule: "Booking stops the sequence; every close has a reason", output: "Booking or closed enquiry", failure: "—", system: "CRM (demo: simulated write)" },
      { id: "booked", kind: "branch", row: 1, title: "Already booked", input: "Booking found for guest ID", rule: "Suppress contact and close", output: "Closed enquiry", failure: "—" },
      { id: "soldout", kind: "branch", row: 2.5, title: "Original room sold out", input: "No availability for requested room", rule: "Offer only rooms that are free now", output: "Alternative room or dates", failure: "—" },
      { id: "noreply", kind: "branch", row: 3.9, title: "No reply", input: "No reply within 2 days", rule: `Retry up to ${MAX_CONTACTS} contacts, rechecking each time`, output: "Next follow-up or closed enquiry", failure: "—" },
      { id: "optout", kind: "branch", row: 5, title: "Opt out", input: "Guest asks to stop", rule: "End the sequence immediately", output: "Opt-out record", failure: "—" },
      { id: "check_contact", kind: "check", row: 0.8, title: "Contact and status checks", input: "Permission, bookings, contact count", rule: `Permission required; booked guests suppressed; max ${MAX_CONTACTS}`, output: "Pass / blocked", failure: "Blocked → no message" },
      { id: "check_rate", kind: "check", row: 2.2, title: "Live rate validity", input: "Offer rate and expiry", rule: `Rate read live at each offer; valid ${OFFER_VALID_HOURS}h`, output: "Valid rate", failure: "Expired → refresh; sold out → not offered" },
      { id: "check_booking", kind: "check", row: 4.9, title: "Verified booking outcome", input: "Booking engine event", rule: "Booking must exist in the engine before recovery is recorded", output: "Verified booking reference", failure: "No event → not booked" },
    ],
    edges: [
      { from: "ages", to: "permission", kind: "flow" },
      { from: "permission", to: "refresh", kind: "flow" },
      { from: "refresh", to: "question", kind: "flow" },
      { from: "question", to: "checkout", kind: "flow" },
      { from: "checkout", to: "record", kind: "flow" },
      { from: "permission", to: "booked", kind: "return" },
      { from: "refresh", to: "soldout", kind: "return" },
      { from: "soldout", to: "refresh", kind: "return", label: "offer alternatives" },
      { from: "question", to: "noreply", kind: "return" },
      { from: "noreply", to: "permission", kind: "return", label: "limited retry" },
      { from: "question", to: "optout", kind: "return" },
      { from: "check_contact", to: "permission", kind: "check" },
      { from: "check_rate", to: "refresh", kind: "check" },
      { from: "check_booking", to: "record", kind: "check" },
    ],
  },
  demo,
};
