import type { DemoAction, DemoDefinition, Product } from "../types";
import { Sim, fmtClock, DAY, HOUR } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

const SALON = "Juniper Hair Studio";
const CLIENT = { name: "Grace Liu", first: "Grace", contact: "grace@liu.example" };
const ORIGINAL = { ref: "BK-2046", label: "Thu 8 Oct 11:00", service: "Cut and colour (90 min)", stylist: "Noah" };
/** Appointment time on the simulation clock (clock 0 = Mon 5 Oct 09:00). */
const APPT_AT = 3 * DAY + 2 * HOUR;
const LATE_WINDOW_HOURS = 24;
const MAX_MESSAGES = 3; // first request + 2 reminders
const MAX_CLARIFY = 2;

const REPLACEMENTS = [
  { id: "tue-13-1100", label: "Tue 13 Oct 11:00" },
  { id: "thu-15-1100", label: "Thu 15 Oct 11:00" },
  { id: "sat-17-1000", label: "Sat 17 Oct 10:00" },
];

const RESPONSES = ["Confirm", "Reschedule", "Cancel", "No reply"];
const REPLACEMENT_OUTCOMES = ["Replacement slot free", "Replacement slot taken", "Calendar write fails"];
const SILENCE_POLICIES = ["Silence never cancels", "Release unconfirmed booking after final reminder"];

type Step = "awaiting_reply" | "choosing_slot" | "policy_review" | "write_failed" | "done";

interface State {
  step: Step;
  messages: number;
  clarifications: number;
  intent: "move" | "cancel" | null;
  chosen: number | null;
  taken: number[];
  takenOnce: boolean;
  writeFailed: boolean;
  newRef: string;
  late: boolean;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function hoursBefore(clock: number): number {
  return Math.round(((APPT_AT - clock) / HOUR) * 10) / 10;
}

function isLate(sim: Sim<State>): boolean {
  return sim.bool("late_window") || APPT_AT - sim.run.clock <= LATE_WINDOW_HOURS * HOUR;
}

function silenceCancels(sim: Sim<State>): boolean {
  return sim.str("silence_policy") === SILENCE_POLICIES[1];
}

function replyActions(sim: Sim<State>): DemoAction[] {
  const s = sim.s;
  const preferred = sim.str("response", "Confirm");
  const tone = (r: string) => (preferred === r ? ("primary" as const) : ("default" as const));
  const acts: DemoAction[] = [
    { id: "reply_confirm", label: "Reply: “Yes, see you Thursday.”", actor: "customer", tone: tone("Confirm") },
    { id: "reply_move", label: "Reply: “Can I move it to next week?”", actor: "customer", tone: tone("Reschedule") },
    { id: "reply_cancel", label: "Reply: “I need to cancel, sorry.”", actor: "customer", tone: preferred === "Cancel" ? "primary" : "danger" },
    { id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. Could we do next Tuesday instead?" } },
  ];
  const wait: DemoAction =
    s.messages < MAX_MESSAGES
      ? { id: "no_reply", label: "Advance clock 24 h (no reply)", actor: "clock", tone: tone("No reply"), hint: `Reminder ${s.messages + 1} of ${MAX_MESSAGES} will be sent.` }
      : { id: "no_reply", label: "Advance clock to 2 h before (no reply)", actor: "clock", tone: tone("No reply"), hint: "Reminder limit reached — the displayed silence policy applies." };
  return preferred === "No reply" ? [wait, ...acts] : [...acts, wait];
}

function slotActions(sim: Sim<State>): DemoAction[] {
  const s = sim.s;
  const acts: DemoAction[] = REPLACEMENTS.map((r, i) => ({ i, r }))
    .filter(({ i }) => !s.taken.includes(i))
    .map(({ r, i }) => ({ id: `pick_${i}`, label: `Choose ${r.label}`, actor: "customer" as const, tone: i === 0 ? ("primary" as const) : ("default" as const) }));
  acts.push({ id: "keep_original", label: "Reply: “Actually, I’ll keep Thursday.”", actor: "customer" });
  return acts;
}

function customerReplyTime(sim: Sim<State>) {
  if (sim.bool("late_window") && APPT_AT - sim.run.clock > 20 * HOUR) {
    sim.advance(APPT_AT - 20 * HOUR - sim.run.clock); // reply lands inside the 24 h window
  } else {
    sim.advance(2 * HOUR);
  }
}

function sendRequest(sim: Sim<State>) {
  const s = sim.s;
  s.messages += 1;
  const key = `${ORIGINAL.ref}:reminder:${s.messages}`;
  if (!sim.claim(key, "request", "reminder")) return;
  const policyLine = silenceCancels(sim)
    ? " Policy: if we don’t hear back after our final reminder, the booking is released."
    : "";
  const text =
    s.messages === 1
      ? `Hi ${CLIENT.first}, a reminder from ${SALON}: ${ORIGINAL.service} with ${ORIGINAL.stylist} on ${ORIGINAL.label}. Reply YES to confirm, MOVE to change the time or CANCEL.${policyLine}`
      : `Hi ${CLIENT.first}, just checking you’re still coming on ${ORIGINAL.label}. Reply YES, MOVE or CANCEL.${policyLine} (Reminder ${s.messages} of ${MAX_MESSAGES})`;
  sim.say("assistant", text);
  sim.send({ channel: "sms", to: CLIENT.name, summary: s.messages === 1 ? "Confirmation request" : `Reminder ${s.messages} of ${MAX_MESSAGES}`, status: "held", opKey: key });
  sim.emit("request", "waiting", s.messages === 1 ? "Confirmation request sent" : `Reminder ${s.messages} of ${MAX_MESSAGES} sent`, "Held in the demo outbox.", { opKey: key });
  sim.patch("booking", { fields: [{ label: "Messages sent", value: `${s.messages} of ${MAX_MESSAGES}` }] });
  s.step = "awaiting_reply";
  sim.wait("waiting_customer", replyActions(sim));
}

function checkBooking(sim: Sim<State>) {
  sim.emit("booking", "started", `Checking ${ORIGINAL.ref} is still current`);
  sim.emit("check_current", "passed", `${ORIGINAL.ref} active: ${ORIGINAL.label}`, `${hoursBefore(sim.run.clock)} h before the appointment. Calendar fixture read-back.`);
  sim.emit("booking", "passed", "Current booking verified");
}

function passToWaitlist(sim: Sim<State>, why: string) {
  const key = `waitlist:${ORIGINAL.ref}`;
  if (!sim.claim(key, "update", "waitlist event")) return;
  sim.send({ channel: "task", to: "Waitlist Manager workflow", summary: `slot.released — ${ORIGINAL.label}, ${ORIGINAL.service} with ${ORIGINAL.stylist} (${why})`, status: "simulated", opKey: key });
  sim.emit("update", "info", "Cancellation event passed to the waitlist workflow", `Released slot ${ORIGINAL.label} queued for refilling.`, { opKey: key });
}

function lateReview(sim: Sim<State>) {
  const s = sim.s;
  const what = s.intent === "move" ? `move to ${REPLACEMENTS[s.chosen ?? 0].label}` : "cancellation";
  sim.emit("check_policy", "failed", `Inside the ${LATE_WINDOW_HOURS} h late-cancellation window`, `${hoursBefore(sim.run.clock)} h before the appointment. Automatic change not allowed.`);
  sim.emit("late_cancel", "waiting", "Late request routed to policy review", `Staff decide on the ${what}. No fee is charged by this workflow.`);
  sim.send({ channel: "task", to: "Salon manager", summary: `Policy review: late ${what} for ${ORIGINAL.ref}`, status: "simulated" });
  sim.say("assistant", `Thanks ${CLIENT.first} — as it’s within ${LATE_WINDOW_HOURS} hours of your appointment, a member of the team will check this with you shortly. Your booking stays in place until then.`);
  sim.patch("booking", { status: "Booked — late request under review", tone: "warn" });
  s.step = "policy_review";
  sim.wait("waiting_staff", [
    { id: "staff_approve", label: `Staff: approve the ${s.intent === "move" ? "move" : "cancellation"} (no fee)`, actor: "staff", tone: "primary" },
    { id: "staff_keep", label: "Staff: keep the booking and call the client", actor: "staff" },
  ]);
}

function performCancel(sim: Sim<State>, reason: string) {
  const s = sim.s;
  const key = `cancel:${ORIGINAL.ref}`;
  if (!sim.claim(key, "update", "cancellation")) return;
  sim.emit("update", "started", `Cancelling ${ORIGINAL.ref}`);
  sim.send({ channel: "calendar", to: `${SALON} calendar`, summary: `Cancel ${ORIGINAL.ref} (${ORIGINAL.label})`, status: "simulated", opKey: key });
  sim.emit("check_calendar", "passed", `Calendar read-back: ${ORIGINAL.ref} cancelled`);
  sim.emit("update", "confirmed", `${ORIGINAL.ref} cancelled in the calendar`, reason, { opKey: key });
  passToWaitlist(sim, "cancellation");
  sim.patch("booking", { status: "Cancelled — slot passed to waitlist", tone: "bad", fields: [{ label: "Cancellation fee", value: "None charged (the demo never charges fees)", tone: "muted" }] });
  s.step = "done";
}

function attemptMove(sim: Sim<State>) {
  const s = sim.s;
  const idx = s.chosen ?? 0;
  const slot = REPLACEMENTS[idx];
  const outcome = sim.str("replacement", REPLACEMENT_OUTCOMES[0]);

  sim.emit("confirm_change", "started", `Securing ${slot.label} before releasing ${ORIGINAL.label}`);
  // Slot check: the replacement must be held first.
  if (outcome === REPLACEMENT_OUTCOMES[1] && !s.takenOnce) {
    s.takenOnce = true;
    s.taken.push(idx);
    sim.emit("check_policy", "failed", `Slot check: ${slot.label} was just taken`, "Another client booked it moments ago (fixture).");
    keepOriginalAfterFailure(sim, `${slot.label} was taken before it could be held`);
    s.step = "choosing_slot";
    sim.say("assistant", `Sorry ${CLIENT.first}, ${slot.label} has just been taken. Your ${ORIGINAL.label} booking is still in place. Would another time suit?`);
    sim.wait("waiting_customer", slotActions(sim));
    return;
  }
  const holdKey = `hold:${slot.id}:${s.writeFailed ? "retry" : "first"}`;
  sim.claim(holdKey, "confirm_change", "replacement hold");
  sim.emit("check_policy", "passed", `Slot check: ${slot.label} held for ${CLIENT.first}`, undefined, { opKey: holdKey });
  sim.emit("confirm_change", "passed", "Replacement secured — original still booked");

  // Write the replacement booking, verify, then release the original.
  sim.emit("update", "started", `Writing new booking for ${slot.label}`);
  if (outcome === REPLACEMENT_OUTCOMES[2] && !s.writeFailed) {
    s.writeFailed = true;
    sim.send({ channel: "calendar", to: `${SALON} calendar`, summary: `Create booking ${slot.label} — connector timeout`, status: "failed" });
    sim.emit("update", "failed", "Calendar write failed — replacement not confirmed", "Timeout from the calendar adapter. The hold is released; nothing is sent to the client as confirmed.");
    sim.emit("check_calendar", "failed", "No verified replacement booking");
    keepOriginalAfterFailure(sim, "calendar write for the replacement failed");
    sim.say("assistant", `Sorry ${CLIENT.first}, we couldn’t confirm ${slot.label} just now. Your ${ORIGINAL.label} booking is unchanged — we’ll be in touch shortly.`);
    s.step = "write_failed";
    sim.wait("waiting_staff", [
      { id: "retry_write", label: "Staff: retry the calendar write", actor: "staff", tone: "primary", hint: "Same operation key — cannot create a second booking." },
      { id: "keep_original_staff", label: "Staff: keep the original booking", actor: "staff" },
    ]);
    return;
  }
  const writeKey = `book:${slot.id}:${CLIENT.contact}`;
  if (!sim.claim(writeKey, "update", "replacement booking")) return;
  s.newRef = sim.ref("BK");
  sim.send({ channel: "calendar", to: `${SALON} calendar`, summary: `Create ${s.newRef} — ${slot.label}, ${ORIGINAL.service} with ${ORIGINAL.stylist}`, status: "simulated", opKey: writeKey });
  sim.emit("check_calendar", "passed", `Calendar read-back: ${s.newRef} exists for ${slot.label}`, undefined, { ref: s.newRef });
  sim.emit("update", "confirmed", `Replacement ${s.newRef} verified`, undefined, { opKey: writeKey, ref: s.newRef });
  const relKey = `release:${ORIGINAL.ref}`;
  sim.claim(relKey, "update", "release");
  sim.send({ channel: "calendar", to: `${SALON} calendar`, summary: `Release ${ORIGINAL.ref} (${ORIGINAL.label})`, status: "simulated", opKey: relKey });
  sim.emit("update", "confirmed", `Original ${ORIGINAL.ref} released after the replacement was verified`, undefined, { opKey: relKey });
  passToWaitlist(sim, "moved by client");
  const nKey = `notify:${s.newRef}`;
  sim.claim(nKey, "update", "notification");
  sim.send({ channel: "sms", to: CLIENT.name, summary: `Moved: ${s.newRef} on ${slot.label}`, status: "held", opKey: nKey });
  sim.say("assistant", `Done — you’re now booked for ${slot.label} with ${ORIGINAL.stylist} (${s.newRef}). Your Thursday appointment has been released.`);
  sim.record({
    id: "new_booking",
    title: "Replacement booking",
    ref: s.newRef,
    status: "Booked — verified in calendar",
    tone: "ok",
    fields: [
      { label: "When", value: slot.label },
      { label: "Service", value: `${ORIGINAL.service} with ${ORIGINAL.stylist}` },
      { label: "Replaces", value: ORIGINAL.ref },
    ],
  });
  sim.patch("booking", { status: `Released — moved to ${s.newRef}`, tone: "muted", fields: [{ label: "Cancellation fee", value: "None charged", tone: "muted" }] });
  s.step = "done";
  sim.finish("completed", {
    kind: "success",
    summary: `${CLIENT.name} moved to ${slot.label} (${s.newRef}). The replacement was held and verified before ${ORIGINAL.ref} was released, and the freed slot was passed to the waitlist.`,
  });
}

function keepOriginalAfterFailure(sim: Sim<State>, why: string) {
  sim.emit("replacement_fails", "info", "Replacement failed — original booking kept", why);
  sim.patch("booking", { status: "Booked — original kept", tone: "ok", fields: [{ label: "Last change attempt", value: `Failed: ${why}`, tone: "warn" }] });
}

function confirmAttendance(sim: Sim<State>) {
  const s = sim.s;
  const key = `confirm:${ORIGINAL.ref}`;
  if (!sim.claim(key, "update", "confirmation")) return;
  sim.emit("handle", "passed", "Reply classified: confirmed");
  sim.emit("update", "started", `Marking ${ORIGINAL.ref} confirmed`);
  sim.send({ channel: "calendar", to: `${SALON} calendar`, summary: `Set ${ORIGINAL.ref} status: confirmed`, status: "simulated", opKey: key });
  sim.emit("check_calendar", "passed", `Calendar read-back: ${ORIGINAL.ref} confirmed`);
  sim.emit("update", "confirmed", `${ORIGINAL.ref} confirmed for ${ORIGINAL.label}`, undefined, { opKey: key, ref: ORIGINAL.ref });
  sim.say("assistant", `Lovely, thanks ${CLIENT.first} — see you ${ORIGINAL.label}.`);
  sim.patch("booking", { status: "Confirmed by client", tone: "ok" });
  s.step = "done";
  sim.finish("completed", { kind: "success", summary: `${CLIENT.name} confirmed ${ORIGINAL.ref}; the calendar shows it as confirmed after a verified write. No further reminders are needed.` });
}

function startMove(sim: Sim<State>) {
  const s = sim.s;
  s.intent = "move";
  sim.emit("handle", "passed", "Reply classified: reschedule request");
  sim.say("assistant", `No problem. ${ORIGINAL.stylist} has these times next week: ${REPLACEMENTS.map((r) => r.label).join(", ")}. Which would suit? Your Thursday booking stays in place until the new one is confirmed.`);
  sim.send({ channel: "sms", to: CLIENT.name, summary: "Replacement options (3)", status: "held" });
  s.step = "choosing_slot";
  sim.wait("waiting_customer", slotActions(sim));
}

function startCancel(sim: Sim<State>) {
  const s = sim.s;
  s.intent = "cancel";
  sim.emit("handle", "passed", "Reply classified: cancellation request");
  sim.emit("confirm_change", "started", "Checking the cancellation policy");
  if (isLate(sim)) {
    s.late = true;
    lateReview(sim);
    return;
  }
  sim.emit("check_policy", "passed", `Outside the ${LATE_WINDOW_HOURS} h window — cancellation allowed`, `${hoursBefore(sim.run.clock)} h before. No fee applies.`);
  sim.emit("confirm_change", "passed", "Cancellation allowed by policy");
  performCancel(sim, "Requested by the client outside the late window.");
  sim.say("assistant", `All done, ${CLIENT.first} — your ${ORIGINAL.label} appointment is cancelled. No fee applies. We hope to see you soon.`);
  sim.send({ channel: "sms", to: CLIENT.name, summary: "Cancellation confirmation", status: "held" });
  sim.finish("completed", { kind: "exception", summary: `${ORIGINAL.ref} was cancelled outside the late window after a verified calendar write, and the freed slot was passed to the waitlist workflow. No fee was charged.` });
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Interactive simulation using a sample salon calendar. No messages are sent, no real appointment is changed and no cancellation fee is charged.",
  assistantName: "Appointment assistant",
  channelLabel: "SMS thread with the client",
  fields: [
    { kind: "select", name: "response", label: "Client’s reply", options: RESPONSES, helper: "Highlights the matching reply; you can still choose any reply." },
    { kind: "toggle", name: "late_window", label: "Request falls inside the 24 h late-cancellation window" },
    { kind: "select", name: "replacement", label: "Replacement booking", options: REPLACEMENT_OUTCOMES, helper: "Makes the first replacement attempt fail in the chosen way." },
    { kind: "select", name: "silence_policy", label: "Displayed no-reply policy", options: SILENCE_POLICIES },
  ],
  scenarios: [
    { id: "confirmed", label: "Confirmed", kind: "success", description: "The client confirms Thursday’s cut and colour.", inputs: { response: "Confirm", late_window: false, replacement: REPLACEMENT_OUTCOMES[0], silence_policy: SILENCE_POLICIES[0] } },
    { id: "reschedule", label: "Reschedule", kind: "success", description: "The client moves to next week. The new slot is secured before the old one is released.", inputs: { response: "Reschedule", late_window: false, replacement: REPLACEMENT_OUTCOMES[0], silence_policy: SILENCE_POLICIES[0] } },
    { id: "replacement_fails", label: "Replacement fails", kind: "exception", description: "The chosen slot is taken moments before it can be held. The original booking is kept.", inputs: { response: "Reschedule", late_window: false, replacement: REPLACEMENT_OUTCOMES[1], silence_policy: SILENCE_POLICIES[0] } },
    { id: "write_fails", label: "Calendar write fails", kind: "exception", description: "The calendar times out while writing the replacement. Nothing is confirmed and the original stays.", inputs: { response: "Reschedule", late_window: false, replacement: REPLACEMENT_OUTCOMES[2], silence_policy: SILENCE_POLICIES[0] } },
    { id: "cancel", label: "Cancel", kind: "exception", description: "The client cancels two days ahead. The slot goes to the waitlist workflow; no fee.", inputs: { response: "Cancel", late_window: false, replacement: REPLACEMENT_OUTCOMES[0], silence_policy: SILENCE_POLICIES[0] } },
    { id: "late_cancel", label: "Late cancellation", kind: "exception", description: "The client cancels inside the 24-hour window. Staff review the request.", inputs: { response: "Cancel", late_window: true, replacement: REPLACEMENT_OUTCOMES[0], silence_policy: SILENCE_POLICIES[0] } },
    { id: "no_reply", label: "No reply", kind: "exception", description: "Advance the clock: reminders stop at the limit and silence does not cancel the booking.", inputs: { response: "No reply", late_window: false, replacement: REPLACEMENT_OUTCOMES[0], silence_policy: SILENCE_POLICIES[0] } },
  ],

  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("appointment-assistant", scenarioId, inputs, {
      step: "awaiting_reply",
      messages: 0,
      clarifications: 0,
      intent: null,
      chosen: null,
      taken: [],
      takenOnce: false,
      writeFailed: false,
      newRef: "",
      late: false,
    });

    sim.emit("due", "started", "Appointment reminder due", `${ORIGINAL.ref} · ${ORIGINAL.label} · ${fmtClock(0)}`);
    sim.record({
      id: "booking",
      title: "Current appointment",
      ref: ORIGINAL.ref,
      status: "Booked — awaiting confirmation",
      fields: [
        { label: "Client", value: `${CLIENT.name} (${CLIENT.contact})` },
        { label: "When", value: ORIGINAL.label },
        { label: "Service", value: `${ORIGINAL.service} with ${ORIGINAL.stylist}` },
        { label: "Messages sent", value: `0 of ${MAX_MESSAGES}` },
      ],
    });
    sim.record({
      id: "policy",
      title: "Displayed policy",
      status: silenceCancels(sim) ? "Silence releases the booking after the final reminder" : "Silence never cancels",
      tone: "muted",
      fields: [
        { label: "Late-change window", value: `${LATE_WINDOW_HOURS} h before the appointment — staff review` },
        { label: "Late fee", value: "Staff decision only; this demo never charges a fee" },
        { label: "Reminders", value: `Up to ${MAX_MESSAGES} messages, 24 h apart` },
        { label: "No reply", value: silenceCancels(sim) ? "Released after the final reminder (stated in every message)" : "Booking kept; staff call the client" },
      ],
    });
    sim.emit("due", "passed", "Reminder window reached (72 h before)");
    checkBooking(sim);
    sendRequest(sim);
    return sim.done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;
    if (s.step === "done") return sim.done();

    // Slot picks
    const pick = /^pick_(\d)$/.exec(actionId);
    if (pick) {
      if (s.step !== "choosing_slot") return sim.done();
      const idx = Number(pick[1]);
      if (!REPLACEMENTS[idx] || s.taken.includes(idx)) return sim.done();
      s.chosen = idx;
      sim.advance(10);
      sim.say("customer", `${REPLACEMENTS[idx].label} please.`);
      sim.emit("handle", "passed", `Client chose ${REPLACEMENTS[idx].label}`);
      sim.emit("confirm_change", "started", "Checking the change policy");
      if (isLate(sim) && !s.late) {
        s.late = true;
        lateReview(sim);
        return sim.done();
      }
      if (!s.late) sim.emit("check_policy", "passed", `Outside the ${LATE_WINDOW_HOURS} h window — move allowed`, `${hoursBefore(sim.run.clock)} h before.`);
      attemptMove(sim);
      return sim.done();
    }

    switch (actionId) {
      case "reply_confirm": {
        if (s.step !== "awaiting_reply") return sim.done();
        customerReplyTime(sim);
        sim.say("customer", "Yes, see you Thursday.");
        confirmAttendance(sim);
        return sim.done();
      }
      case "reply_move": {
        if (s.step !== "awaiting_reply") return sim.done();
        customerReplyTime(sim);
        sim.say("customer", "Can I move it to next week?");
        startMove(sim);
        return sim.done();
      }
      case "reply_cancel": {
        if (s.step !== "awaiting_reply") return sim.done();
        customerReplyTime(sim);
        sim.say("customer", "I need to cancel, sorry.");
        startCancel(sim);
        return sim.done();
      }
      case "free": {
        if (s.step !== "awaiting_reply") return sim.done();
        customerReplyTime(sim);
        const text = (payload ?? "").trim();
        sim.say("customer", text || "(empty message)");
        const t = text.toLowerCase();
        if (/\bstop\b|unsubscribe/.test(t)) {
          sim.emit("handle", "stopped", "Client asked to stop messages", "Reminders stop. The booking itself is not cancelled.");
          sim.send({ channel: "task", to: "Front desk", summary: `Client opted out of reminders — confirm ${ORIGINAL.ref} by phone`, status: "simulated" });
          sim.say("assistant", "Understood — no more reminders. Your booking is unchanged.");
          sim.patch("booking", { status: "Booked — reminders stopped by client", tone: "warn" });
          s.step = "done";
          return sim.finish("stopped", { kind: "stopped", summary: "The client opted out of reminders. The booking was kept and the front desk was asked to confirm by phone." }).done();
        }
        if (/cancel/.test(t)) {
          startCancel(sim);
          return sim.done();
        }
        if (/(move|resched|change|another|different|next week|later|earlier|monday|tuesday|wednesday|thursday|friday|saturday)/.test(t) && !/^(yes|yep|confirm)/.test(t)) {
          startMove(sim);
          return sim.done();
        }
        if (/^(yes|yep|yeah|confirm|confirmed|ok|okay|see you|sounds good|all good)\b/.test(t)) {
          confirmAttendance(sim);
          return sim.done();
        }
        s.clarifications += 1;
        if (s.clarifications > MAX_CLARIFY) {
          sim.emit("handle", "stopped", "Reply still unclear — handed to staff", "The assistant does not guess what the client meant.");
          sim.send({ channel: "task", to: "Front desk", summary: `Unclear replies about ${ORIGINAL.ref} — please call ${CLIENT.first}`, status: "simulated" });
          sim.say("assistant", "Thanks — someone from the salon will give you a quick call to sort this out.");
          sim.patch("booking", { status: "Booked — handed to staff", tone: "warn" });
          s.step = "done";
          return sim.finish("stopped", { kind: "exception", summary: "The client’s replies could not be classified, so the conversation was handed to the front desk. The booking was not changed." }).done();
        }
        sim.emit("handle", "info", "Reply not understood — clarifying question asked", `Attempt ${s.clarifications} of ${MAX_CLARIFY}.`);
        sim.say("assistant", `Sorry, I didn’t catch that. Reply YES to confirm ${ORIGINAL.label}, MOVE to change the time, or CANCEL.`);
        return sim.wait("waiting_customer", replyActions(sim)).done();
      }

      case "no_reply": {
        if (s.step !== "awaiting_reply") return sim.done();
        sim.advance(DAY);
        if (s.messages < MAX_MESSAGES) {
          sim.emit("no_reply", "info", `No reply — limited reminder ${s.messages + 1} of ${MAX_MESSAGES}`);
          checkBooking(sim);
          sendRequest(sim);
          return sim.done();
        }
        sim.emit("no_reply", "stopped", `No reply after ${MAX_MESSAGES} messages — reminders stopped`);
        if (silenceCancels(sim)) {
          sim.emit("check_policy", "passed", "Displayed policy releases unconfirmed bookings", "The policy was stated in every message sent.");
          performCancel(sim, "Released under the displayed no-reply policy.");
          sim.patch("booking", { status: "Released under displayed policy — slot passed to waitlist" });
          sim.send({ channel: "sms", to: CLIENT.name, summary: "Booking released notice (per displayed policy)", status: "held" });
          return sim.finish("stopped", { kind: "exception", summary: `No reply after ${MAX_MESSAGES} messages. Because the displayed policy expressly says so, ${ORIGINAL.ref} was released and passed to the waitlist. No fee was charged.` }).done();
        }
        sim.emit("check_policy", "info", "Displayed policy: silence never cancels", `${ORIGINAL.ref} stays booked.`);
        sim.send({ channel: "task", to: "Front desk", summary: `Call ${CLIENT.name} — ${ORIGINAL.ref} unconfirmed`, status: "simulated" });
        sim.patch("booking", { status: "Booked — unconfirmed, kept", tone: "warn" });
        s.step = "done";
        return sim.finish("stopped", { kind: "exception", summary: `No reply after ${MAX_MESSAGES} messages, so reminders stopped at the limit. ${ORIGINAL.ref} was kept because silence never cancels under the displayed policy; the front desk will call.` }).done();
      }

      case "keep_original": {
        if (s.step !== "choosing_slot") return sim.done();
        sim.advance(10);
        sim.say("customer", "Actually, I’ll keep Thursday.");
        s.intent = null;
        confirmAttendance(sim);
        return sim.done();
      }

      case "staff_approve": {
        if (s.step !== "policy_review") return sim.done();
        sim.advance(30);
        sim.say("staff", "Manager: That’s fine — approved, no fee.");
        sim.emit("late_cancel", "passed", "Staff approved the late change (no fee)");
        if (s.intent === "cancel") {
          performCancel(sim, "Late cancellation approved by staff.");
          sim.say("assistant", `Your ${ORIGINAL.label} appointment is cancelled, ${CLIENT.first}. No fee applies this time.`);
          sim.send({ channel: "sms", to: CLIENT.name, summary: "Cancellation confirmation (staff approved)", status: "held" });
          return sim.finish("completed", { kind: "exception", summary: `The late cancellation was approved by staff, ${ORIGINAL.ref} was cancelled after a verified write and the slot was passed to the waitlist. No fee was charged.` }).done();
        }
        attemptMove(sim);
        return sim.done();
      }

      case "staff_keep": {
        if (s.step !== "policy_review") return sim.done();
        sim.advance(30);
        sim.say("staff", `Manager: I’ll call ${CLIENT.first}; keep the booking for now.`);
        sim.emit("late_cancel", "stopped", "Staff kept the booking — handed to a person");
        sim.patch("booking", { status: "Booked — kept after policy review", tone: "warn" });
        s.step = "done";
        return sim.finish("stopped", { kind: "exception", summary: `The late request went to policy review and staff chose to keep ${ORIGINAL.ref} and call the client. Nothing was changed automatically and no fee was charged.` }).done();
      }

      case "retry_write": {
        if (s.step !== "write_failed") return sim.done();
        sim.advance(15);
        sim.emit("update", "info", "Retrying the replacement booking (same operation key)");
        attemptMove(sim);
        return sim.done();
      }

      case "keep_original_staff": {
        if (s.step !== "write_failed") return sim.done();
        sim.emit("replacement_fails", "stopped", "Staff kept the original booking");
        sim.patch("booking", { status: "Booked — original kept", tone: "ok" });
        sim.send({ channel: "task", to: "Front desk", summary: `Call ${CLIENT.first} about moving ${ORIGINAL.ref}`, status: "simulated" });
        s.step = "done";
        return sim.finish("stopped", { kind: "exception", summary: `The replacement could not be written, so ${ORIGINAL.ref} was kept unchanged and the front desk will follow up.` }).done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const appointmentAssistant: Product = {
  id: "appointment-assistant",
  no: 11,
  slug: "appointment-assistant",
  name: "Appointment Assistant",
  outcome: "Confirm visits and handle changes automatically.",
  sectorLabel: "Appointment businesses",
  sectors: ["Appointments"],
  outcomes: ["Fill capacity"],
  definition:
    "It sends appointment reminders, collects confirmations and handles rescheduling or cancellation within the business’s stated policy, keeping the calendar current. A move secures the replacement before the original slot is released, and freed slots are passed on to the waitlist.",
  situation:
    "A salon client receives a reminder for Thursday’s cut and colour and needs to move it to the following week. Staff are with clients all day, so replies wait, the calendar drifts and cancelled slots are noticed too late to refill.",
  endState:
    "Every upcoming appointment is either confirmed, moved to a verified replacement or cancelled with the slot handed to the waitlist — and anything late or unclear sits with a person, not a guess.",
  handles: [
    "Checks the booking is still current before every reminder",
    "Classifies confirm, move and cancel replies, and asks when a reply is unclear",
    "Moves a booking by holding and verifying the replacement before releasing the original",
    "Routes requests inside the late-cancellation window to staff review",
    "Passes every released slot to the waitlist workflow",
  ],
  boundaries: [
    "Never charges a cancellation fee in the demo; fees are a staff decision",
    "Silence never cancels a booking unless the displayed policy expressly says so",
    "A failed replacement never touches the original booking",
    "The public demo sends no messages and changes no real calendar",
  ],
  delivered: [
    { title: "Client confirmation", body: "Confirmed time, or the new booking reference with the old appointment shown as released." },
    { title: "Owner handoff", body: "Policy review task for late requests, or a call task when the client does not reply or a replacement fails." },
    { title: "Appointment record", body: "Old and new calendar entries, messages sent against the limit, policy applied and the waitlist event for any released slot." },
  ],
  deployment: {
    rules: [
      "Reminder timing and the maximum number of messages",
      "Late-change window and who reviews late requests",
      "Whether silence ever releases a booking, and how that is stated to clients",
      "Which replacement times may be offered for each service and stylist",
    ],
    systems: ["Your calendar or booking system", "Customer preferences", "SMS or email messaging", "Cancellation policy configuration", "Waitlist workflow"],
  },
  measures: ["Attendance rate", "Successful reschedules", "Hours recovered from cancellations"],
  reliability: ["Originals released without a verified replacement (target: zero)", "Messages beyond the reminder limit (target: zero)", "Bookings cancelled by silence without a stated policy (target: zero)"],
  harness: {
    systems:
      "Production uses the calendar, customer preferences, messaging and the cancellation policy configuration. The demo uses a fixture salon calendar, three fixture replacement slots, an outbox that holds every message and a simulated waitlist event.",
    controls: [
      "Verify the booking is current before each message",
      "Apply the late-change window and send late requests to staff",
      "Bound reminders; silence cancels only under a displayed policy",
      "Transactional reschedule: hold and verify the new slot before releasing the old",
      "Verify every calendar write by read-back",
      "No unsupported charges",
    ],
  },
  ctaLine: "Want this confirming visits in your own booking system?",
  graph: {
    nodes: [
      { id: "due", kind: "action", row: 0, title: "Appointment reminder due", input: "Upcoming appointment", rule: "Reminder window reached (72 h before)", output: "Reminder task", failure: "—", system: "Calendar (demo: fixture)" },
      { id: "booking", kind: "action", row: 1, title: "Check current booking", input: "Booking reference", rule: "Booking still exists, unchanged", output: "Verified current booking", failure: "Changed or cancelled → no message", system: "Calendar (demo: fixture read-back)" },
      { id: "request", kind: "action", row: 2, title: "Send confirmation request", input: "Verified booking, policy", rule: `Up to ${MAX_MESSAGES} messages, 24 h apart; policy stated`, output: "Reminder message", failure: "No reply → limited reminder", system: "SMS (demo: held outbox)" },
      { id: "handle", kind: "action", row: 3, title: "Handle customer response", input: "Client reply", rule: "Confirm / move / cancel; unclear → ask, then staff", output: "Classified intent, chosen slot", failure: "Unclear twice → staff", system: "Session state" },
      { id: "confirm_change", kind: "action", row: 4, title: "Confirm move or cancel", input: "Intent, chosen slot", rule: "Policy window; hold replacement before anything is released", output: "Allowed change with held slot", failure: "Late → policy review; slot lost → keep original", system: "Calendar hold (demo: fixture)" },
      { id: "update", kind: "action", row: 5, title: "Update calendar and notify", input: "Allowed change", rule: "Write, read back, then release old slot and notify", output: "Confirmed / moved / cancelled booking; waitlist event", failure: "Write fails → original kept, retry or staff", system: "Calendar + waitlist (demo: simulated adapter)" },
      { id: "no_reply", kind: "branch", row: 1, title: "No reply", input: "No reply within 24 h", rule: `Re-check booking and remind, max ${MAX_MESSAGES}; silence never cancels unless the displayed policy says so`, output: "Reminder or stop with kept booking", failure: "—" },
      { id: "replacement_fails", kind: "branch", row: 3.4, title: "Replacement fails", input: "Slot taken or calendar write failed", rule: "Keep the original; offer another time or staff", output: "Original booking unchanged", failure: "—" },
      { id: "late_cancel", kind: "branch", row: 4.6, title: "Late cancellation", input: "Change inside the 24 h window", rule: "Route to staff review; no automatic fee", output: "Policy review task", failure: "—" },
      { id: "check_current", kind: "check", row: 1, title: "Current appointment", input: "Booking reference", rule: "Read back before each message", output: "Active / changed", failure: "Changed → stop reminders" },
      { id: "check_policy", kind: "check", row: 3.8, title: "Policy and slot checks", input: "Request time, replacement slot", rule: "Outside late window; replacement held", output: "Allowed / review / slot failed", failure: "Late → review; taken → keep original" },
      { id: "check_calendar", kind: "check", row: 5, title: "Verified calendar update", input: "Calendar write result", rule: "Read-back must show the change before notifying", output: "Verified change", failure: "Unverified → nothing confirmed" },
    ],
    edges: [
      { from: "due", to: "booking", kind: "flow" },
      { from: "booking", to: "request", kind: "flow" },
      { from: "request", to: "handle", kind: "flow" },
      { from: "handle", to: "confirm_change", kind: "flow" },
      { from: "confirm_change", to: "update", kind: "flow" },
      { from: "handle", to: "no_reply", kind: "return" },
      { from: "no_reply", to: "booking", kind: "return", label: "limited reminder" },
      { from: "confirm_change", to: "replacement_fails", kind: "return" },
      { from: "replacement_fails", to: "handle", kind: "return", label: "keep original" },
      { from: "confirm_change", to: "late_cancel", kind: "return" },
      { from: "check_current", to: "booking", kind: "check" },
      { from: "check_policy", to: "confirm_change", kind: "check" },
      { from: "check_calendar", to: "update", kind: "check" },
    ],
  },
  demo,
};
