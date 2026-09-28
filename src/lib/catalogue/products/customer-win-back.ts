import type { DemoDefinition, Product, Run } from "../types";
import { Sim, DAY, HOUR } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

const SALON = "Willow & Rye Hair Studio";

const CUSTOMERS: Record<string, { id: string; phone: string; service: string }> = {
  "Mia Chen": { id: "C-1042", phone: "+61 400 000 142", service: "Cut and colour" },
  "Grace Patel": { id: "C-1187", phone: "+61 400 000 187", service: "Balayage" },
  "Tom Reilly": { id: "C-0931", phone: "+61 400 000 931", service: "Men’s cut" },
  "Leo Walsh": { id: "C-1215", phone: "+61 400 000 215", service: "Cut and blow-dry" },
  "Ava Morgan": { id: "C-1302", phone: "+61 400 000 302", service: "Colour refresh" },
};
const CUSTOMER_NAMES = Object.keys(CUSTOMERS);

/** Offers the owner has approved in advance. The assistant can only pick from this list. */
const APPROVED_OFFERS: Record<string, { code: string; text: string; limit: string }> = {
  "Cut and colour": { code: "WB-COLOUR-10", text: "10% off your next cut and colour", limit: "One use per customer, valid 30 days" },
  Balayage: { code: "WB-TONER", text: "a complimentary gloss toner with your next balayage", limit: "One use per customer, valid 30 days" },
  "Men’s cut": { code: "WB-CUT-5", text: "A$5 off your next cut", limit: "One use per customer, valid 30 days" },
  "Cut and blow-dry": { code: "WB-BLOW", text: "a free blow-dry upgrade", limit: "One use per customer, valid 30 days" },
  "Colour refresh": { code: "WB-COLOUR-10", text: "10% off your next colour refresh", limit: "One use per customer, valid 30 days" },
};

const LAPSE_FACTOR = 1.5; // unusual gap = more than 1.5× the customer's own interval
const FREQUENCY_CAP = 2; // promotional contacts allowed per 30 days across all campaigns
const MAX_MESSAGES = 2; // invitation + one reminder per campaign
const SLOTS = ["Thursday 10:00", "Saturday 13:30"];

type Step = "awaiting_reply" | "awaiting_slot" | "awaiting_complaint_task" | "awaiting_recovery_task" | "done";

interface State {
  step: Step;
  customerId: string;
  messages: number;
  unclear: number;
  offerCode: string | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function customer(sim: Sim<State>) {
  const name = sim.str("customer", "Mia Chen");
  const c = CUSTOMERS[name] ?? CUSTOMERS["Mia Chen"];
  return { name, first: name.split(" ")[0], ...c };
}

function replyActions(sim: Sim<State>): Run["actions"] {
  const actions: Run["actions"] = [
    { id: "interested", label: "Reply: interested", actor: "customer", tone: "primary", hint: "“Oh yes, I’ve been meaning to book. What have you got?”" },
    { id: "unhappy", label: "Reply: unhappy", actor: "customer", hint: "“Honestly the last colour faded in two weeks.”" },
    { id: "not_interested", label: "Reply: not interested", actor: "customer", hint: "“Not right now, thanks.”" },
    { id: "opt_out", label: "Reply STOP (opt out)", actor: "customer", tone: "danger" },
    { id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. Yes please, can I come in next week?" } },
  ];
  if (sim.s.messages < MAX_MESSAGES) actions.push({ id: "wait", label: "Advance clock 7 days (no reply)", actor: "clock" });
  else actions.push({ id: "wait", label: "Advance clock 7 days (no reply, limit reached)", actor: "clock" });
  return actions;
}

function sendMessage(sim: Sim<State>, kind: "invitation" | "reminder") {
  const s = sim.s;
  const c = customer(sim);
  const offer = APPROVED_OFFERS[c.service];
  s.messages += 1;
  const key = `${s.customerId}:winback:${kind}`;
  if (!sim.claim(key, "reply", kind)) return;
  const text =
    kind === "invitation"
      ? `Hi ${c.first}, it’s ${SALON}. It’s been a while since your last ${c.service.toLowerCase()} — we’d love to see you again. As a welcome back, we can offer ${offer.text} (${offer.limit.toLowerCase()}). Reply to book, or STOP to opt out.`
      : `Hi ${c.first}, just a reminder that ${offer.text} is still available for the next few weeks. Reply to book, or STOP to opt out.`;
  sim.say("assistant", text);
  sim.send({ channel: "sms", to: c.phone, summary: `Win-back ${kind} (${s.messages} of ${MAX_MESSAGES}) — ${offer.code}`, status: "held", opKey: key });
  sim.emit("reply", "waiting", `${kind === "invitation" ? "Invitation" : "Reminder"} queued (${s.messages} of ${MAX_MESSAGES})`, "Held in the demo outbox — the public demo sends no messages.", { opKey: key });
  sim.patch("campaign", { status: "Contacted — awaiting reply", fields: [{ label: "Messages this campaign", value: `${s.messages} of ${MAX_MESSAGES}` }] });
}

function endSequence(sim: Sim<State>, reason: string) {
  sim.emit("check_history", "passed", "Sequence ended in shared contact history", reason);
  sim.send({ channel: "crm", to: "Customer record", summary: `Win-back closed: ${reason}`, status: "simulated", opKey: `${sim.s.customerId}:winback:close` });
  sim.s.step = "done";
}

function staffTask(sim: Sim<State>, kind: "complaint" | "recovery", summary: string) {
  const s = sim.s;
  const key = `${s.customerId}:task:${kind}`;
  if (!sim.claim(key, "book", "staff task")) return;
  const ref = sim.ref("TSK");
  sim.send({ channel: "task", to: "Salon manager (Jess)", summary, status: "simulated", opKey: key });
  sim.record({
    id: "task",
    title: kind === "complaint" ? "Complaint follow-up task" : "Service recovery task",
    ref,
    status: "Assigned — awaiting staff",
    tone: "warn",
    fields: [
      { label: "Assigned to", value: "Salon manager (Jess)" },
      { label: "Reason", value: summary },
      { label: "Promotion", value: "Suppressed", tone: "bad" },
    ],
  });
  sim.emit("book", "waiting", kind === "complaint" ? "Complaint follow-up task created" : "Staff task created for negative reply", `${ref} assigned to the salon manager. No offer is sent.`, { opKey: key, ref });
}

function handleInterested(sim: Sim<State>, text: string) {
  const s = sim.s;
  sim.advance(2 * HOUR);
  sim.say("customer", text);
  sim.emit("reply", "passed", "Reply classified: interested");
  sim.say("assistant", `Lovely! I can hold ${SLOTS[0]} or ${SLOTS[1]} with your usual stylist. Which suits?`);
  s.step = "awaiting_slot";
  return sim.wait("waiting_customer", [
    { id: "book_first", label: `Choose ${SLOTS[0]}`, actor: "customer", tone: "primary" },
    { id: "book_second", label: `Choose ${SLOTS[1]}`, actor: "customer" },
    { id: "opt_out", label: "Reply STOP (opt out)", actor: "customer", tone: "danger" },
  ]);
}

function handleUnhappy(sim: Sim<State>, text: string) {
  const s = sim.s;
  sim.advance(2 * HOUR);
  sim.say("customer", text);
  sim.emit("reply", "info", "Reply classified: unhappy", "Promotion stops. A person handles this, not the assistant.");
  sim.say("assistant", `I’m sorry to hear that, ${customer(sim).first}. I’ve passed this to our salon manager, who will call you personally.`);
  staffTask(sim, "recovery", "Customer replied unhappy to win-back invitation — call and recover");
  sim.patch("campaign", { status: "Paused — staff follow-up", tone: "warn", fields: [{ label: "Offer", value: "Withdrawn pending staff call", tone: "muted" }] });
  s.step = "awaiting_recovery_task";
  return sim.wait("waiting_staff", [
    { id: "staff_recovered", label: "Staff: log call — issue resolved, redo booked", actor: "staff", tone: "primary" },
    { id: "staff_no_answer", label: "Staff: log call — no answer, keep task open", actor: "staff" },
  ]);
}

function handleNotInterested(sim: Sim<State>, text: string) {
  sim.advance(2 * HOUR);
  sim.say("customer", text);
  sim.emit("reply", "info", "Reply classified: not interested");
  sim.say("assistant", "No problem at all — thanks for letting us know.");
  sim.emit("notready", "stopped", "Not ready — no further messages this campaign", "Later eligibility check in 90 days, still subject to permission and frequency cap.");
  sim.patch("campaign", { status: "Closed — not ready", tone: "muted", fields: [{ label: "Next eligibility check", value: "In 90 days" }] });
  endSequence(sim, "customer not interested");
  return sim.finish("stopped", { kind: "exception", summary: "The customer declined for now. The campaign closed without further messages and a later eligibility check was scheduled." });
}

function handleOptOut(sim: Sim<State>, text: string) {
  sim.say("customer", text);
  sim.emit("optout", "stopped", "Opt-out recorded", "Added to the suppression list for all promotional campaigns.");
  sim.send({ channel: "crm", to: "Suppression list", summary: `${customer(sim).name} opted out of promotions`, status: "simulated", opKey: `${sim.s.customerId}:optout` });
  sim.emit("check_permission", "blocked", "Later campaign blocked by opt-out", "Spring colour campaign (sample) re-checked this customer: excluded.");
  sim.patch("campaign", { status: "Stopped — opted out", tone: "bad", fields: [{ label: "Promotional permission", value: "Withdrawn", tone: "bad" }] });
  sim.s.step = "done";
  return sim.finish("stopped", { kind: "stopped", summary: "The customer opted out. The sequence stopped and every later promotional campaign now excludes them." });
}

function book(sim: Sim<State>, slot: string) {
  const s = sim.s;
  const c = customer(sim);
  sim.advance(10);
  sim.say("customer", `${slot} please.`);
  const key = `${s.customerId}:booking`;
  if (!sim.claim(key, "book", "booking")) return sim;
  const ref = sim.ref("BK");
  sim.send({ channel: "calendar", to: "Salon booking system (sample)", summary: `${c.service} — ${slot} (${ref})`, status: "simulated", opKey: key });
  sim.emit("book", "confirmed", `Return visit booked — ${ref}`, `${c.service}, ${slot}. Calendar write confirmed by the sample booking system.`, { opKey: key, ref });
  sim.record({
    id: "booking",
    title: "Reactivation booking",
    ref,
    status: "Booked",
    tone: "ok",
    fields: [
      { label: "Customer", value: `${c.name} (${c.id})` },
      { label: "Service", value: c.service },
      { label: "Slot", value: slot },
      { label: "Offer applied", value: s.offerCode ?? "—" },
    ],
  });
  sim.say("assistant", `You’re booked for ${slot} — see you then! Booking ${ref}.`);
  sim.emit("record", "confirmed", "Outcome recorded: reactivation booking");
  sim.emit("record", "stopped", "Reminder cancelled — booking ends the sequence");
  sim.patch("campaign", { status: "Won back — booked", tone: "ok", fields: [{ label: "Result", value: `Booking ${ref}` }] });
  endSequence(sim, "booking made");
  return sim.finish("completed", { kind: "success", summary: `Booking ${ref} was written to the sample calendar, so the win-back sequence ended and no reminder will be sent.` });
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Interactive simulation using a sample salon customer list and booking calendar. No messages are sent and no real appointment is created.",
  assistantName: "Willow & Rye",
  channelLabel: "SMS thread with the customer",
  fields: [
    { kind: "select", name: "customer", label: "Sample customer", options: CUSTOMER_NAMES },
    { kind: "number", name: "interval_weeks", label: "Usual visit interval", min: 1, max: 52, suffix: "weeks", helper: "Calculated from their own visit history." },
    { kind: "number", name: "weeks_since", label: "Last visit", min: 0, max: 104, suffix: "weeks ago" },
    { kind: "select", name: "complaint", label: "Complaint status", options: ["None", "Open — unresolved", "Resolved"] },
    { kind: "toggle", name: "opted_out", label: "Opted out of promotions" },
    { kind: "number", name: "recent_contacts", label: "Promotional contacts in last 30 days", min: 0, max: 10, helper: `Across all campaigns. Cap is ${FREQUENCY_CAP}.` },
  ],
  scenarios: [
    { id: "lapsed_regular", label: "Lapsed regular", kind: "success", description: "Six-weekly regular, last seen four months ago. Eligible for an approved invitation.", inputs: { customer: "Mia Chen", interval_weeks: 6, weeks_since: 17, complaint: "None", opted_out: false, recent_contacts: 0 } },
    { id: "open_complaint", label: "Unresolved complaint", kind: "exception", description: "Also lapsed, but has an open complaint. Promotion is suppressed and staff follow up.", inputs: { customer: "Grace Patel", interval_weeks: 8, weeks_since: 18, complaint: "Open — unresolved", opted_out: false, recent_contacts: 0 } },
    { id: "opted_out", label: "Opted out", kind: "exception", description: "Lapsed, but previously opted out. No campaign may contact them.", inputs: { customer: "Tom Reilly", interval_weeks: 4, weeks_since: 12, complaint: "None", opted_out: true, recent_contacts: 0 } },
    { id: "not_lapsed", label: "Not lapsed yet", kind: "exception", description: "Last visit is within their normal rhythm, so there is nothing to win back.", inputs: { customer: "Leo Walsh", interval_weeks: 6, weeks_since: 7, complaint: "None", opted_out: false, recent_contacts: 0 } },
    { id: "frequency_cap", label: "Contacted too often", kind: "exception", description: "Lapsed and eligible, but two other campaigns already contacted her this month.", inputs: { customer: "Ava Morgan", interval_weeks: 5, weeks_since: 15, complaint: "None", opted_out: false, recent_contacts: 2 } },
  ],

  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("customer-win-back", scenarioId, inputs, { step: "awaiting_reply", customerId: "", messages: 0, unclear: 0, offerCode: null });
    const c = customer(sim);
    sim.s.customerId = c.id;
    const interval = Math.max(1, sim.num("interval_weeks", 6));
    const since = Math.max(0, sim.num("weeks_since", 0));
    const complaint = sim.str("complaint", "None");
    const optedOut = sim.bool("opted_out");
    const recent = Math.max(0, sim.num("recent_contacts", 0));
    const ratio = since / interval;
    const threshold = Math.round(interval * LAPSE_FACTOR * 10) / 10;

    // 1. Detect unusual lapse
    sim.emit("detect", "started", "Weekly lapse scan", `${c.name} (${c.id}) · ${c.service}`);
    sim.record({
      id: "eligibility",
      title: "Eligibility review",
      ref: c.id,
      status: "Checking",
      fields: [
        { label: "Customer", value: c.name },
        { label: "Usual interval", value: `${interval} weeks (own history)` },
        { label: "Last visit", value: `${since} weeks ago` },
        { label: "Lapse", value: `${ratio.toFixed(1)}× usual interval (threshold ${LAPSE_FACTOR}× = ${threshold} weeks)`, tone: ratio > LAPSE_FACTOR ? "warn" : "ok" },
      ],
    });
    if (ratio <= LAPSE_FACTOR) {
      sim.emit("detect", "info", `Not lapsed — ${since} weeks vs usual ${interval}`, `Within ${LAPSE_FACTOR}× of this customer’s own interval.`);
      sim.emit("notready", "stopped", "Not ready — no contact", "Later eligibility check at the next weekly scan.");
      sim.patch("eligibility", { status: "Excluded — not lapsed", tone: "muted", fields: [{ label: "Decision", value: "No message; re-check next week" }] });
      return sim.finish("stopped", { kind: "exception", summary: `${c.first} last visited ${since} weeks ago against a usual ${interval}-week rhythm, which is not an unusual gap. No message was prepared.` }).done();
    }
    sim.emit("detect", "passed", `Unusual lapse — ${since} weeks vs usual ${interval}`, `${ratio.toFixed(1)}× their own interval.`);

    // 2. Eligibility and complaints
    sim.emit("eligibility", "started", "Checking permission, complaints and contact history");
    if (optedOut) {
      sim.emit("check_permission", "blocked", "Opted out — excluded from all campaigns", "Suppression list match. No message is prepared.");
      sim.emit("optout", "stopped", "Opt-out on file — no contact");
      sim.patch("eligibility", { status: "Excluded — opted out", tone: "bad", fields: [{ label: "Decision", value: "Suppressed: opted out of promotions", tone: "bad" }] });
      sim.send({ channel: "sms", to: c.phone, summary: "Win-back invitation (suppressed: opted out)", status: "suppressed" });
      return sim.finish("stopped", { kind: "stopped", summary: `${c.first} is lapsed but opted out of promotions, so the campaign excluded them and nothing was queued.` }).done();
    }
    sim.emit("check_permission", "passed", "Promotional permission on file");

    if (complaint.startsWith("Open")) {
      sim.emit("check_permission", "blocked", "Open complaint — promotion suppressed", "Unresolved complaints are handled by a person before any offer.");
      sim.emit("complaint", "info", "Open complaint routed to staff");
      sim.patch("eligibility", { status: "Excluded — open complaint", tone: "bad", fields: [{ label: "Decision", value: "No promotion; complaint follow-up task instead", tone: "bad" }] });
      sim.send({ channel: "sms", to: c.phone, summary: "Win-back invitation (suppressed: open complaint)", status: "suppressed" });
      staffTask(sim, "complaint", `Unresolved complaint about last ${c.service.toLowerCase()} — call before any promotion`);
      sim.s.step = "awaiting_complaint_task";
      return sim
        .wait("waiting_staff", [
          { id: "staff_resolved", label: "Staff: call customer and resolve complaint", actor: "staff", tone: "primary" },
          { id: "staff_no_answer", label: "Staff: log call — no answer, keep task open", actor: "staff" },
        ])
        .done();
    }
    if (complaint === "Resolved") sim.emit("check_permission", "passed", "Previous complaint resolved", "Resolved complaints do not block an invitation.");
    else sim.emit("check_permission", "passed", "No complaint on file");

    if (recent >= FREQUENCY_CAP) {
      sim.emit("check_permission", "blocked", `Frequency cap reached — ${recent} contacts in 30 days`, `Cap is ${FREQUENCY_CAP} promotional contacts per 30 days across campaigns.`);
      sim.emit("notready", "stopped", "Deferred — later eligibility check in 14 days", "Re-checked when the contact window clears.");
      sim.patch("eligibility", { status: "Deferred — frequency cap", tone: "warn", fields: [{ label: "Decision", value: `Deferred: ${recent} of ${FREQUENCY_CAP} contacts already used`, tone: "warn" }] });
      sim.send({ channel: "sms", to: c.phone, summary: "Win-back invitation (deferred: frequency cap)", status: "suppressed" });
      return sim.finish("stopped", { kind: "exception", summary: `${c.first} is eligible but already received ${recent} promotional messages this month. The invitation was deferred rather than exceeding the cap.` }).done();
    }
    sim.emit("check_permission", "passed", `Frequency cap ok — ${recent} of ${FREQUENCY_CAP} used`);
    sim.emit("eligibility", "passed", "Eligible for win-back");
    sim.patch("eligibility", { status: "Eligible", tone: "ok", fields: [{ label: "Decision", value: "Eligible for an approved invitation", tone: "ok" }] });

    // 3. Choose approved invitation
    const offer = APPROVED_OFFERS[c.service];
    sim.s.offerCode = offer.code;
    sim.emit("offer", "started", "Choosing invitation for last service", c.service);
    sim.emit("check_offer", "passed", `Approved offer ${offer.code}`, `${offer.text}. ${offer.limit}. The assistant cannot create or change discounts.`);
    sim.record({
      id: "campaign",
      title: "Win-back campaign",
      ref: `WB-${c.id.slice(2)}`,
      status: "Invitation ready",
      fields: [
        { label: "Customer", value: `${c.name} (${c.id})` },
        { label: "Offer", value: `${offer.code} — ${offer.text}` },
        { label: "Offer rules", value: offer.limit },
        { label: "Messages this campaign", value: `0 of ${MAX_MESSAGES}` },
      ],
    });
    sim.emit("offer", "passed", "Invitation prepared from approved template");

    // 4. Send and wait for reply
    sendMessage(sim, "invitation");
    return sim.wait("waiting_customer", replyActions(sim)).done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;
    if (s.step === "done") return sim.done();

    switch (actionId) {
      case "interested":
        return handleInterested(sim, "Oh yes, I’ve been meaning to book. What have you got?").done();
      case "unhappy":
        return handleUnhappy(sim, "Honestly the last colour faded in two weeks, so I went elsewhere.").done();
      case "not_interested":
        return handleNotInterested(sim, "Not right now, thanks.").done();
      case "opt_out":
        return handleOptOut(sim, "STOP").done();

      case "free": {
        const text = (payload ?? "").trim();
        const t = text.toLowerCase();
        if (!t) return sim.done();
        if (/\b(stop|unsubscribe|opt out|remove me)\b/.test(t)) return handleOptOut(sim, text).done();
        if (/(unhappy|disappoint|terrible|awful|faded|complain|refund|rude|bad)/.test(t)) return handleUnhappy(sim, text).done();
        if (/\b(no|not|nah|busy|later)\b/.test(t)) return handleNotInterested(sim, text).done();
        if (/\b(yes|yep|sure|book|keen|interested|love|please)\b/.test(t)) return handleInterested(sim, text).done();
        sim.advance(1 * HOUR);
        sim.say("customer", text);
        s.unclear += 1;
        if (s.unclear === 1) {
          sim.emit("reply", "info", "Reply not understood — asking to clarify", "No action is taken on an unclear reply.");
          sim.say("assistant", "Thanks for getting back to us! Would you like to book a visit, or is there something we should know first?");
          return sim.wait("waiting_customer", replyActions(sim)).done();
        }
        sim.emit("reply", "info", "Still unclear — handed to staff", "The assistant does not guess.");
        sim.say("assistant", "Thanks — I’ll ask one of the team to reply to you directly.");
        staffTask(sim, "recovery", `Unclear reply to win-back invitation: “${text.slice(0, 60)}” — reply personally`);
        s.step = "awaiting_recovery_task";
        return sim
          .wait("waiting_staff", [
            { id: "staff_recovered", label: "Staff: reply personally and book", actor: "staff", tone: "primary" },
            { id: "staff_no_answer", label: "Staff: no answer, keep task open", actor: "staff" },
          ])
          .done();
      }

      case "wait": {
        sim.advance(7 * DAY);
        sim.emit("reply", "info", "No reply within 7 days");
        if (s.messages >= MAX_MESSAGES) {
          sim.emit("notready", "stopped", `No reply after ${MAX_MESSAGES} messages — contact limit`, "Later eligibility check in 90 days.");
          sim.patch("campaign", { status: "Closed — no reply", tone: "muted", fields: [{ label: "Next eligibility check", value: "In 90 days" }] });
          endSequence(sim, "no reply at contact limit");
          return sim.finish("stopped", { kind: "exception", summary: `No reply to ${MAX_MESSAGES} messages. The campaign stopped at its contact limit and the customer returns to the lapse scan later.` }).done();
        }
        sendMessage(sim, "reminder");
        return sim.wait("waiting_customer", replyActions(sim)).done();
      }

      case "book_first":
        return book(sim, SLOTS[0]).done();
      case "book_second":
        return book(sim, SLOTS[1]).done();

      case "staff_resolved": {
        sim.advance(4 * HOUR);
        sim.say("staff", `Jess (salon manager): Called ${customer(sim).first}, apologised and booked a complimentary correction visit.`);
        const key = `${s.customerId}:recovery-booking`;
        if (sim.claim(key, "book", "recovery booking")) {
          const ref = sim.ref("BK");
          sim.send({ channel: "calendar", to: "Salon booking system (sample)", summary: `Correction visit (service recovery) — ${ref}`, status: "simulated", opKey: key });
          sim.emit("complaint", "passed", "Service recovery by staff", "Handled by a person; no promotional offer used.");
          sim.emit("book", "confirmed", `Service recovery booked — ${ref}`, undefined, { opKey: key, ref });
          sim.patch("task", { status: "Completed — complaint resolved", tone: "ok", fields: [{ label: "Result", value: `Recovery booking ${ref}`, tone: "ok" }] });
        }
        sim.emit("record", "confirmed", "Outcome recorded: complaint resolved by staff");
        endSequence(sim, "complaint handled by staff");
        return sim.finish("completed", { kind: "exception", summary: "The promotion was suppressed because of the open complaint. Staff resolved it personally and booked a recovery visit." }).done();
      }

      case "staff_recovered": {
        sim.advance(4 * HOUR);
        sim.say("staff", "Jess (salon manager): Spoke to the customer, sorted it out and booked a redo at no charge.");
        const key = `${s.customerId}:recovery-booking`;
        if (sim.claim(key, "book", "recovery booking")) {
          const ref = sim.ref("BK");
          sim.send({ channel: "calendar", to: "Salon booking system (sample)", summary: `Redo appointment (service recovery) — ${ref}`, status: "simulated", opKey: key });
          sim.emit("book", "confirmed", `Service recovery booked — ${ref}`, undefined, { opKey: key, ref });
          sim.patch("task", { status: "Completed — recovered", tone: "ok", fields: [{ label: "Result", value: `Recovery booking ${ref}`, tone: "ok" }] });
        }
        sim.patch("campaign", { status: "Closed — staff recovery", tone: "ok" });
        sim.emit("record", "confirmed", "Outcome recorded: staff recovery");
        endSequence(sim, "handed to staff");
        return sim.finish("completed", { kind: "exception", summary: "The reply needed a person, so a staff task was created and the promotion stopped. Staff recovered the customer with a booked redo." }).done();
      }

      case "staff_no_answer": {
        sim.advance(1 * DAY);
        sim.say("staff", "Jess (salon manager): No answer. Left a voicemail; task stays open.");
        sim.patch("task", { status: "Open — awaiting callback", tone: "warn" });
        sim.emit("record", "info", "Outcome recorded: staff task still open", "No promotion will be sent while it is open.");
        endSequence(sim, "open staff task");
        return sim.finish("stopped", { kind: "exception", summary: "The staff task remains open, so the customer receives no promotional messages until it is resolved." }).done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const customerWinBack: Product = {
  id: "customer-win-back",
  no: 12,
  slug: "customer-win-back",
  name: "Customer Win-back",
  outcome: "Reconnect with customers who stopped returning.",
  sectorLabel: "Local repeat purchase businesses",
  sectors: ["Appointments", "Local orders"],
  outcomes: ["Grow repeat business"],
  definition:
    "Identifies customers whose gap since their last visit is unusual compared with their own history, then sends a relevant, owner-approved invitation. Unresolved complaints, opted-out contacts and customers already contacted too often are excluded before anything is prepared.",
  situation:
    "A salon regular who normally comes in every six weeks has not returned for four months. Another lapsed customer has an unresolved complaint about her last colour and should hear from the manager, not receive a discount text.",
  endState:
    "Lapsed regulars get one relevant invitation and can book straight away, while complaints go to a person and opted-out customers are never contacted. The owner sees who came back and why each customer was included or excluded.",
  handles: [
    "Calculates lapse against each customer’s own visit interval",
    "Explains why every customer is eligible, deferred or excluded",
    "Sends only offers from the owner’s approved list",
    "Interprets replies: books interested customers, routes unhappy ones to staff",
    "Ends the sequence on booking, opt-out, no reply or staff takeover",
  ],
  boundaries: [
    "Never sends a promotion to a customer with an open complaint",
    "Never invents discounts or changes offer terms",
    "Never contacts opted-out customers or exceeds the contact frequency cap",
  ],
  delivered: [
    { title: "Reactivation booking", body: "Confirmed return visit with booking reference, service, slot and the approved offer applied." },
    { title: "Staff follow-up task", body: "Complaint or unhappy-reply task assigned to a named person with the reason, and promotion suppressed until it closes." },
    { title: "Eligibility and campaign record", body: "Lapse calculation, exclusions checked, messages sent against the limit and the closing reason in shared contact history." },
  ],
  deployment: {
    rules: [
      "Lapse thresholds per service and customer history",
      "Approved invitations and discount limits",
      "Complaint, opt-out and frequency-cap exclusions shared across campaigns",
      "Who handles complaints and unhappy replies",
      "Holdout group size for measuring incremental return visits",
    ],
    systems: ["Customer purchase and visit history", "Complaints log", "Your booking system", "SMS or email with consent records"],
  },
  measures: [
    "Incremental completed return visits, estimated against a holdout group that receives no invitation in a real pilot",
    "Contribution from returning customers net of discounts",
    "Complaints resolved before any promotion",
  ],
  reliability: [
    "Promotions sent to customers with open complaints (target: zero)",
    "Messages sent after opt-out or above the frequency cap (target: zero)",
    "Reminders sent after a booking (target: zero)",
  ],
  harness: {
    systems:
      "Production uses customer purchase history, the complaints log, the booking system and an eligible messaging channel. The demo uses five fictional salon customers, a sample calendar and an outbox that holds every message.",
    controls: [
      "Consent and suppression checks before any message is prepared",
      "Contact frequency cap shared across all campaigns",
      "Only owner-approved discounts and invitation templates",
      "Complaints and unhappy replies handled by a person",
      "Cross-campaign coordination through shared contact history",
    ],
  },
  ctaLine: "Want this finding the lapsed customers in your own booking system?",
  graph: {
    nodes: [
      { id: "detect", kind: "action", row: 0, title: "Detect unusual lapse", input: "Visit history per customer", rule: `Lapse if weeks since last visit > ${LAPSE_FACTOR}× their own usual interval`, output: "Lapse calculation", failure: "Within normal rhythm → not ready", system: "Customer history (demo: fixture)" },
      { id: "eligibility", kind: "action", row: 1, title: "Check eligibility and complaints", input: "Lapsed customer", rule: "Permission, open complaints, frequency cap", output: "Eligible / excluded / deferred with reason", failure: "Open complaint → staff task; opt-out → stop", system: "Complaints log + suppression list (demo: fixture)" },
      { id: "offer", kind: "action", row: 2, title: "Choose relevant approved invitation", input: "Eligible customer + last service", rule: "Pick from approved offer list only", output: "Invitation with offer code", failure: "No approved offer → no message", system: "Offer library (demo: fixture)" },
      { id: "reply", kind: "action", row: 3, title: "Send and interpret reply", input: "Invitation + customer reply", rule: `Max ${MAX_MESSAGES} messages, 7 days apart; classify interested / unhappy / not interested / stop`, output: "Classified reply", failure: "Unclear twice → staff", system: "SMS (demo: held outbox)" },
      { id: "book", kind: "action", row: 4, title: "Book return or assign recovery", input: "Interested reply or complaint", rule: "Calendar write for bookings; staff task for recovery", output: "Booking reference or staff task", failure: "Staff no answer → task stays open", system: "Booking system + tasks (demo: simulated)" },
      { id: "record", kind: "action", row: 5, title: "Record outcome and stop sequence", input: "Booking, recovery or stop reason", rule: "Any outcome cancels pending reminders", output: "Closed campaign with reason", failure: "—", system: "CRM (demo: simulated write)" },
      { id: "complaint", kind: "branch", row: 1, title: "Open complaint", input: "Unresolved complaint on file", rule: "Suppress promotion; create complaint follow-up task", output: "Staff task", failure: "—" },
      { id: "notready", kind: "branch", row: 2.7, title: "Not ready", input: "Not lapsed, deferred, declined or no reply", rule: "No further messages this cycle", output: "Dated later eligibility check", failure: "—" },
      { id: "optout", kind: "branch", row: 4.2, title: "Opt out", input: "STOP reply or suppression list match", rule: "Stop now and exclude from all later campaigns", output: "Suppression record", failure: "—" },
      { id: "check_permission", kind: "check", row: 0.8, title: "Permission and exclusions", input: "Consent, complaints, recent contacts", rule: `Opted-out and open complaints excluded; max ${FREQUENCY_CAP} promotional contacts per 30 days`, output: "Pass / blocked with reason", failure: "Blocked → no message prepared" },
      { id: "check_offer", kind: "check", row: 2.2, title: "Offer approval", input: "Chosen invitation", rule: "Offer code must exist in the approved list with its limits", output: "Approved offer", failure: "Not approved → blocked" },
      { id: "check_history", kind: "check", row: 4.9, title: "Shared contact history", input: "Campaign outcome", rule: "Write outcome so every campaign sees it; booking ends sequence", output: "Closed sequence entry", failure: "Write fails → hold further contact" },
    ],
    edges: [
      { from: "detect", to: "eligibility", kind: "flow" },
      { from: "eligibility", to: "offer", kind: "flow" },
      { from: "offer", to: "reply", kind: "flow" },
      { from: "reply", to: "book", kind: "flow" },
      { from: "book", to: "record", kind: "flow" },
      { from: "eligibility", to: "complaint", kind: "return" },
      { from: "complaint", to: "book", kind: "return", label: "service recovery" },
      { from: "reply", to: "notready", kind: "return" },
      { from: "notready", to: "detect", kind: "return", label: "later eligible check" },
      { from: "reply", to: "optout", kind: "return" },
      { from: "check_permission", to: "eligibility", kind: "check" },
      { from: "check_offer", to: "offer", kind: "check" },
      { from: "check_history", to: "record", kind: "check" },
    ],
  },
  demo,
};
