import type { DemoDefinition, Product, Run } from "../types";
import { Sim, aud, DAY, HOUR } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

const DELIVERY_ZONE = ["Surry Hills", "Sydney CBD", "Parramatta", "North Sydney", "Chatswood", "Pyrmont"];
const EXISTING_LEADS: Record<string, { id: string; company: string; created: string }> = {
  "ops@harbourlane.example": { id: "L-2291", company: "Harbour Lane Architects", created: "14 days ago" },
};
const PRICE_PER_HEAD = 14;
const MAX_ATTEMPTS = 3;
const QUALIFY_THRESHOLD = 70;

type Step =
  | "awaiting_reply"
  | "awaiting_budget"
  | "awaiting_handoff_ack"
  | "awaiting_offer_approval"
  | "awaiting_customer_offer"
  | "awaiting_question_review"
  | "done";

interface Bant {
  budget: number | null; // per head
  authority: "decision maker" | "needs sign-off" | null;
  need: string | null;
  timingWeeks: number | null;
}

interface State {
  step: Step;
  leadId: string;
  attempts: number;
  bant: Bant;
  offerVersion: number;
  owner: string | null;
  initialScore: number;
  finalScore: number | null;
}

/* ------------------------------------------------------------------ */
/* Deterministic scoring                                               */
/* ------------------------------------------------------------------ */

interface ScorePart {
  label: string;
  max: number;
  points: number;
  evidence: string;
  unknown?: boolean;
}

function scoreLead(input: { location: string; headcount: number; startWeeks: number | null }, bant: Bant, afterConversation: boolean) {
  const inZone = DELIVERY_ZONE.some((z) => z.toLowerCase() === input.location.trim().toLowerCase());
  const fit: ScorePart = {
    label: "Service fit",
    max: 30,
    points: !inZone ? 0 : input.headcount >= 10 ? 30 : 15,
    evidence: !inZone
      ? `${input.location} is outside the delivery zone`
      : input.headcount >= 10
        ? `${input.location} in zone; ${input.headcount} people ≥ 10 minimum`
        : `${input.location} in zone; ${input.headcount} people below 10 minimum`,
  };
  const need: ScorePart = {
    label: "Need clarity",
    max: 25,
    points: afterConversation && bant.need ? 25 : 15,
    evidence: afterConversation && bant.need ? `Confirmed: ${bant.need}` : "Form states weekly catering and headcount",
  };
  const weeks = bant.timingWeeks ?? input.startWeeks;
  const timing: ScorePart = {
    label: "Timing",
    max: 20,
    points: weeks === null ? 0 : weeks <= 4 ? 20 : weeks <= 12 ? 12 : 5,
    evidence: weeks === null ? "Start date not supplied" : `Start in ${weeks} week${weeks === 1 ? "" : "s"}`,
    unknown: weeks === null,
  };
  const budget: ScorePart = {
    label: "Budget fit",
    max: 15,
    points: bant.budget === null ? 0 : bant.budget >= 15 ? 15 : bant.budget >= 12 ? 10 : 3,
    evidence: bant.budget === null ? "Unknown — not stated by the customer" : `${aud(bant.budget)} per head stated`,
    unknown: bant.budget === null,
  };
  const decision: ScorePart = {
    label: "Decision access",
    max: 10,
    points: bant.authority === "decision maker" ? 10 : bant.authority === "needs sign-off" ? 5 : 0,
    evidence: bant.authority === null ? "Unknown — not stated by the customer" : `Contact is ${bant.authority}`,
    unknown: bant.authority === null,
  };
  const parts = [fit, need, timing, budget, decision];
  // Service fit passes only when the office is in zone AND meets the minimum headcount.
  return { parts, total: parts.reduce((a, p) => a + p.points, 0), fitPass: fit.points === fit.max };
}

function scoreFields(parts: ScorePart[]) {
  return parts.map((p) => ({
    label: `${p.label} (${p.points}/${p.max})`,
    value: p.evidence,
    tone: p.unknown ? ("muted" as const) : p.points === 0 ? ("bad" as const) : p.points === p.max ? ("ok" as const) : ("default" as const),
  }));
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function leadInput(sim: Sim<State>) {
  const w = sim.str("start_weeks").trim();
  return {
    company: sim.str("company"),
    email: sim.str("email").trim().toLowerCase(),
    location: sim.str("location"),
    headcount: sim.num("headcount"),
    startWeeks: w === "" || !Number.isFinite(Number(w)) ? null : Number(w),
  };
}

function customerActions(): Run["actions"] {
  return [
    { id: "reply_full", label: "Reply with budget and approver", actor: "customer", tone: "primary", hint: "“About $14 a head. I’m the office manager but our director signs off.”" },
    { id: "reply_no_budget", label: "Reply without a budget", actor: "customer", hint: "“Not sure on budget yet — what do you usually charge?”" },
    { id: "opt_out", label: "Ask them to stop contacting you", actor: "customer", tone: "danger" },
    { id: "wait", label: "Advance clock 2 days (no reply)", actor: "clock" },
  ];
}

function sendFollowUp(sim: Sim<State>) {
  const s = sim.s;
  s.attempts += 1;
  const key = `${s.leadId}:followup:${s.attempts}`;
  if (!sim.claim(key, "convo", "follow-up")) return;
  const text =
    s.attempts === 1
      ? `Hi, thanks for asking about weekly catering for ${sim.num("headcount")} people. To prepare a proper offer: roughly what budget per head did you have in mind, and who approves the order?`
      : `Just checking in on your catering enquiry — happy to put an offer together once I know an approximate budget per head.`;
  sim.say("assistant", text);
  sim.send({ channel: "email", to: sim.str("email"), summary: `Follow-up ${s.attempts} of ${MAX_ATTEMPTS}`, status: "held", opKey: key });
  sim.emit("convo", "waiting", `Follow-up ${s.attempts} of ${MAX_ATTEMPTS} queued`, "Held in the demo outbox — the public demo sends no outreach.", { opKey: key });
  sim.patch("lead", { status: "Contacted — awaiting reply", fields: [{ label: "Follow-ups", value: `${s.attempts} of ${MAX_ATTEMPTS}` }] });
}

function runBantAndScore(sim: Sim<State>) {
  const s = sim.s;
  const input = leadInput(sim);
  sim.emit("bant", "started", "Extracting BANT with evidence");
  const sc = scoreLead(input, s.bant, true);
  s.finalScore = sc.total;
  sim.record({
    id: "bant",
    title: "BANT qualification",
    status: s.bant.budget === null ? "Budget unknown" : "Complete",
    tone: s.bant.budget === null ? "warn" : "ok",
    fields: [
      { label: "Budget", value: s.bant.budget === null ? "Unknown" : `${aud(s.bant.budget)} per head`, tone: s.bant.budget === null ? "muted" : "default" },
      { label: "Authority", value: s.bant.authority ?? "Unknown", tone: s.bant.authority ? "default" : "muted" },
      { label: "Need", value: s.bant.need ?? "Unknown" },
      { label: "Timing", value: s.bant.timingWeeks !== null ? `${s.bant.timingWeeks} weeks` : input.startWeeks !== null ? `${input.startWeeks} weeks (from form)` : "Unknown" },
    ],
  });
  sim.record({
    id: "score_final",
    title: "Final score",
    status: `${sc.total} / 100`,
    tone: sc.total >= QUALIFY_THRESHOLD ? "ok" : "warn",
    fields: scoreFields(sc.parts),
  });
  sim.emit(
    "check_score",
    sc.total >= QUALIFY_THRESHOLD ? "passed" : "info",
    `Final score ${sc.total} (threshold ${QUALIFY_THRESHOLD})`,
    s.bant.budget === null ? "Budget is recorded as unknown and scores 0 — it is not treated as a negative fact." : undefined,
  );
  sim.emit("bant", "passed", "BANT recorded");
  if (sc.total >= QUALIFY_THRESHOLD && sc.fitPass) {
    handoff(sim);
  } else {
    s.step = "done";
    sim.emit("notready", "stopped", "Not ready yet — moved to nurture", "Future trigger: re-check in 30 days or when the customer replies.");
    sim.patch("lead", { status: "Nurture — not ready", tone: "warn", fields: [{ label: "Next trigger", value: "Re-check in 30 days" }] });
    sim.finish("stopped", { kind: "exception", summary: `Score ${sc.total} is below ${QUALIFY_THRESHOLD}. No owner assigned; lead parked with a dated nurture trigger.` });
  }
}

function handoff(sim: Sim<State>) {
  const s = sim.s;
  s.owner = "Priya (sales)";
  const key = `${s.leadId}:handoff`;
  if (!sim.claim(key, "handoff", "handoff")) return;
  s.step = "awaiting_handoff_ack";
  sim.emit("handoff", "waiting", "Handoff brief sent to one owner", "Waiting for owner acknowledgement.", { opKey: key });
  sim.send({ channel: "task", to: s.owner, summary: "Qualified lead handoff brief", status: "simulated", opKey: key });
  sim.patch("lead", { status: "Handed off — awaiting owner", fields: [{ label: "Owner", value: s.owner }] });
  sim.wait("waiting_staff", [
    { id: "ack", label: "Owner: acknowledge handoff", actor: "staff", tone: "primary" },
  ]);
}

function draftOffer(sim: Sim<State>) {
  const s = sim.s;
  s.offerVersion += 1;
  const heads = sim.num("headcount");
  const weekly = heads * PRICE_PER_HEAD;
  sim.record({
    id: "offer",
    title: "Proposed offer",
    ref: `Q-${s.leadId.slice(2)}-v${s.offerVersion}`,
    status: "Draft — awaiting owner approval",
    tone: "warn",
    fields: [
      { label: "Version", value: `v${s.offerVersion}` },
      { label: "Scope", value: `Weekly office catering, ${heads} people` },
      { label: "Price rule", value: `${aud(PRICE_PER_HEAD)} per head (catalogue)` },
      { label: "Weekly total", value: aud(weekly) },
      { label: "First-week deposit", value: aud(weekly) },
    ],
  });
  s.step = "awaiting_offer_approval";
  sim.emit("handoff", "waiting", `Offer v${s.offerVersion} drafted from catalogue price`, "Owner approval required before it can be sent.");
  const actions: Run["actions"] = [];
  if (s.bant.budget === null) {
    sim.emit("check_offer", "blocked", "Priced offer blocked — budget unknown", "Owner can book a discovery call instead of sending a price.");
    actions.push({ id: "discovery", label: "Owner: book discovery call instead", actor: "staff", tone: "primary" });
  } else {
    actions.push({ id: "approve", label: "Owner: approve and send offer", actor: "staff", tone: "primary" });
  }
  actions.push({ id: "reject_offer", label: "Owner: reject offer (close as lost)", actor: "staff", tone: "danger" });
  sim.wait("waiting_staff", actions);
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Interactive simulation using sample business data. No emails are sent, no CRM is written and no payment is taken.",
  assistantName: "Sales assistant",
  channelLabel: "Email thread with the lead",
  fields: [
    { kind: "text", name: "company", label: "Company (fictional)" },
    { kind: "text", name: "email", label: "Contact email", helper: "Use ops@harbourlane.example to trigger the duplicate check." },
    { kind: "select", name: "location", label: "Office location", options: ["Surry Hills", "Sydney CBD", "Parramatta", "North Sydney", "Chatswood", "Newcastle", "Wollongong"], helper: "Newcastle and Wollongong are outside the delivery zone." },
    { kind: "number", name: "headcount", label: "Headcount", min: 1, max: 500, helper: "Minimum order is 10 people." },
    { kind: "text", name: "start_weeks", label: "Start in (weeks)", helper: "Leave blank to test an unknown start date." },
  ],
  scenarios: [
    { id: "qualified", label: "Qualified lead", kind: "success", description: "In-zone office, 40 people, starting in 3 weeks.", inputs: { company: "Brightwell Studio", email: "office@brightwell.example", location: "Surry Hills", headcount: 40, start_weeks: "3" } },
    { id: "missing_budget", label: "Missing budget", kind: "exception", description: "The customer will not name a budget. It must stay unknown.", inputs: { company: "Kestrel Legal", email: "admin@kestrel.example", location: "Sydney CBD", headcount: 25, start_weeks: "6" } },
    { id: "duplicate", label: "Duplicate form", kind: "exception", description: "The same email enquired two weeks ago. One lead must be updated, not two created.", inputs: { company: "Harbour Lane Architects", email: "ops@harbourlane.example", location: "Pyrmont", headcount: 30, start_weeks: "2" } },
    { id: "no_reply", label: "No reply", kind: "exception", description: "Advance the clock and watch the bounded follow-up limit stop outreach.", inputs: { company: "Tidewater Clinic", email: "hello@tidewater.example", location: "Chatswood", headcount: 18, start_weeks: "8" } },
    { id: "poor_fit", label: "Poor fit", kind: "exception", description: "Outside the delivery zone. No owner time is spent.", inputs: { company: "Coastline Freight", email: "team@coastline.example", location: "Newcastle", headcount: 60, start_weeks: "4" } },
  ],
  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("lead-to-sale", scenarioId, inputs, {
      step: "awaiting_reply",
      leadId: "",
      attempts: 0,
      bant: { budget: null, authority: null, need: null, timingWeeks: null },
      offerVersion: 0,
      owner: null,
      initialScore: 0,
      finalScore: null,
    });
    const input = leadInput(sim);
    sim.say("customer", `Website form — ${input.company}: “We’re after weekly catering for about ${input.headcount} people in ${input.location}${input.startWeeks !== null ? `, starting in ${input.startWeeks} weeks` : ""}.”`);

    // 1. Capture and validate
    sim.emit("capture", "started", "Form received", `${input.company} · ${input.email}`);
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email);
    if (!emailOk || !input.company.trim() || input.headcount <= 0) {
      sim.emit("capture", "failed", "Validation failed", !emailOk ? "Email address is not valid." : "Company and headcount are required.");
      sim.record({ id: "lead", title: "Lead record", status: "Rejected at validation", tone: "bad", fields: [{ label: "Reason", value: !emailOk ? "Invalid email" : "Missing required field" }] });
      return sim.finish("failed", { kind: "failed", summary: "The form failed validation, so no lead was created. Fix the inputs and run again." }).done();
    }
    sim.emit("capture", "passed", "Required fields valid");

    const existing = EXISTING_LEADS[input.email];
    if (existing) {
      sim.s.leadId = existing.id;
      const key = `lead:${input.email}`;
      sim.claim(key, "duplicate", "lead");
      sim.emit("duplicate", "info", `Existing lead ${existing.id} matched on email`, `Created ${existing.created}. Updating it instead of creating a second record.`, { ref: existing.id });
      sim.send({ channel: "crm", to: "CRM", summary: `Update ${existing.id} (merge new form fields)`, status: "simulated", opKey: key });
    } else {
      sim.s.leadId = sim.ref("L");
      const key = `lead:${input.email}`;
      sim.claim(key, "capture", "lead");
      sim.send({ channel: "crm", to: "CRM", summary: `Create lead ${sim.s.leadId}`, status: "simulated", opKey: key });
      sim.emit("capture", "confirmed", `Lead ${sim.s.leadId} created`, undefined, { opKey: key, ref: sim.s.leadId });
    }

    sim.record({
      id: "lead",
      title: "CRM opportunity",
      ref: sim.s.leadId,
      status: "New",
      fields: [
        { label: "Company", value: input.company },
        { label: "Contact", value: input.email },
        { label: "Location", value: input.location },
        { label: "Headcount", value: String(input.headcount) },
        { label: "Source", value: "Website form" },
        { label: "Owner", value: "Unassigned", tone: "muted" },
        ...(existing ? [{ label: "Merged with", value: `${existing.id} (${existing.created})`, tone: "warn" as const }] : []),
      ],
    });

    // 2. Initial score and enrichment
    sim.emit("score", "started", "Initial score and enrichment");
    sim.emit("score", "info", "Enrichment (fixture)", `${input.company}: office, ${input.headcount} staff on site. Source: sample directory fixture.`);
    const sc = scoreLead(input, sim.s.bant, false);
    sim.s.initialScore = sc.total;
    sim.record({ id: "score_initial", title: "Initial score", status: `${sc.total} / 100`, fields: scoreFields(sc.parts) });
    sim.emit("check_score", sc.fitPass ? "passed" : "failed", `Service fit ${sc.fitPass ? "passed" : "failed"}`, sc.parts[0].evidence);

    if (!sc.fitPass) {
      sim.s.step = "done";
      sim.emit("poorfit", "stopped", "Poor fit — no sales follow-up", `${sc.parts[0].evidence}. A polite referral note is prepared for the owner to send. No owner is assigned.`);
      sim.send({ channel: "email", to: input.email, summary: "Polite decline with referral (draft for owner)", status: "held" });
      sim.patch("lead", { status: "Closed — poor fit", tone: "bad", fields: [{ label: "Reason", value: sc.parts[0].evidence, tone: "bad" }] });
      return sim.finish("stopped", { kind: "exception", summary: `Service fit failed (${sc.parts[0].evidence}), so the workflow stopped before any automated sales conversation.` }).done();
    }
    sim.emit("score", "passed", `Initial score ${sc.total}`, "Budget and decision access are unknown until the customer says otherwise.");

    // 3. Automated sales conversation
    sim.emit("check_contact", "passed", "Contact permission: enquiry reply allowed", `Max ${MAX_ATTEMPTS} attempts, 2 days apart. Opt-out stops everything.`);
    sendFollowUp(sim);
    return sim.wait("waiting_customer", customerActions()).done();
  },

  act(run, actionId) {
    const sim = Sim.from(run);
    const s = sim.s;
    const heads = sim.num("headcount");

    switch (actionId) {
      case "opt_out": {
        sim.say("customer", "Please stop emailing me about this.");
        s.step = "done";
        sim.emit("check_contact", "stopped", "Opt-out recorded", "All scheduled follow-ups cancelled for this contact.");
        sim.emit("convo", "stopped", "Conversation stopped by opt-out");
        sim.patch("lead", { status: "Closed — opted out", tone: "bad", fields: [{ label: "Contact permission", value: "Withdrawn", tone: "bad" }] });
        return sim.finish("stopped", { kind: "stopped", summary: "The contact opted out. No further messages will be queued for this lead." }).done();
      }

      case "wait": {
        sim.advance(2 * DAY);
        sim.emit("noreply", "info", "No reply within 2 days");
        if (s.attempts >= MAX_ATTEMPTS) {
          s.step = "done";
          sim.emit("noreply", "stopped", `No reply after ${MAX_ATTEMPTS} attempts`, "Contact limit reached. Moved to nurture with a dated trigger.");
          sim.emit("notready", "stopped", "Nurture trigger set for 30 days");
          sim.patch("lead", { status: "Nurture — no reply", tone: "warn", fields: [{ label: "Next trigger", value: "30 days, or any reply" }] });
          return sim.finish("stopped", { kind: "exception", summary: `The lead did not reply to ${MAX_ATTEMPTS} messages. Outreach stopped at the limit instead of continuing indefinitely.` }).done();
        }
        sendFollowUp(sim);
        return sim.wait("waiting_customer", customerActions()).done();
      }

      case "reply_full": {
        sim.advance(3 * HOUR);
        sim.say("customer", "About $14 a head works for us. I’m the office manager but our director signs off. We need it for our Tuesday team lunch.");
        s.bant = { budget: 14, authority: "needs sign-off", need: "Tuesday team lunch, weekly", timingWeeks: s.bant.timingWeeks };
        sim.emit("convo", "passed", "Reply received and classified", "Budget, authority and need stated explicitly.");
        runBantAndScore(sim);
        return sim.done();
      }

      case "reply_no_budget": {
        sim.advance(3 * HOUR);
        sim.say("customer", "Not sure on budget yet — what do you usually charge? I can approve it myself.");
        s.bant = { ...s.bant, authority: "decision maker", need: "Weekly team catering" };
        sim.emit("convo", "info", "Reply received — budget not stated", "Budget stays unknown. One clarifying question allowed.");
        sim.say("assistant", `Our catalogue price for weekly catering starts at ${aud(PRICE_PER_HEAD)} per head. Is there a budget range you’d like us to work within?`);
        sim.send({ channel: "email", to: sim.str("email"), summary: "Budget clarification question", status: "held" });
        s.step = "awaiting_budget";
        return sim
          .wait("waiting_customer", [
            { id: "give_budget", label: "Reply: “Around $16 a head.”", actor: "customer", tone: "primary" },
            { id: "still_unsure", label: "Reply: “Still not sure.”", actor: "customer" },
            { id: "opt_out", label: "Ask them to stop contacting you", actor: "customer", tone: "danger" },
          ])
          .done();
      }

      case "give_budget": {
        sim.advance(2 * HOUR);
        sim.say("customer", "Around $16 a head.");
        s.bant.budget = 16;
        sim.emit("convo", "passed", "Budget stated by customer");
        runBantAndScore(sim);
        return sim.done();
      }

      case "still_unsure": {
        sim.advance(2 * HOUR);
        sim.say("customer", "Still not sure, sorry.");
        sim.emit("convo", "info", "Budget remains unknown", "The assistant does not guess or fill it in.");
        runBantAndScore(sim);
        return sim.done();
      }

      case "ack": {
        sim.say("staff", `${s.owner}: Got it, I’ll take this one.`);
        sim.emit("handoff", "confirmed", `Handoff acknowledged by ${s.owner}`);
        sim.say("system", "Automated follow-up paused: a human now owns this conversation.");
        sim.emit("check_contact", "stopped", "Automated outreach paused on human takeover");
        sim.patch("lead", { status: "Owned by sales", tone: "ok" });
        draftOffer(sim);
        return sim.done();
      }

      case "discovery": {
        s.step = "done";
        sim.emit("check_offer", "passed", "Owner chose discovery call — no price sent");
        sim.patch("offer", { status: "Not sent — discovery call first", tone: "muted" });
        sim.patch("lead", { status: "Pending — discovery call", tone: "warn" });
        sim.send({ channel: "calendar", to: s.owner ?? "Owner", summary: "Discovery call request (unconfirmed)", status: "pending" });
        sim.emit("outcome", "waiting", "Outcome pending", "No won status without an accepted offer and payment event.");
        return sim.finish("completed", { kind: "exception", summary: "Budget stayed unknown, so the owner booked a discovery call instead of sending a price. The opportunity remains pending, not won." }).done();
      }

      case "reject_offer": {
        s.step = "done";
        sim.emit("check_offer", "stopped", "Owner rejected the offer");
        sim.patch("offer", { status: "Rejected by owner", tone: "bad" });
        sim.patch("lead", { status: "Lost — owner declined", tone: "bad" });
        sim.emit("outcome", "stopped", "Closed as lost");
        return sim.finish("completed", { kind: "exception", summary: "The owner declined to make an offer. Nothing was sent to the customer." }).done();
      }

      case "approve": {
        const key = `${s.leadId}:offer:v${s.offerVersion}`;
        if (!sim.claim(key, "check_offer", "offer send")) return sim.done();
        sim.emit("check_offer", "passed", `Owner approved offer v${s.offerVersion}`, undefined, { opKey: key });
        sim.patch("offer", { status: `Sent v${s.offerVersion} — awaiting customer`, tone: "default" });
        sim.send({ channel: "email", to: sim.str("email"), summary: `Offer v${s.offerVersion}: ${aud(heads * PRICE_PER_HEAD)}/week`, status: "held", opKey: key });
        sim.say("staff", `Here’s our offer: weekly catering for ${heads} people at ${aud(PRICE_PER_HEAD)} per head (${aud(heads * PRICE_PER_HEAD)}/week). Pay the first week to lock in your start date.`);
        s.step = "awaiting_customer_offer";
        return sim
          .wait("waiting_customer", [
            { id: "accept_pay", label: "Accept and pay first-week deposit", actor: "customer", tone: "primary" },
            { id: "sounds_great", label: "Reply “Sounds great!” (no payment)", actor: "customer", hint: "Positive sentiment is not a sale." },
            { id: "question", label: "Ask: “Can you add fruit platters?”", actor: "customer" },
            { id: "decline", label: "Decline the offer", actor: "customer", tone: "danger" },
          ])
          .done();
      }

      case "sounds_great": {
        sim.advance(1 * HOUR);
        sim.say("customer", "Sounds great!");
        sim.emit("outcome", "waiting", "Positive reply — still pending", "Won requires an accepted offer and a verified payment event.");
        sim.patch("lead", { status: "Pending — awaiting acceptance", tone: "warn" });
        return sim.done();
      }

      case "question": {
        sim.advance(1 * HOUR);
        sim.say("customer", "Can you add fruit platters every week?");
        sim.emit("questions", "waiting", "Scope question routed to human review", "The assistant does not change scope or price.");
        s.step = "awaiting_question_review";
        return sim
          .wait("waiting_staff", [
            { id: "revise", label: "Owner: add platters (+$3/head) and revise", actor: "staff", tone: "primary" },
          ])
          .done();
      }

      case "revise": {
        s.offerVersion += 1;
        const weekly = heads * (PRICE_PER_HEAD + 3);
        sim.record({
          id: "offer",
          title: "Proposed offer",
          ref: `Q-${s.leadId.slice(2)}-v${s.offerVersion}`,
          status: `Sent v${s.offerVersion} — awaiting customer`,
          fields: [
            { label: "Version", value: `v${s.offerVersion} (supersedes v${s.offerVersion - 1})`, tone: "warn" },
            { label: "Scope", value: `Weekly office catering + fruit platters, ${heads} people` },
            { label: "Price rule", value: `${aud(PRICE_PER_HEAD)} + ${aud(3)} per head (owner approved)` },
            { label: "Weekly total", value: aud(weekly) },
            { label: "First-week deposit", value: aud(weekly) },
          ],
        });
        const key = `${s.leadId}:offer:v${s.offerVersion}`;
        sim.claim(key, "check_offer", "offer send");
        sim.emit("questions", "passed", `Owner revised scope — offer v${s.offerVersion}`, `v${s.offerVersion - 1} is superseded and can no longer be accepted.`, { opKey: key });
        sim.emit("check_offer", "passed", `Owner approved offer v${s.offerVersion}`);
        sim.say("staff", `Updated offer v${s.offerVersion}: catering plus fruit platters at ${aud(PRICE_PER_HEAD + 3)} per head (${aud(weekly)}/week).`);
        sim.send({ channel: "email", to: sim.str("email"), summary: `Offer v${s.offerVersion}: ${aud(weekly)}/week`, status: "held", opKey: key });
        s.step = "awaiting_customer_offer";
        return sim
          .wait("waiting_customer", [
            { id: "accept_pay", label: "Accept and pay first-week deposit", actor: "customer", tone: "primary" },
            { id: "decline", label: "Decline the offer", actor: "customer", tone: "danger" },
          ])
          .done();
      }

      case "accept_pay": {
        sim.advance(4 * HOUR);
        const key = `${s.leadId}:payment:v${s.offerVersion}`;
        if (!sim.claim(key, "outcome", "payment")) return sim.done();
        const pay = sim.ref("PAY");
        sim.say("customer", `Accepted offer v${s.offerVersion} and paid the deposit.`);
        sim.send({ channel: "payment", to: "Payment provider (sandbox)", summary: `Deposit ${pay} succeeded`, status: "simulated", opKey: key });
        sim.emit("check_pay", "passed", `Payment event ${pay} verified`, `References offer v${s.offerVersion}.`, { ref: pay });
        sim.emit("outcome", "confirmed", "Won — accepted and paid", undefined, { opKey: key, ref: pay });
        sim.patch("offer", { status: `Accepted v${s.offerVersion}`, tone: "ok" });
        sim.patch("lead", { status: "Won", tone: "ok", fields: [{ label: "Payment", value: `${pay} (simulated)`, tone: "ok" }] });
        s.step = "done";
        return sim.finish("completed", { kind: "success", summary: `Won: offer v${s.offerVersion} accepted and deposit ${pay} verified. Status changed only after the payment event.` }).done();
      }

      case "decline": {
        sim.advance(2 * HOUR);
        sim.say("customer", "Thanks, but we’ve gone with someone else.");
        sim.emit("outcome", "stopped", "Lost — customer declined");
        sim.patch("offer", { status: "Declined", tone: "bad" });
        sim.patch("lead", { status: "Lost", tone: "bad", fields: [{ label: "Loss reason", value: "Chose another supplier" }] });
        s.step = "done";
        return sim.finish("completed", { kind: "exception", summary: "The customer declined. The opportunity is closed as lost with a recorded reason, and follow-up stops." }).done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const leadToSale: Product = {
  id: "lead-to-sale",
  no: 3,
  slug: "lead-to-sale",
  name: "Lead-to-Sale",
  outcome: "Turn online enquiries into sales-ready opportunities.",
  sectorLabel: "Cross sector with considered purchases",
  sectors: ["Home services", "Local orders"],
  outcomes: ["Capture enquiries", "Convert sales"],
  definition:
    "A connected workflow that captures, validates, scores and enriches each enquiry, runs a bounded automated sales conversation and qualifies it on budget, authority, need and timing. Qualified opportunities go to one named owner and are tracked through to an accepted, paid or lost outcome.",
  situation:
    "An office submits a website form asking for weekly catering. Before making an offer, the owner needs its location, headcount, budget, who approves the purchase and when it should start — and usually has to chase for them between jobs.",
  endState:
    "Every enquiry is recorded once, explained with a score, followed up within limits and either handed to the owner with a clear brief or parked with a reason. The owner only prices opportunities that fit.",
  handles: [
    "Validates the form and merges duplicates into one lead",
    "Scores fit, need, timing, budget and decision access with the evidence shown",
    "Runs up to three follow-ups and stops on reply, opt-out or the limit",
    "Extracts BANT from replies and leaves unknowns unknown",
    "Hands one owner a brief, then tracks the approved offer to won, lost or pending",
  ],
  boundaries: [
    "Never sets a price or scope — the owner approves every offer",
    "Positive sentiment is not a sale; won needs acceptance and a payment event",
    "The public demo sends no outreach and writes to no real CRM",
  ],
  delivered: [
    { title: "CRM opportunity", body: "One record per contact with source, score history, BANT fields, owner and status from new to won or lost." },
    { title: "Owner handoff brief", body: "Company, need, timing, stated budget or ‘unknown’, conversation summary and the recommended next step." },
    { title: "Versioned offer", body: "Owner-approved offer with version number; revisions supersede earlier versions and payment links point to the current one." },
  ],
  deployment: {
    rules: [
      "Your service area, minimums and catalogue prices",
      "Score weights and thresholds calibrated on your past wins and losses",
      "Follow-up timing, channel permissions and attempt limits",
      "Who owns which leads and how handoffs are acknowledged",
    ],
    systems: ["Website forms", "Your CRM", "A verified enrichment provider", "Email or SMS with consent records", "Proposal and payment tools"],
  },
  measures: [
    "Qualified opportunities per week",
    "Attended sales calls",
    "Completed sales and contribution after acquisition and delivery cost",
  ],
  reliability: [
    "Duplicate leads created (target: zero)",
    "Messages sent after opt-out (target: zero)",
    "Handoffs acknowledged within the agreed time",
  ],
  harness: {
    systems:
      "Production uses forms, CRM, a verified enrichment provider, an eligible email/SMS channel, a scheduler and a proposal/payment system. Actual connectors require discovery and access checks. The demo uses fictional enrichment fixtures and an outbox that holds every message.",
    controls: [
      "Preserve lead source and contact permission on every record",
      "Bound attempts and timing; stop on reply, opt-out or human takeover",
      "Explain every score component with its evidence",
      "Require owner approval before any offer is sent",
      "Acknowledge handoff to exactly one owner",
      "Deduplicate every write with an operation key",
    ],
  },
  ctaLine: "Want this following up your actual enquiries?",
  graph: {
    nodes: [
      { id: "capture", kind: "action", row: 0, title: "Capture and validate lead", input: "Website form fields", rule: "Required fields, email format, duplicate lookup by email", output: "Lead record (created or updated)", failure: "Invalid form → rejected, nothing created", system: "Forms + CRM (demo: session fixture)" },
      { id: "score", kind: "action", row: 1, title: "Initial score and enrichment", input: "Lead record", rule: "Deterministic 100-point score; fixture enrichment", output: "Initial score with evidence", failure: "Service fit fails → poor fit stop", system: "Enrichment provider (demo: fixture)" },
      { id: "convo", kind: "action", row: 2, title: "Automated sales conversation", input: "Qualified-to-contact lead", rule: "Max 3 attempts, 2 days apart; constrained questions", output: "Messages in outbox, replies classified", failure: "Opt-out → stop all; no reply → limit", system: "Email/SMS (demo: held outbox)" },
      { id: "bant", kind: "action", row: 3, title: "BANT and final score", input: "Customer replies", rule: "Extract budget, authority, need, timing with evidence", output: "BANT fields + final score", failure: "Below threshold → not ready yet", system: "Session state" },
      { id: "handoff", kind: "action", row: 4, title: "Human handoff and offer", input: "Qualified opportunity", rule: "One owner, acknowledged; offer from catalogue price", output: "Handoff brief + versioned offer", failure: "Scope/price question → human review", system: "CRM tasks + proposal tool (demo: fixture)" },
      { id: "outcome", kind: "action", row: 5, title: "Accepted paid or lost outcome", input: "Customer decision + payment event", rule: "Won only with accepted offer and verified payment", output: "Won / lost / pending status", failure: "No payment → stays pending", system: "Payment provider (demo: simulated event)" },
      { id: "duplicate", kind: "branch", row: 0.35, title: "Duplicate record", input: "Email matches existing lead", rule: "Merge into the existing record", output: "Updated lead, no new record", failure: "—" },
      { id: "poorfit", kind: "branch", row: 1.3, title: "Poor fit", input: "Service fit = 0", rule: "Stop before outreach", output: "Closed lead + referral draft for owner", failure: "—" },
      { id: "noreply", kind: "branch", row: 2.25, title: "No reply within limit", input: "No reply after 2 days", rule: "Retry until 3 attempts, then stop", output: "Nurture with dated trigger", failure: "—" },
      { id: "notready", kind: "branch", row: 3.3, title: "Not ready yet", input: "Final score below 70", rule: "Park with 30-day trigger", output: "Nurture record", failure: "—" },
      { id: "questions", kind: "branch", row: 4.7, title: "Scope or price questions", input: "Customer asks to change scope", rule: "Route to owner; never auto-change price", output: "Revised, owner-approved offer version", failure: "—" },
      { id: "check_score", kind: "check", row: 1, title: "Evidence and score rules", input: "Score components", rule: "Each part cites evidence; unknown ≠ negative", output: "Pass / fail with reason", failure: "Service fit fail stops the run" },
      { id: "check_contact", kind: "check", row: 2.3, title: "Contact and stop rules", input: "Permission, attempts, takeover flag", rule: "Enquiry reply only; max 3; stop on opt-out or human takeover", output: "Allow / stop", failure: "Any stop signal cancels queued messages" },
      { id: "check_offer", kind: "check", row: 4, title: "Owner approved offer", input: "Draft offer", rule: "Owner approval required; no price with unknown budget", output: "Approved offer version", failure: "Blocked → discovery call" },
      { id: "check_pay", kind: "check", row: 5.1, title: "Verified payment event", input: "Payment provider event", rule: "Event must reference the current offer version", output: "Verified payment reference", failure: "Missing/failed → not won" },
    ],
    edges: [
      { from: "capture", to: "score", kind: "flow" },
      { from: "score", to: "convo", kind: "flow" },
      { from: "convo", to: "bant", kind: "flow" },
      { from: "bant", to: "handoff", kind: "flow" },
      { from: "handoff", to: "outcome", kind: "flow" },
      { from: "capture", to: "duplicate", kind: "return" },
      { from: "duplicate", to: "score", kind: "return", label: "merge" },
      { from: "score", to: "poorfit", kind: "return", label: "stop" },
      { from: "convo", to: "noreply", kind: "return" },
      { from: "noreply", to: "convo", kind: "return", label: "timed retry ×3" },
      { from: "bant", to: "notready", kind: "return" },
      { from: "notready", to: "convo", kind: "return", label: "nurture trigger" },
      { from: "handoff", to: "questions", kind: "return" },
      { from: "questions", to: "handoff", kind: "return", label: "human review" },
      { from: "check_score", to: "score", kind: "check" },
      { from: "check_contact", to: "convo", kind: "check" },
      { from: "check_offer", to: "handoff", kind: "check" },
      { from: "check_pay", to: "outcome", kind: "check" },
    ],
  },
  demo,
};
