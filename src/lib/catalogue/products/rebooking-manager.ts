import type { DemoAction, DemoDefinition, Product, RecordField } from "../types";
import { Sim, aud, DAY, HOUR } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

/** Day 0 of the demo = the completed visit, Monday 5 October 2026. */
const BASE_UTC = Date.UTC(2026, 9, 5);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(d: number): string {
  const dt = new Date(BASE_UTC + d * 86400000);
  return `${DOW[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}
function isSunday(d: number): boolean {
  return new Date(BASE_UTC + d * 86400000).getUTCDay() === 0;
}

interface Service {
  business: string;
  customer: string;
  first: string;
  contact: string;
  job: string;
  subject: string;
  price: number;
  providers: string[];
  time: string;
}

const SERVICES: Record<string, Service> = {
  "Dog grooming": {
    business: "Wagtail Grooming",
    customer: "Sam Patel",
    first: "Sam",
    contact: "sam@patel.example",
    job: "Full groom for Biscuit (cavoodle)",
    subject: "Biscuit’s next groom",
    price: 95,
    providers: ["Mia", "Tom"],
    time: "10:00",
  },
  "Home cleaning": {
    business: "Brightside Cleaning",
    customer: "Lena Moore",
    first: "Lena",
    contact: "lena@moore.example",
    job: "Two-bedroom clean, Marrickville",
    subject: "your next clean",
    price: 160,
    providers: ["Ana", "Josh"],
    time: "09:00",
  },
};

const EXISTING_BOOKING_REF = "BK-3107";
/** Recurring proposals show this many occurrences; the series continues until cancelled. */
const HORIZON = 6;
const MAX_REVISIONS = 3;

type Mode = "single" | "recurring";
type OccStatus = "proposed" | "moved" | "skipped" | "booked" | "completed" | "cancelled";

interface Occ {
  day: number;
  original: number;
  status: OccStatus;
  alt: number | null;
  clash: boolean;
}

type Step = "awaiting_provider" | "awaiting_choice" | "awaiting_conflict" | "awaiting_approval" | "saved" | "done";

interface State {
  step: Step;
  mode: Mode;
  interval: number;
  provider: string;
  busy: number[];
  occs: Occ[];
  revisions: number;
  ref: string;
  saveKey: string;
  earned: number;
  visitsDone: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function svcOf(sim: Sim<State>): Service {
  return SERVICES[sim.str("service")] ?? SERVICES["Dog grooming"];
}

function everyLabel(weeks: number): string {
  return weeks === 1 ? "weekly" : weeks === 2 ? "fortnightly" : `every ${weeks} weeks`;
}

function modeLabel(m: Mode): string {
  return m === "single" ? "next appointment" : "recurring schedule";
}

function candidateDays(mode: Mode, interval: number): number[] {
  const n = mode === "single" ? 1 : HORIZON;
  const out: number[] = [];
  for (let i = 1; i <= n; i++) {
    let d = i * interval * 7;
    if (isSunday(d)) d += 1; // closed Sundays
    out.push(d);
  }
  return out;
}

/** Fixture calendar: the provider's fully booked days, derived from the "date conflicts" input and the initial interval. */
function busyDays(mode: Mode, interval: number, conflicts: string): number[] {
  const days = candidateDays(mode, interval);
  if (conflicts === "One clash") return mode === "single" ? [days[0]] : [days[1]];
  if (conflicts === "Two clashes") return mode === "single" ? [days[0], days[0] + 1] : [days[1], days[4]];
  return [];
}

function active(s: State): Occ[] {
  return s.occs.filter((o) => o.status !== "skipped");
}

function occField(o: Occ, i: number, time: string): RecordField {
  const base = `${dayLabel(o.day)} ${time}${o.status !== "moved" && o.day !== o.original ? ` (moved from ${dayLabel(o.original)})` : ""}`;
  switch (o.status) {
    case "moved":
      return { label: `Visit ${i + 1}`, value: `${base} — moved from ${dayLabel(o.original)} (provider booked)`, tone: "warn" };
    case "skipped":
      return { label: `Visit ${i + 1}`, value: `${dayLabel(o.original)} — skipped, provider unavailable`, tone: "muted" };
    case "completed":
      return { label: `Visit ${i + 1}`, value: `${base} — completed`, tone: "ok" };
    case "cancelled":
      return { label: `Visit ${i + 1}`, value: `${base} — cancelled`, tone: "bad" };
    default:
      return { label: `Visit ${i + 1}`, value: o.clash ? `${dayLabel(o.day)} — clash, alternative ${o.alt !== null ? dayLabel(o.alt) : "none found"}` : base, tone: o.clash ? "bad" : "default" };
  }
}

function scheduleFields(sim: Sim<State>): RecordField[] {
  const s = sim.s;
  const svc = svcOf(sim);
  return [
    { label: "Mode", value: s.mode === "single" ? "Next appointment only" : `Recurring, ${everyLabel(s.interval)} (continues until cancelled)` },
    { label: "Provider", value: s.provider },
    ...s.occs.map((o, i) => occField(o, i, svc.time)),
  ];
}

function seriesText(sim: Sim<State>): string {
  const svc = svcOf(sim);
  return active(sim.s)
    .map((o) => `• ${dayLabel(o.day)} ${svc.time}${o.status === "moved" ? ` (moved from ${dayLabel(o.original)})` : ""}`)
    .join("\n");
}

function findAlt(day: number, busy: number[], taken: number[]): number | null {
  for (const delta of [1, -1, 2, -2]) {
    const d = day + delta;
    if (d <= 0 || isSunday(d) || busy.includes(d) || taken.includes(d)) continue;
    return d;
  }
  return null;
}

function intervalActions(s: State): DemoAction[] {
  if (s.revisions >= MAX_REVISIONS) return [];
  const out: DemoAction[] = [];
  if (s.interval < 12) out.push({ id: "change_longer", label: `Change to ${everyLabel(s.interval + 1)}`, actor: "customer", hint: "Dates are regenerated and every one is re-checked." });
  if (s.interval > 1) out.push({ id: "change_shorter", label: `Change to ${everyLabel(s.interval - 1)}`, actor: "customer" });
  return out;
}

function declineAction(): DemoAction {
  return { id: "decline", label: "Reply: “No thanks, I’ll call when I’m ready.”", actor: "customer", tone: "danger" };
}

/* ------------------------------------------------------------------ */
/* Workflow steps                                                      */
/* ------------------------------------------------------------------ */

function checkProvider(sim: Sim<State>): boolean {
  const s = sim.s;
  const svc = svcOf(sim);
  const pref = sim.str("provider");
  if (pref === "Any available") {
    s.provider = svc.providers[0];
    sim.emit("check_pref", "passed", `No preference — ${s.provider} assigned`, `${s.provider} offers ${sim.str("service").toLowerCase()}.`);
    return true;
  }
  if (svc.providers.includes(pref)) {
    s.provider = pref;
    sim.emit("check_pref", "passed", `Preferred provider ${pref} fits the service`, `${pref} offers ${sim.str("service").toLowerCase()} at ${svc.business}.`);
    return true;
  }
  sim.emit("check_pref", "failed", `${pref} does not offer ${sim.str("service").toLowerCase()}`, "The preference is not replaced silently — the customer is asked.");
  sim.say("assistant", `Thanks for today, ${svc.first}. ${pref} doesn’t do ${sim.str("service").toLowerCase()} with us, but ${svc.providers.join(" or ")} can. Would either suit for ${svc.subject}?`);
  sim.send({ channel: "sms", to: svc.customer, summary: "Provider preference question", status: "held" });
  s.step = "awaiting_provider";
  sim.wait("waiting_customer", [
    { id: "any_provider", label: `Reply: “Either ${svc.providers.join(" or ")} is fine.”`, actor: "customer", tone: "primary" },
    declineAction(),
  ]);
  return false;
}

function invite(sim: Sim<State>) {
  const s = sim.s;
  const svc = svcOf(sim);
  const key = `invite:${svc.contact}:${s.mode}`;
  if (sim.claim(key, "mode", "invitation")) {
    const text =
      s.mode === "single"
        ? `Thanks for today, ${svc.first}! ${svc.subject.charAt(0).toUpperCase() + svc.subject.slice(1)} is usually due in ${s.interval} weeks. Would you like me to find a time with ${s.provider} around ${dayLabel(s.interval * 7)}?`
        : `Thanks for today, ${svc.first}! Would you like a regular ${everyLabel(s.interval)} visit with ${s.provider}? I’ll show you every date before anything is booked.`;
    sim.say("assistant", text);
    sim.send({ channel: "sms", to: svc.customer, summary: `Rebooking invitation (${modeLabel(s.mode)})`, status: "held", opKey: key });
    sim.emit("mode", "waiting", `Invitation offered: ${modeLabel(s.mode)}`, "Held in the demo outbox. The customer chooses the mode explicitly.", { opKey: key });
  }
  s.step = "awaiting_choice";
  sim.wait("waiting_customer", [
    { id: "accept", label: s.mode === "single" ? "Reply: “Yes, find me a time.”" : `Reply: “Yes, ${everyLabel(s.interval)} works.”`, actor: "customer", tone: "primary" },
    s.mode === "single"
      ? { id: "switch_mode", label: "Reply: “Could we make it a regular booking instead?”", actor: "customer", hint: "Switches to a recurring schedule." }
      : { id: "switch_mode", label: "Reply: “Just the next visit for now.”", actor: "customer", hint: "Switches to a single appointment." },
    declineAction(),
  ]);
}

function generate(sim: Sim<State>) {
  const s = sim.s;
  const days = candidateDays(s.mode, s.interval);
  s.occs = days.map((d) => ({ day: d, original: d, status: "proposed" as OccStatus, alt: null, clash: false }));
  sim.emit(
    "gen",
    "started",
    `Generating ${days.length} candidate date${days.length === 1 ? "" : "s"}`,
    `${s.mode === "single" ? `${s.interval} weeks after` : `${everyLabel(s.interval)} from`} ${dayLabel(0)}; closed Sundays${s.mode === "recurring" ? `; first ${HORIZON} occurrences shown` : ""}.`,
  );
  checkDates(sim);
}

function checkDates(sim: Sim<State>) {
  const s = sim.s;
  const svc = svcOf(sim);
  const list = active(s);
  const taken = list.map((o) => o.day);
  let clashes = 0;
  for (const o of list) {
    o.clash = s.busy.includes(o.day);
    o.alt = null;
    if (o.clash) {
      clashes += 1;
      o.alt = findAlt(o.day, s.busy, taken);
      sim.emit("check_dates", "failed", `Clash: ${dayLabel(o.day)} — ${s.provider} fully booked`, o.alt !== null ? `Nearest free alternative: ${dayLabel(o.alt)}.` : "No free day within two days.");
    }
  }
  if (clashes === 0) {
    sim.emit("check_dates", "passed", `Every date checked (${list.length} of ${list.length} free)`, `${s.provider}’s calendar fixture has capacity on each date.`);
    sim.emit("gen", "passed", `${list.length} suitable date${list.length === 1 ? "" : "s"} generated`);
    present(sim);
    return;
  }
  sim.record({ id: "schedule", title: "Proposed schedule", status: `${clashes} date${clashes === 1 ? "" : "s"} unavailable`, tone: "warn", fields: scheduleFields(sim) });
  const clashList = list.filter((o) => o.clash);
  sim.emit("date_conflict", "info", `${clashes} date${clashes === 1 ? "" : "s"} clash — alternatives proposed`, clashList.map((o) => `${dayLabel(o.day)} → ${o.alt !== null ? dayLabel(o.alt) : "none"}`).join("; "));
  sim.say(
    "assistant",
    `${s.provider} is already fully booked on ${clashList.map((o) => dayLabel(o.day)).join(" and ")}. ` +
      (clashList.every((o) => o.alt !== null) ? `I can offer ${clashList.map((o) => `${dayLabel(o.alt as number)} ${svc.time}`).join(" and ")} instead.` : "I couldn’t find a nearby alternative.") +
      (s.mode === "recurring" ? " Or we can skip that visit, or change how often we come." : " Or we can change the interval."),
  );
  sim.send({ channel: "sms", to: svc.customer, summary: "Date clash with suggested alternatives", status: "held" });
  s.step = "awaiting_conflict";
  const actions: DemoAction[] = [];
  if (clashList.every((o) => o.alt !== null)) actions.push({ id: "use_alts", label: `Reply: “The alternative${clashes === 1 ? "" : "s"} are fine.”`, actor: "customer", tone: "primary" });
  if (s.mode === "recurring" && list.length > clashes) actions.push({ id: "skip_clash", label: `Reply: “Just skip ${clashes === 1 ? "that visit" : "those visits"}.”`, actor: "customer" });
  actions.push(...intervalActions(s));
  actions.push(declineAction());
  sim.wait("waiting_customer", actions);
}

function present(sim: Sim<State>) {
  const s = sim.s;
  const svc = svcOf(sim);
  const list = active(s);
  sim.record({ id: "schedule", title: "Proposed schedule", status: "Proposed — awaiting customer confirmation", tone: "warn", fields: scheduleFields(sim) });
  sim.emit("approve", "waiting", s.mode === "single" ? "Proposed appointment shown" : `Whole series shown (${list.length} visits)`, "Nothing is saved until the customer confirms once.");
  sim.say(
    "assistant",
    s.mode === "single"
      ? `Here’s the time I can hold with ${s.provider}:\n${seriesText(sim)}\nReply to confirm and I’ll book it.`
      : `Here’s your ${everyLabel(s.interval)} schedule with ${s.provider} (it continues after these until you cancel):\n${seriesText(sim)}${s.occs.some((o) => o.status === "skipped") ? `\nSkipped: ${s.occs.filter((o) => o.status === "skipped").map((o) => dayLabel(o.original)).join(", ")}` : ""}\nReply to confirm the whole schedule.`,
  );
  sim.send({ channel: "sms", to: svc.customer, summary: `Proposed ${modeLabel(s.mode)} (${list.length} date${list.length === 1 ? "" : "s"})`, status: "held" });
  s.step = "awaiting_approval";
  sim.wait("waiting_customer", [
    { id: "confirm", label: s.mode === "single" ? "Confirm this appointment" : "Confirm the whole schedule", actor: "customer", tone: "primary", hint: s.mode === "recurring" ? "Recurrence consent: one confirmation covers every listed date." : undefined },
    ...intervalActions(s),
    declineAction(),
  ]);
}

function changeInterval(sim: Sim<State>, delta: number) {
  const s = sim.s;
  const next = Math.min(12, Math.max(1, s.interval + delta));
  sim.advance(20);
  sim.say("customer", `Could we make it ${everyLabel(next)} instead?`);
  s.revisions += 1;
  sim.emit("change_interval", "info", `Interval changed to ${everyLabel(next)}`, `Revision ${s.revisions} of ${MAX_REVISIONS}. Dates are regenerated and re-checked.`);
  s.interval = next;
  sim.emit("mode", "passed", `Revised ${modeLabel(s.mode)}: ${everyLabel(next)}`);
  generate(sim);
}

function savedActions(sim: Sim<State>): DemoAction[] {
  const s = sim.s;
  const booked = s.occs.filter((o) => o.status === "booked");
  const next = booked[0];
  return [
    { id: "advance", label: `Advance clock to visit on ${next ? dayLabel(next.day) : "—"}`, actor: "clock", tone: "primary", hint: "Sends the day-before reminder, then records the completed-job event." },
    { id: "replay_save", label: "Replay the confirmation (network retry)", actor: "staff", hint: "The same confirmation arrives twice." },
    { id: "cancel_series", label: s.mode === "single" ? "Customer cancels the appointment" : "Customer cancels the series", actor: "customer", tone: "danger" },
  ];
}

function revenueFields(sim: Sim<State>): RecordField[] {
  const s = sim.s;
  const svc = svcOf(sim);
  const booked = s.occs.filter((o) => o.status === "booked").length;
  return [
    { label: "Completed repeat visits", value: String(s.visitsDone) },
    { label: "Earned (completed visits only)", value: aud(s.earned), tone: s.earned > 0 ? "ok" : "muted" },
    { label: "Booked future visits", value: `${booked} × ${aud(svc.price)} = ${aud(booked * svc.price)} (not counted as earned)`, tone: "muted" },
  ];
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Interactive simulation using a sample provider calendar. No messages are sent and no real appointment or reminder is created.",
  assistantName: "Rebooking assistant",
  channelLabel: "SMS thread with the customer",
  fields: [
    { kind: "select", name: "mode", label: "Mode offered", options: ["Next appointment", "Recurring schedule"], helper: "The customer can still switch mode in the conversation." },
    { kind: "select", name: "service", label: "Service", options: ["Dog grooming", "Home cleaning"] },
    { kind: "number", name: "interval_weeks", label: "Service interval", min: 1, max: 12, step: 1, suffix: "weeks" },
    { kind: "select", name: "provider", label: "Preferred provider", options: ["Mia", "Tom", "Ana", "Josh", "Any available"], helper: "Mia and Tom groom; Ana and Josh clean." },
    { kind: "select", name: "conflicts", label: "Date conflicts in the calendar", options: ["None", "One clash", "Two clashes"], helper: "Blocks the provider on proposed dates in the sample calendar." },
    { kind: "toggle", name: "existing_booking", label: "Customer already has a next appointment" },
  ],
  scenarios: [
    { id: "groomer_next", label: "Next grooming visit", kind: "success", description: "A dog groom is finished; the owner wants the next one in six weeks with Mia.", inputs: { mode: "Next appointment", service: "Dog grooming", interval_weeks: 6, provider: "Mia", conflicts: "None", existing_booking: false } },
    { id: "cleaner_recurring", label: "Fortnightly cleaning", kind: "success", description: "A cleaner offers a fortnightly schedule; the customer reviews every date and confirms once.", inputs: { mode: "Recurring schedule", service: "Home cleaning", interval_weeks: 2, provider: "Ana", conflicts: "None", existing_booking: false } },
    { id: "recurring_conflict", label: "Recurring with a clash", kind: "exception", description: "One fortnightly date clashes with a full-day job. An alternative is proposed before anything is saved.", inputs: { mode: "Recurring schedule", service: "Home cleaning", interval_weeks: 2, provider: "Ana", conflicts: "One clash", existing_booking: false } },
    { id: "already_booked", label: "Already booked", kind: "exception", description: "The customer booked their next groom at the counter. The invitation is suppressed.", inputs: { mode: "Next appointment", service: "Dog grooming", interval_weeks: 6, provider: "Tom", conflicts: "None", existing_booking: true } },
    { id: "provider_mismatch", label: "Preferred provider does not fit", kind: "exception", description: "The customer asked for Ana, who cleans but does not groom. The customer is asked rather than silently reassigned.", inputs: { mode: "Next appointment", service: "Dog grooming", interval_weeks: 6, provider: "Ana", conflicts: "None", existing_booking: false } },
  ],

  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("rebooking-manager", scenarioId, inputs, {
      step: "awaiting_choice",
      mode: "single",
      interval: 6,
      provider: "",
      busy: [],
      occs: [],
      revisions: 0,
      ref: "",
      saveKey: "",
      earned: 0,
      visitsDone: 0,
    });
    const s = sim.s;
    const svc = svcOf(sim);
    s.mode = sim.str("mode") === "Recurring schedule" ? "recurring" : "single";
    s.interval = Math.min(12, Math.max(1, Math.round(sim.num("interval_weeks", 6))));
    s.busy = busyDays(s.mode, s.interval, sim.str("conflicts", "None"));

    // 1. Completed service
    sim.say("system", `${svc.business}: job marked complete — ${svc.job}.`);
    sim.emit("completed", "started", "Completed-job event received", `${svc.job} · ${svc.customer}`);
    sim.record({
      id: "customer",
      title: "Customer and completed job",
      status: "Completed today",
      fields: [
        { label: "Business", value: svc.business },
        { label: "Customer", value: `${svc.customer} (${svc.contact})` },
        { label: "Job", value: `${svc.job}, ${dayLabel(0)}` },
        { label: "Preferred provider", value: sim.str("provider") },
        { label: "Service interval", value: `${s.interval} week${s.interval === 1 ? "" : "s"}` },
      ],
    });
    if (s.busy.length) {
      sim.record({
        id: "calendar",
        title: "Provider calendar (fixture)",
        status: `${s.busy.length} full day${s.busy.length === 1 ? "" : "s"} already booked`,
        tone: "muted",
        fields: s.busy.map((d, i) => ({ label: `Booked ${i + 1}`, value: `${dayLabel(d)} — full-day job` })),
      });
    }
    sim.emit("completed", "passed", "Job completed — rebooking eligible");

    // 2. Existing next booking
    sim.emit("existing", "started", "Checking for an existing next booking");
    if (sim.bool("existing_booking")) {
      const day = s.interval * 7;
      sim.emit("existing", "info", `Existing booking ${EXISTING_BOOKING_REF} found for ${dayLabel(day)}`, "Booked at the counter — calendar fixture.", { ref: EXISTING_BOOKING_REF });
      sim.emit("already_booked", "stopped", "Invitation suppressed — already booked", "No rebooking message is queued; the existing booking is left unchanged.");
      sim.send({ channel: "sms", to: svc.customer, summary: "Rebooking invitation (suppressed — already booked)", status: "suppressed" });
      sim.record({
        id: "schedule",
        title: "Next booking",
        ref: EXISTING_BOOKING_REF,
        status: "Already booked — no invitation sent",
        tone: "muted",
        fields: [
          { label: "Date", value: `${dayLabel(day)} ${svc.time}` },
          { label: "Source", value: "Existing calendar entry" },
        ],
      });
      s.step = "done";
      return sim.finish("stopped", { kind: "exception", summary: `${svc.customer} already has ${EXISTING_BOOKING_REF} on ${dayLabel(day)}, so no rebooking invitation was queued and nothing was changed.` }).done();
    }
    sim.emit("existing", "passed", "No future booking on file");

    // 3. Customer preference, then mode choice
    if (!checkProvider(sim)) return sim.done();
    invite(sim);
    return sim.done();
  },

  act(run, actionId) {
    const sim = Sim.from(run);
    const s = sim.s;
    const svc = svcOf(sim);

    switch (actionId) {
      case "any_provider": {
        if (s.step !== "awaiting_provider") return sim.done();
        sim.advance(15);
        sim.say("customer", `Either ${svc.providers.join(" or ")} is fine.`);
        s.provider = svc.providers[0];
        sim.emit("check_pref", "passed", `${s.provider} assigned with the customer’s agreement`);
        invite(sim);
        return sim.done();
      }

      case "accept": {
        if (s.step !== "awaiting_choice") return sim.done();
        sim.advance(15);
        sim.say("customer", s.mode === "single" ? "Yes please, find me a time." : `Yes, ${everyLabel(s.interval)} works for me.`);
        sim.emit("mode", "passed", `Customer chose ${modeLabel(s.mode)}`);
        generate(sim);
        return sim.done();
      }

      case "switch_mode": {
        if (s.step !== "awaiting_choice") return sim.done();
        sim.advance(15);
        sim.say("customer", s.mode === "single" ? "Could we make it a regular booking instead?" : "Just the next visit for now, thanks.");
        s.mode = s.mode === "single" ? "recurring" : "single";
        sim.emit("mode", "passed", `Customer chose ${modeLabel(s.mode)} instead`, "Explicit customer choice; the other mode is not offered again.");
        generate(sim);
        return sim.done();
      }

      case "use_alts": {
        if (s.step !== "awaiting_conflict") return sim.done();
        sim.advance(10);
        sim.say("customer", "The alternative dates are fine.");
        for (const o of active(s)) {
          if (o.clash && o.alt !== null) {
            o.day = o.alt;
            o.status = "moved";
          }
        }
        sim.emit("date_conflict", "passed", "Alternatives accepted by the customer");
        sim.emit("gen", "info", "Re-checking the revised dates");
        checkDates(sim);
        return sim.done();
      }

      case "skip_clash": {
        if (s.step !== "awaiting_conflict") return sim.done();
        sim.advance(10);
        sim.say("customer", "Just skip those, thanks.");
        for (const o of active(s)) if (o.clash) o.status = "skipped";
        sim.emit("date_conflict", "passed", "Clashing visits skipped and listed as exceptions");
        checkDates(sim);
        return sim.done();
      }

      case "change_longer":
      case "change_shorter": {
        if ((s.step !== "awaiting_conflict" && s.step !== "awaiting_approval") || s.revisions >= MAX_REVISIONS) return sim.done();
        changeInterval(sim, actionId === "change_longer" ? 1 : -1);
        return sim.done();
      }

      case "decline": {
        if (s.step === "saved" || s.step === "done") return sim.done();
        sim.advance(10);
        sim.say("customer", "No thanks, I’ll call when I’m ready.");
        sim.emit("mode", "stopped", "Customer declined — nothing saved", "No calendar entry or reminder is created. No further rebooking messages for this job.");
        if (sim.getRecord("schedule")) sim.patch("schedule", { status: "Not saved — customer declined", tone: "muted" });
        s.step = "done";
        return sim.finish("stopped", { kind: "exception", summary: "The customer declined, so nothing was saved to the calendar and no reminders were created." }).done();
      }

      case "confirm": {
        if (s.step !== "awaiting_approval") return sim.done();
        sim.advance(10);
        const list = active(s);
        sim.say("customer", s.mode === "single" ? "Confirmed, thanks!" : "Yes, please book all of those.");
        sim.emit("approve", "passed", s.mode === "single" ? "Customer confirmed the appointment" : `Customer confirmed the whole series (${list.length} visits)`, s.mode === "recurring" ? "Recurrence consent recorded once for the listed dates." : undefined);
        const key = `schedule:${svc.contact}:${s.mode}:${list.map((o) => o.day).join("-")}`;
        if (!sim.claim(key, "check_key", "schedule save")) return sim.done();
        s.saveKey = key;
        s.ref = sim.ref(s.mode === "recurring" ? "SCH" : "BK");
        sim.emit("check_key", "passed", `Unique schedule key reserved for ${s.ref}`, key, { opKey: key, ref: s.ref });
        // Capacity re-check at save time for every occurrence.
        const stillFree = list.every((o) => !s.busy.includes(o.day));
        sim.emit("check_dates", stillFree ? "passed" : "failed", `Capacity re-checked for all ${list.length} date${list.length === 1 ? "" : "s"} at save`);
        sim.emit("save", "started", "Writing appointments to the calendar");
        sim.send({ channel: "calendar", to: `${svc.business} calendar`, summary: `Create ${list.length} appointment${list.length === 1 ? "" : "s"} with ${s.provider} (${s.ref})`, status: "simulated", opKey: key });
        for (const o of list) o.status = "booked";
        sim.emit("save", "confirmed", `${list.length} appointment${list.length === 1 ? "" : "s"} saved as ${s.ref}`, "Calendar write acknowledged (simulated adapter).", { opKey: key, ref: s.ref });
        sim.record({ id: "schedule", title: s.mode === "single" ? "Booked appointment" : "Saved recurring schedule", ref: s.ref, status: "Saved — confirmed by customer", tone: "ok", fields: scheduleFields(sim) });
        sim.record({
          id: "reminders",
          title: "Reminders",
          status: `Active — ${list.length} scheduled`,
          tone: "ok",
          fields: list.map((o, i) => ({ label: `Reminder ${i + 1}`, value: `${dayLabel(o.day - 1)} 09:00 for ${dayLabel(o.day)}` })),
        });
        sim.record({ id: "revenue", title: "Repeat-visit value", status: "No visit completed yet", tone: "muted", fields: revenueFields(sim) });
        const confirmKey = `${key}:confirmation`;
        sim.claim(confirmKey, "save", "confirmation");
        sim.send({ channel: "sms", to: svc.customer, summary: `Confirmation ${s.ref} with reminder schedule`, status: "held", opKey: confirmKey });
        sim.emit("save", "confirmed", "Reminders scheduled — the day before each visit");
        sim.say("assistant", `All set — ${s.ref}. ${s.mode === "single" ? "You’re booked" : "Your visits are booked"} with ${s.provider}:\n${seriesText(sim)}\nWe’ll text you the day before each visit. Reply CANCEL any time to stop.`);
        s.step = "saved";
        sim.wait("waiting_customer", savedActions(sim));
        return sim.done();
      }

      case "replay_save": {
        if (s.step !== "saved") return sim.done();
        sim.say("system", "The same confirmation request arrived a second time.");
        sim.claim(s.saveKey, "check_key", "schedule save");
        sim.wait("waiting_customer", savedActions(sim));
        return sim.done();
      }

      case "advance": {
        if (s.step !== "saved") return sim.done();
        const idx = s.occs.findIndex((o) => o.status === "booked");
        if (idx < 0) return sim.done();
        const o = s.occs[idx];
        const n = s.occs.filter((x) => x.status === "completed").length + 1;
        const reminderAt = (o.day - 1) * DAY;
        if (reminderAt > sim.run.clock) sim.advance(reminderAt - sim.run.clock);
        const rKey = `reminder:${s.ref}:${o.day}`;
        if (sim.claim(rKey, "visits", "reminder")) {
          sim.send({ channel: "sms", to: svc.customer, summary: `Reminder: ${dayLabel(o.day)} ${svc.time} with ${s.provider}`, status: "held", opKey: rKey });
          sim.say("assistant", `Reminder: ${s.provider} is booked for ${dayLabel(o.day)} at ${svc.time}. Reply CANCEL to stop the ${s.mode === "single" ? "booking" : "series"}.`);
          sim.emit("visits", "info", `Reminder sent for ${dayLabel(o.day)}`, "Held in the demo outbox.", { opKey: rKey });
        }
        sim.advance(DAY + HOUR);
        o.status = "completed";
        s.visitsDone += 1;
        s.earned += svc.price;
        sim.emit("visits", "confirmed", `Visit ${n} completed — job event received`, `${aud(svc.price)} counted as earned only now.`);
        sim.patch("reminders", { fields: [{ label: `Reminder ${n}`, value: `Sent ${dayLabel(o.day - 1)} 09:00` }] });
        sim.record({ id: "schedule", title: s.mode === "single" ? "Booked appointment" : "Saved recurring schedule", ref: s.ref, status: "Saved — confirmed by customer", tone: "ok", fields: scheduleFields(sim) });
        sim.record({ id: "revenue", title: "Repeat-visit value", status: `${s.visitsDone} completed visit${s.visitsDone === 1 ? "" : "s"}`, tone: "ok", fields: revenueFields(sim) });
        if (!s.occs.some((x) => x.status === "booked")) {
          s.step = "done";
          sim.patch("reminders", { status: "All sent", tone: "ok" });
          sim.emit("visits", "passed", s.mode === "single" ? "Next visit completed" : `All ${s.visitsDone} shown visits completed`);
          return sim
            .finish("completed", {
              kind: "success",
              summary:
                s.mode === "single"
                  ? `The next visit ${s.ref} was confirmed once, reminded and completed. ${aud(s.earned)} was counted as earned only after the completed-job event.`
                  : `All ${s.visitsDone} visits in the demo horizon were completed under ${s.ref}; ${aud(s.earned)} was counted as earned visit by visit. The schedule continues until the customer cancels.`,
            })
            .done();
        }
        sim.wait("waiting_customer", savedActions(sim));
        return sim.done();
      }

      case "cancel_series": {
        if (s.step !== "saved") return sim.done();
        sim.advance(30);
        sim.say("customer", "CANCEL");
        const remaining = s.occs.filter((o) => o.status === "booked");
        for (const o of remaining) o.status = "cancelled";
        const key = `cancel:${s.ref}`;
        if (sim.claim(key, "visits", "cancellation")) {
          sim.send({ channel: "calendar", to: `${svc.business} calendar`, summary: `Release ${remaining.length} future appointment${remaining.length === 1 ? "" : "s"} (${s.ref})`, status: "simulated", opKey: key });
        }
        sim.emit("visits", "stopped", `${s.mode === "single" ? "Appointment" : "Series"} cancelled — ${remaining.length} future reminder${remaining.length === 1 ? "" : "s"} cancelled`, "No reminder will be sent for a cancelled date. Completed visits stay recorded.", { opKey: key });
        sim.say("assistant", `Done — ${s.ref} is cancelled and you won’t get any more reminders for it. Thanks, ${svc.first}.`);
        sim.send({ channel: "sms", to: svc.customer, summary: `Cancellation acknowledgement (${s.ref})`, status: "held" });
        sim.record({ id: "schedule", title: s.mode === "single" ? "Booked appointment" : "Saved recurring schedule", ref: s.ref, status: "Cancelled by customer", tone: "bad", fields: scheduleFields(sim) });
        sim.patch("reminders", { status: "Stopped — cancelled by customer", tone: "bad" });
        sim.record({ id: "revenue", title: "Repeat-visit value", status: `${s.visitsDone} completed visit${s.visitsDone === 1 ? "" : "s"}`, tone: s.visitsDone ? "ok" : "muted", fields: revenueFields(sim) });
        s.step = "done";
        return sim
          .finish("stopped", {
            kind: "stopped",
            summary: `The customer cancelled ${s.ref}. ${remaining.length} future appointment${remaining.length === 1 ? " was" : "s were"} released and their reminders stopped; ${s.visitsDone} completed visit${s.visitsDone === 1 ? "" : "s"} remain${s.visitsDone === 1 ? "s" : ""} on record.`,
          })
          .done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const rebookingManager: Product = {
  id: "rebooking-manager",
  no: 5,
  slug: "rebooking-manager",
  name: "Rebooking Manager",
  outcome: "Make the next visit easy to arrange.",
  sectorLabel: "Cleaning gardening salons and grooming",
  sectors: ["Home services", "Appointments"],
  outcomes: ["Grow repeat business", "Fill capacity"],
  definition:
    "After a job is completed, it offers the customer either the next individual appointment or an agreed recurring service schedule, checking every date against the provider’s calendar. The two modes are separate, the customer chooses between them explicitly, and nothing is saved until the whole proposal is confirmed once.",
  situation:
    "A groomer finishes a full groom and the owner would like the next one in six weeks, while a cleaner would rather lock in a fortnightly schedule. At the end of a busy day neither business has time to check the calendar date by date, so the next visit is often left to chance.",
  endState:
    "Every completed job ends with a clear offer: one confirmed appointment or an explicitly accepted series, with clashes and skipped dates listed, reminders scheduled and cancellations honoured straight away.",
  handles: [
    "Suppresses the invitation when the customer already has a next booking",
    "Offers a single next appointment or a recurring schedule, and lets the customer switch",
    "Generates dates from the service interval and checks every one against the calendar",
    "Proposes alternatives or skips for clashing dates and shows the whole series before saving",
    "Saves once with a unique schedule key, schedules reminders and stops them on cancellation",
  ],
  boundaries: [
    "Never books a recurring series without one explicit confirmation of the listed dates",
    "Never replaces a preferred provider without asking the customer",
    "Future bookings are not counted as earned revenue; only completed visits are",
    "The public demo sends no messages and writes to no real calendar",
  ],
  delivered: [
    { title: "Customer confirmation", body: "Booking or schedule reference, provider, every date and time, any moved or skipped dates, and how to cancel." },
    { title: "Owner handoff", body: "Calendar entries for each occurrence with the provider assigned, plus a note of clashes resolved and dates skipped." },
    { title: "Schedule record", body: "Mode, interval, occurrences with status, reminder schedule, cancellation state and completed-visit revenue kept separate from future bookings." },
  ],
  deployment: {
    rules: [
      "Service intervals and which services may be offered as a recurring schedule",
      "Which providers perform which services, and working days",
      "How far ahead a series is booked and how clashes are resolved",
      "Reminder timing and what a cancellation releases",
    ],
    systems: ["Job completion events from your booking or job system", "Service catalogue", "Your calendar", "Customer preferences", "SMS or email with consent records"],
  },
  measures: ["Completed repeat visits", "Recurring revenue from completed visits (future bookings not counted as earned)", "Share of completed jobs that leave with a next visit booked"],
  reliability: ["Duplicate appointments from retried saves (target: zero)", "Reminders sent after a cancellation (target: zero)", "Invitations sent to customers already booked (target: zero)"],
  harness: {
    systems:
      "Production uses completed-job events, the service catalogue, the business calendar and stored customer preferences. The demo uses a small fixture schedule for two fictional businesses and an outbox that holds every message.",
    controls: [
      "Suppress the invitation when a next booking already exists",
      "Check the preferred provider actually performs the service",
      "Require recurrence consent: one confirmation of the whole listed series",
      "Check capacity for every occurrence, at proposal and again at save",
      "Save with a unique schedule key so retries cannot duplicate",
      "Cancellation releases future dates and stops their reminders",
    ],
  },
  ctaLine: "Want this offering the next visit from your own calendar?",
  graph: {
    nodes: [
      { id: "completed", kind: "action", row: 0, title: "Completed service", input: "Completed-job event", rule: "Job must be marked complete", output: "Rebooking candidate", failure: "—", system: "Job system (demo: fixture event)" },
      { id: "existing", kind: "action", row: 1, title: "Check existing next booking", input: "Customer and service", rule: "Any future booking for this customer and service?", output: "Clear to invite / suppress", failure: "Booking found → already booked", system: "Calendar (demo: fixture)" },
      { id: "mode", kind: "action", row: 2, title: "Choose single or recurring mode", input: "Invitation reply", rule: "Customer chooses the mode explicitly; may switch once", output: "Chosen mode and interval", failure: "Declined → stop, nothing saved", system: "SMS (demo: held outbox)" },
      { id: "gen", kind: "action", row: 3, title: "Generate suitable dates", input: "Mode, interval, provider", rule: "Interval rule; closed Sundays; 6 occurrences shown for a series", output: "Candidate dates", failure: "Clash → date conflict", system: "Service catalogue (demo: fixture)" },
      { id: "approve", kind: "action", row: 4, title: "Customer approves schedule", input: "Whole proposed series", rule: "One explicit confirmation covers every listed date", output: "Accepted schedule", failure: "Change interval → regenerate", system: "SMS (demo: held outbox)" },
      { id: "save", kind: "action", row: 5, title: "Save appointments and reminders", input: "Accepted schedule", rule: "Write only after confirmation, with a unique key", output: "Booking or schedule reference, reminders", failure: "Write fails → nothing confirmed", system: "Calendar (demo: simulated adapter)" },
      { id: "visits", kind: "action", row: 6, title: "Remind and record visits", input: "Saved schedule, clock", rule: "Reminder the day before; earned only on completed-job event", output: "Completed visits, earned revenue", failure: "Cancel → release dates, stop reminders", system: "SMS + job events (demo: clock)" },
      { id: "already_booked", kind: "branch", row: 1, title: "Already booked", input: "Existing future booking", rule: "Suppress the invitation; change nothing", output: "Suppressed message, stop reason", failure: "—" },
      { id: "date_conflict", kind: "branch", row: 3, title: "Date conflict", input: "Provider fully booked on a date", rule: "Offer nearest free day (±2) or skip the visit", output: "Moved or skipped dates listed", failure: "—" },
      { id: "change_interval", kind: "branch", row: 4.4, title: "Change interval", input: "Customer asks for a different frequency", rule: "Up to 3 revisions; dates regenerated and re-checked", output: "Revised interval", failure: "—" },
      { id: "check_pref", kind: "check", row: 1.8, title: "Customer preference", input: "Preferred provider, service", rule: "Provider must perform the service; never reassigned silently", output: "Assigned provider", failure: "Mismatch → ask the customer" },
      { id: "check_dates", kind: "check", row: 3, title: "Every date checked", input: "Each occurrence", rule: "Provider has capacity on every date, at proposal and at save", output: "Free / clash per date", failure: "Clash → alternatives before approval" },
      { id: "check_key", kind: "check", row: 5, title: "Unique schedule key", input: "Customer, mode, dates", rule: "One save per key; replays ignored", output: "Reserved schedule reference", failure: "Duplicate → ignored, no second booking" },
    ],
    edges: [
      { from: "completed", to: "existing", kind: "flow" },
      { from: "existing", to: "mode", kind: "flow" },
      { from: "mode", to: "gen", kind: "flow" },
      { from: "gen", to: "approve", kind: "flow" },
      { from: "approve", to: "save", kind: "flow" },
      { from: "save", to: "visits", kind: "flow" },
      { from: "existing", to: "already_booked", kind: "return" },
      { from: "gen", to: "date_conflict", kind: "return" },
      { from: "date_conflict", to: "gen", kind: "return", label: "find alternative" },
      { from: "approve", to: "change_interval", kind: "return" },
      { from: "change_interval", to: "mode", kind: "return", label: "revise" },
      { from: "check_pref", to: "mode", kind: "check" },
      { from: "check_dates", to: "gen", kind: "check" },
      { from: "check_key", to: "save", kind: "check" },
    ],
  },
  demo,
};
