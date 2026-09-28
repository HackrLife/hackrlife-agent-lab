import type { DemoDefinition, Product, Run } from "../types";
import { Sim, aud, fmtClock, DAY, HOUR, normaliseReply, declines, mentions, negated } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

const DATES = ["Sat 20 Mar 2027", "Sat 27 Mar 2027", "Sat 3 Apr 2027", "Sat 10 Apr 2027"];
/** Events already committed on each date (event capacity fixture). */
const BOOKED: Record<string, number> = { "Sat 20 Mar 2027": 1, "Sat 27 Mar 2027": 2, "Sat 3 Apr 2027": 0, "Sat 10 Apr 2027": 1 };
const MAX_EVENTS_PER_DAY = 2;
const MAX_GUESTS = 250;
const DELIVERY_FEE: Record<string, number> = { Marrickville: 40, Newtown: 60, Balmain: 80, Manly: 140, Bowral: 320 };
const SCOPES = ["Ceremony and reception", "Reception only", "Bridal party only"];
const GUESTS_PER_TABLE = 8;
const MIN_EVENT_VALUE = 1200;
const DEPOSIT_RATE = 0.3;
const HOLD_DAYS = 7;
const FOLLOW_UP_DAYS = 3;
const MAX_FOLLOW_UPS = 2;

interface Pkg {
  id: string;
  name: string;
  perTable: number;
  party: number;
  ceremony: number;
  setup: number;
}

/** Approved package price list (owner-maintained). */
const PACKAGES: Pkg[] = [
  { id: "essential", name: "Essential", perTable: 70, party: 250, ceremony: 300, setup: 200 },
  { id: "classic", name: "Classic", perTable: 95, party: 450, ceremony: 700, setup: 300 },
  { id: "signature", name: "Signature", perTable: 150, party: 750, ceremony: 1400, setup: 400 },
];

type Step = "awaiting_date" | "awaiting_option" | "awaiting_choice" | "awaiting_owner" | "awaiting_customer" | "done";

interface Option {
  pkgId: string;
  name: string;
  scope: string;
  total: number;
  lines: { label: string; amount: number }[];
}

interface Proposal {
  version: number;
  pkgId: string;
  guests: number;
  scope: string;
  total: number;
  deposit: number;
  status: "draft" | "approved" | "superseded" | "accepted" | "declined" | "expired";
  link: string | null;
}

interface State {
  step: Step;
  oppId: string;
  date: string;
  guests: number;
  scope: string;
  options: Option[];
  proposals: Proposal[];
  holdExpires: number | null;
  followUps: number;
  changeRequested: boolean;
  oldLinkTried: boolean;
}

/* ------------------------------------------------------------------ */
/* Deterministic costing                                               */
/* ------------------------------------------------------------------ */

function cost(pkg: Pkg, guests: number, scope: string, location: string): Option {
  const tables = Math.ceil(guests / GUESTS_PER_TABLE);
  const lines: { label: string; amount: number }[] = [];
  if (scope !== "Bridal party only") lines.push({ label: `Table centrepieces × ${tables}`, amount: tables * pkg.perTable });
  lines.push({ label: "Bridal party flowers", amount: pkg.party });
  if (scope === "Ceremony and reception") lines.push({ label: "Ceremony flowers", amount: pkg.ceremony });
  if (scope !== "Bridal party only") lines.push({ label: "On-site setup", amount: pkg.setup });
  lines.push({ label: `Delivery to ${location}`, amount: DELIVERY_FEE[location] ?? 200 });
  return { pkgId: pkg.id, name: pkg.name, scope, total: lines.reduce((a, l) => a + l.amount, 0), lines };
}

function pkgById(id: string): Pkg {
  return PACKAGES.find((p) => p.id === id) ?? PACKAGES[0];
}

function current(s: State): Proposal | undefined {
  return s.proposals[s.proposals.length - 1];
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

function checkCapacityAndFit(sim: Sim<State>) {
  const s = sim.s;
  const budget = sim.num("budget");
  const location = sim.str("location");
  sim.emit("capacity", "started", "Checking event capacity and package fit", `${s.date} · ${s.guests} guests · ${s.scope}`);

  // Date capacity
  const booked = BOOKED[s.date] ?? 0;
  if (booked >= MAX_EVENTS_PER_DAY) {
    const alt = DATES.find((d) => d !== s.date && (BOOKED[d] ?? 0) < MAX_EVENTS_PER_DAY)!;
    sim.emit("check_capacity", "blocked", `Date clash — ${s.date} is fully committed`, `${booked} of ${MAX_EVENTS_PER_DAY} events already booked. No proposal or hold can be made for this date.`);
    sim.emit("noviable", "waiting", "No viable package on this date", `Nearest available date: ${alt}.`);
    sim.patch("opp", { status: "Date unavailable — awaiting customer", tone: "warn", fields: [{ label: "Event date", value: `${s.date} (clash)`, tone: "bad" }] });
    sim.say("assistant", `Thank you. Unfortunately ${s.date} is already fully committed, so we can’t take on another event that day. We do have availability on ${alt}. Would that work, or is your date fixed?`);
    sim.send({ channel: "email", to: sim.str("email"), summary: `Date unavailable — ${alt} offered`, status: "held" });
    s.step = "awaiting_date";
    sim.wait("waiting_customer", [
      { id: "move_date", label: `Move the event to ${alt}`, actor: "customer", tone: "primary", hint: "“We can be flexible — let’s look at that date.”" },
      { id: "date_fixed", label: "Our date is fixed (withdraw)", actor: "customer", tone: "danger" },
    ]);
    return;
  }
  if (s.guests > MAX_GUESTS) {
    sim.emit("check_capacity", "blocked", `Guest count ${s.guests} exceeds the ${MAX_GUESTS}-guest limit`, "Owner feasibility review needed before any price is given.");
    sim.emit("noviable", "stopped", "No viable package — above event size limit");
    sim.patch("opp", { status: "Referred to owner — event size", tone: "warn" });
    s.step = "done";
    sim.finish("stopped", { kind: "exception", summary: `${s.guests} guests is above the ${MAX_GUESTS}-guest limit, so no package was priced. The enquiry was referred to the owner.` });
    return;
  }
  sim.emit("check_capacity", "passed", `Date available (${booked} of ${MAX_EVENTS_PER_DAY} events booked)`);

  // Package costing
  const options = PACKAGES.map((p) => cost(p, s.guests, s.scope, location));
  const affordable = options.filter((o) => o.total <= budget && o.total >= MIN_EVENT_VALUE);
  sim.record({
    id: "options",
    title: "Approved package options",
    status: `${affordable.length} of ${options.length} within budget`,
    tone: affordable.length ? "ok" : "warn",
    fields: options.map((o) => ({
      label: `${o.name} — ${o.scope}`,
      value: `${aud(o.total)} (${o.lines.map((l) => `${l.label} ${aud(l.amount)}`).join("; ")})`,
      tone: o.total <= budget ? ("ok" as const) : ("muted" as const),
    })),
  });

  if (affordable.length) {
    s.options = affordable;
    sim.emit("check_capacity", "passed", `Minimum ${aud(MIN_EVENT_VALUE)} met; ${affordable.length} package(s) within ${aud(budget)}`);
    sim.emit("capacity", "passed", `Package fit: ${affordable.map((o) => o.name).join(", ")}`);
    sim.patch("opp", { status: "Qualified — comparing packages", tone: "ok" });
    sim.say(
      "assistant",
      `Here are the packages that fit your brief and budget: ${affordable.map((o) => `${o.name} at ${aud(o.total)}`).join(" or ")}. Prices come from our approved package list. Which would you like us to prepare a proposal for?`,
    );
    s.step = "awaiting_choice";
    sim.wait("waiting_customer", choiceActions(s));
    return;
  }

  // Two different reasons nothing fits:
  //  (a) the selected scope is worth less than the minimum event order at every package level;
  //  (b) viable packages exist for this scope, but the budget is below the cheapest of them.
  const viable = options.filter((o) => o.total >= MIN_EVENT_VALUE);
  const scopeBelowMin = viable.length === 0;
  const scopeIdx = SCOPES.indexOf(s.scope);
  let suitable: Option | null = null;
  if (scopeBelowMin) {
    const largest = options.reduce((a, b) => (a.total >= b.total ? a : b));
    sim.emit(
      "check_capacity",
      "failed",
      `Selected scope below the ${aud(MIN_EVENT_VALUE)} minimum order`,
      `${s.scope} is worth at most ${aud(largest.total)} at any package level. The ${aud(budget)} budget is not the issue.`,
    );
    // Look for the nearest larger scope that meets the minimum and fits the budget.
    for (const scope of SCOPES.slice(0, scopeIdx).reverse()) {
      const fits = PACKAGES.map((pk) => cost(pk, s.guests, scope, location)).filter((o) => o.total >= MIN_EVENT_VALUE && o.total <= budget);
      if (fits.length) {
        suitable = fits[0];
        break;
      }
    }
  } else {
    const cheapest = viable.reduce((a, b) => (a.total <= b.total ? a : b));
    sim.emit("check_capacity", "failed", `Budget ${aud(budget)} is below the cheapest viable ${s.scope.toLowerCase()} option (${aud(cheapest.total)})`);
    for (const scope of SCOPES.slice(scopeIdx + 1)) {
      const o = cost(PACKAGES[0], s.guests, scope, location);
      if (o.total <= budget && o.total >= MIN_EVENT_VALUE) {
        suitable = o;
        break;
      }
    }
  }
  if (suitable) {
    s.options = [suitable];
    sim.emit(
      "noviable",
      "waiting",
      `Suitable option offered: ${suitable.name}, ${suitable.scope.toLowerCase()}`,
      `${aud(suitable.total)} ${scopeBelowMin ? "meets the minimum order and fits the budget" : `fits the budget and meets the ${aud(MIN_EVENT_VALUE)} minimum`}.`,
    );
    sim.patch("opp", {
      status: scopeBelowMin ? "Scope below minimum order — larger option offered" : "Budget below brief — option offered",
      tone: "warn",
      fields: [{ label: "Reason", value: scopeBelowMin ? `${s.scope} is below the ${aud(MIN_EVENT_VALUE)} minimum event order` : `Budget below the cheapest viable ${s.scope.toLowerCase()} option`, tone: "warn" }],
    });
    const cheapestViable = viable.length ? viable.reduce((a, b) => (a.total <= b.total ? a : b)) : null;
    sim.say(
      "assistant",
      scopeBelowMin
        ? `Thanks for the details. Our event service has a ${aud(MIN_EVENT_VALUE)} minimum order, and ${s.scope.toLowerCase()} for ${s.guests} guests comes to less than that at every package level. Within your ${aud(budget)} budget we could do our ${suitable.name} package for ${suitable.scope.toLowerCase()} at ${aud(suitable.total)}. Would you like a proposal for that?`
        : `Our packages for ${s.scope.toLowerCase()} start at ${aud(cheapestViable!.total)}, above your ${aud(budget)} budget. What we can offer within budget is our ${suitable.name} package for ${suitable.scope.toLowerCase()} at ${aud(suitable.total)}. Would you like a proposal for that?`,
    );
    s.step = "awaiting_option";
    sim.wait("waiting_customer", [
      { id: "take_option", label: `Accept ${suitable.scope.toLowerCase()} option`, actor: "customer", tone: "primary", hint: scopeBelowMin ? "“Good idea — let’s include the reception tables too.”" : "“That works — the reception is the priority.”" },
      { id: "withdraw", label: "Decline the option", actor: "customer", tone: "danger" },
    ]);
    return;
  }
  s.step = "done";
  if (scopeBelowMin) {
    sim.emit("check_capacity", "blocked", `No larger scope meets the ${aud(MIN_EVENT_VALUE)} minimum order within ${aud(budget)}`);
    sim.emit("noviable", "stopped", "No viable package — selected scope below minimum order", "Owner can send the decline or offer shop bouquets instead.");
    sim.send({ channel: "email", to: sim.str("email"), summary: "Polite decline: scope below event minimum order (draft for owner)", status: "held" });
    sim.patch("opp", { status: "Closed — scope below minimum order", tone: "bad", fields: [{ label: "Reason", value: `${s.scope} is below the ${aud(MIN_EVENT_VALUE)} minimum event order`, tone: "bad" }] });
    sim.say("assistant", `Thank you for thinking of us. Our event service has a ${aud(MIN_EVENT_VALUE)} minimum order, and ${s.scope.toLowerCase()} on its own comes in below that. Our shop bouquets may still suit you, and we’d be glad to quote those separately.`);
    sim.finish("stopped", { kind: "exception", summary: `${s.scope} is worth less than the ${aud(MIN_EVENT_VALUE)} minimum event order and no larger scope fits the budget, so the enquiry was declined politely instead of being quoted.` });
    return;
  }
  sim.emit("check_capacity", "blocked", `No package meets the ${aud(MIN_EVENT_VALUE)} minimum within ${aud(budget)}`);
  sim.emit("noviable", "stopped", "No viable package — budget below cheapest viable option", "Owner can send it or suggest a florist who takes smaller events.");
  sim.send({ channel: "email", to: sim.str("email"), summary: "Polite decline: budget below event packages (draft for owner)", status: "held" });
  sim.patch("opp", { status: "Closed — budget below event minimum", tone: "bad", fields: [{ label: "Reason", value: `Budget ${aud(budget)} below every package meeting the ${aud(MIN_EVENT_VALUE)} minimum`, tone: "bad" }] });
  sim.say("assistant", `Thank you for thinking of us. Our event work starts at ${aud(MIN_EVENT_VALUE)}, so we can’t offer an event package within ${aud(budget)}. Our shop bouquets may still suit the bridal party.`);
  sim.finish("stopped", { kind: "exception", summary: `The ${aud(budget)} budget is below every package that meets the ${aud(MIN_EVENT_VALUE)} event minimum, so the enquiry was declined politely instead of being quoted.` });
}

function choiceActions(s: State): Run["actions"] {
  return [
    ...s.options.map((o, i) => ({
      id: `choose_${o.pkgId}`,
      label: `Choose ${o.name} (${aud(o.total)})`,
      actor: "customer" as const,
      ...(i === s.options.length - 1 ? { tone: "primary" as const } : {}),
    })),
    { id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. Which package includes the ceremony arch?" } },
    { id: "withdraw", label: "Not going ahead", actor: "customer", tone: "danger" },
  ];
}

function draftProposal(sim: Sim<State>, pkgId: string) {
  const s = sim.s;
  const location = sim.str("location");
  const o = cost(pkgById(pkgId), s.guests, s.scope, location);
  const prev = current(s);
  const version = (prev?.version ?? 0) + 1;
  const deposit = Math.round(o.total * DEPOSIT_RATE);
  s.proposals.push({ version, pkgId, guests: s.guests, scope: s.scope, total: o.total, deposit, status: "draft", link: null });
  const budget = sim.num("budget");
  sim.record({
    id: "proposal",
    title: "Event proposal",
    ref: `P-${s.oppId.slice(2)}-v${version}`,
    status: `v${version} draft — awaiting owner approval`,
    tone: "warn",
    fields: [
      { label: "Version", value: prev ? `v${version} (supersedes v${prev.version})` : `v${version}`, tone: prev ? "warn" : "default" },
      { label: "Package", value: `${o.name} — ${o.scope}` },
      { label: "Guests", value: String(s.guests) },
      ...o.lines.map((l) => ({ label: l.label, value: aud(l.amount) })),
      { label: "Total", value: aud(o.total), tone: o.total > budget ? "warn" : "default" },
      ...(o.total > budget ? [{ label: "Budget note", value: `${aud(o.total - budget)} above the stated ${aud(budget)}`, tone: "warn" as const }] : []),
      { label: "Deposit (30%)", value: aud(deposit) },
      { label: "Payment link", value: "Not issued until owner approval", tone: "muted" },
    ],
  });
  sim.emit("proposal", "waiting", `Proposal v${version} costed from price list: ${aud(o.total)}`, "Owner approves feasibility, terms and any discount before anything is sent.");
  s.step = "awaiting_owner";
  const acts: Run["actions"] = [
    { id: "approve", label: `Owner: approve and send v${version}`, actor: "staff", tone: "primary" },
    { id: "owner_decline", label: "Owner: decline (not feasible)", actor: "staff", tone: "danger" },
  ];
  if (prev?.link && !s.oldLinkTried) acts.push({ id: "pay_old", label: `Customer pays with the v${prev.version} link`, actor: "customer", hint: "The earlier link is still in their inbox." });
  sim.wait("waiting_staff", acts);
}

function customerProposalActions(s: State, revised: number): Run["actions"] {
  const p = current(s)!;
  const acts: Run["actions"] = [
    { id: "pay_current", label: `Accept v${p.version} and pay ${aud(p.deposit)} deposit`, actor: "customer", tone: "primary" },
  ];
  if (!s.changeRequested && revised > 0 && revised !== s.guests) {
    acts.push({ id: "change_guests", label: `Change guest count to ${revised}`, actor: "customer", hint: "“Our numbers have changed since your proposal.”" });
  }
  const old = s.proposals.find((x) => x.version < p.version && x.link);
  if (old && !s.oldLinkTried) acts.push({ id: "pay_old", label: `Pay with the old v${old.version} link`, actor: "customer" });
  acts.push({ id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. Can we add buttonholes?" } });
  acts.push({ id: "wait", label: `Advance clock ${FOLLOW_UP_DAYS} days (no reply)`, actor: "clock" });
  acts.push({ id: "decline", label: "Decline the proposal", actor: "customer", tone: "danger" });
  return acts;
}

function holdLabel(s: State): string {
  return s.holdExpires === null ? "None" : `${s.date} held until ${fmtClock(s.holdExpires)}`;
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary:
    "Interactive simulation using a sample event calendar and price list. No email is sent, no date is really held and no payment is taken.",
  assistantName: "Event assistant",
  channelLabel: "Email thread with the couple",
  fields: [
    { kind: "text", name: "couple", label: "Enquiry from (fictional)" },
    { kind: "text", name: "email", label: "Contact email" },
    { kind: "select", name: "event_date", label: "Event date", options: DATES, helper: "Sat 27 Mar 2027 is already fully committed (date clash)." },
    { kind: "number", name: "guest_count", label: "Guest count", min: 1, max: 400 },
    { kind: "select", name: "location", label: "Venue location", options: Object.keys(DELIVERY_FEE), helper: "Delivery fee is set per location in the price list." },
    { kind: "number", name: "budget", label: "Flower budget", min: 0, max: 20000, step: 50, suffix: "A$" },
    { kind: "select", name: "scope", label: "Scope", options: SCOPES },
    { kind: "number", name: "revised_guest_count", label: "Guest count after proposal", min: 0, max: 400, helper: "Used when the customer requests a change. 0 = no change." },
  ],
  scenarios: [
    { id: "wedding", label: "Wedding for 80 guests", kind: "success", description: "Ceremony and reception in Newtown, A$3,000 budget. Guest count rises to 100 after the first proposal.", inputs: { couple: "Ava & Sam Roper", email: "ava.roper@mail.example", event_date: "Sat 20 Mar 2027", guest_count: 80, location: "Newtown", budget: 3000, scope: "Ceremony and reception", revised_guest_count: 100 } },
    { id: "date_clash", label: "Date clash", kind: "exception", description: "The requested date is already fully committed. No hold or proposal until the date changes.", inputs: { couple: "Lena & Tom Hartley", email: "lena.hartley@mail.example", event_date: "Sat 27 Mar 2027", guest_count: 70, location: "Balmain", budget: 3500, scope: "Ceremony and reception", revised_guest_count: 0 } },
    { id: "tight_budget", label: "Budget below brief", kind: "exception", description: "A$1,300 does not cover ceremony and reception. A suitable reception-only option is offered.", inputs: { couple: "Priya & Josh Nair", email: "priya.nair@mail.example", event_date: "Sat 10 Apr 2027", guest_count: 80, location: "Newtown", budget: 1300, scope: "Ceremony and reception", revised_guest_count: 0 } },
    { id: "below_minimum", label: "Below event minimum", kind: "exception", description: "A$800 is below every package that meets the event minimum. Declined politely.", inputs: { couple: "Kira Blake", email: "kira.blake@mail.example", event_date: "Sat 3 Apr 2027", guest_count: 40, location: "Marrickville", budget: 800, scope: "Ceremony and reception", revised_guest_count: 0 } },
    { id: "no_response", label: "Hold expires", kind: "exception", description: "Proposal sent, then no reply. Bounded follow-ups, then the date hold expires.", inputs: { couple: "Maya & Luca Ferri", email: "maya.ferri@mail.example", event_date: "Sat 3 Apr 2027", guest_count: 60, location: "Manly", budget: 4000, scope: "Reception only", revised_guest_count: 0 } },
  ],

  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("event-sales-assistant", scenarioId, inputs, {
      step: "awaiting_choice",
      oppId: "",
      date: "",
      guests: 0,
      scope: "",
      options: [],
      proposals: [],
      holdExpires: null,
      followUps: 0,
      changeRequested: false,
      oldLinkTried: false,
    });
    const s = sim.s;
    s.date = sim.str("event_date");
    s.guests = Math.round(sim.num("guest_count"));
    s.scope = SCOPES.includes(sim.str("scope")) ? sim.str("scope") : SCOPES[0];
    const budget = sim.num("budget");
    const location = sim.str("location");

    sim.say("customer", `Enquiry from ${sim.str("couple")}: “We’re getting married on ${s.date} and need flowers for ${s.guests} guests — ${s.scope.toLowerCase()} in ${location}, with delivery and setup. Our budget is about ${aud(budget)}.”`);
    sim.emit("enquiry", "started", "Event enquiry received", `${sim.str("couple")} · ${sim.str("email")}`);

    // Qualify date, budget and scope
    sim.emit("qualify", "started", "Building the event brief");
    const problems: string[] = [];
    if (!DATES.includes(s.date)) problems.push("event date");
    if (!(s.guests > 0)) problems.push("guest count");
    if (!(budget > 0)) problems.push("budget");
    if (!(location in DELIVERY_FEE)) problems.push("location");
    if (problems.length) {
      sim.emit("qualify", "failed", "Brief incomplete", `Missing or invalid: ${problems.join(", ")}.`);
      sim.record({ id: "opp", title: "Event opportunity", status: "Incomplete brief", tone: "bad", fields: [{ label: "Missing", value: problems.join(", ") }] });
      return sim.finish("failed", { kind: "failed", summary: `The brief is missing ${problems.join(", ")}, so nothing was costed. Fix the inputs and run again.` }).done();
    }
    s.oppId = sim.ref("EV");
    const key = `opp:${sim.str("email").toLowerCase()}:${s.date}`;
    sim.claim(key, "enquiry", "opportunity");
    sim.send({ channel: "crm", to: "Lead CRM", summary: `Create event opportunity ${s.oppId}`, status: "simulated", opKey: key });
    sim.emit("enquiry", "confirmed", `Opportunity ${s.oppId} created`, undefined, { opKey: key, ref: s.oppId });
    sim.record({
      id: "opp",
      title: "Event opportunity",
      ref: s.oppId,
      status: "Brief complete",
      fields: [
        { label: "Customer", value: `${sim.str("couple")} (${sim.str("email")})` },
        { label: "Event date", value: s.date },
        { label: "Guests", value: String(s.guests) },
        { label: "Venue", value: location },
        { label: "Scope", value: `${s.scope}, delivery and setup` },
        { label: "Stated budget", value: aud(budget) },
        { label: "Date hold", value: "None", tone: "muted" },
        { label: "Follow-ups", value: `0 of ${MAX_FOLLOW_UPS}` },
      ],
    });
    sim.emit("qualify", "passed", "Brief complete: date, guests, venue, budget and scope");

    checkCapacityAndFit(sim);
    return sim.done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;
    const revised = Math.round(sim.num("revised_guest_count"));

    const choose = (pkgId: string) => {
      const o = s.options.find((x) => x.pkgId === pkgId)!;
      sim.say("customer", `Let’s go with ${o.name}, please.`);
      sim.emit("qualify", "passed", `Customer chose ${o.name}`);
      draftProposal(sim, pkgId);
    };

    if (actionId.startsWith("choose_")) {
      const pkgId = actionId.slice(7);
      if (s.step === "awaiting_choice" && s.options.some((o) => o.pkgId === pkgId)) choose(pkgId);
      return sim.done();
    }

    switch (actionId) {
      case "move_date": {
        const alt = DATES.find((d) => d !== s.date && (BOOKED[d] ?? 0) < MAX_EVENTS_PER_DAY)!;
        sim.advance(2 * HOUR);
        sim.say("customer", `We can be flexible — ${alt} works for us.`);
        sim.emit("noviable", "info", `Date revised to ${alt}`, "Brief updated; capacity rechecked before any proposal.");
        s.date = alt;
        sim.patch("opp", { fields: [{ label: "Event date", value: `${alt} (revised)` }] });
        sim.emit("qualify", "passed", "Brief revised with new date");
        checkCapacityAndFit(sim);
        return sim.done();
      }

      case "date_fixed": {
        sim.say("customer", "Our venue is booked for that date, so it has to be that day.");
        s.step = "done";
        sim.emit("noviable", "stopped", "Customer withdrew — date fixed and unavailable");
        sim.patch("opp", { status: "Closed — date unavailable", tone: "bad" });
        return sim.finish("stopped", { kind: "exception", summary: `${s.date} was already fully committed and the customer could not move it, so no proposal or booking was made.` }).done();
      }

      case "take_option": {
        const o = s.options[0];
        sim.say("customer", "That works — the reception is the priority for us.");
        s.scope = o.scope;
        sim.emit("noviable", "passed", `Scope revised to ${o.scope.toLowerCase()}`, "revise scope");
        sim.patch("opp", { status: "Qualified — reduced scope", tone: "ok", fields: [{ label: "Scope", value: `${o.scope} (revised to fit budget)`, tone: "warn" }] });
        sim.emit("qualify", "passed", "Brief revised to fit budget");
        draftProposal(sim, o.pkgId);
        return sim.done();
      }

      case "withdraw": {
        sim.say("customer", "Thanks, but we won’t go ahead.");
        s.step = "done";
        sim.emit("followup", "stopped", "Customer withdrew before a proposal");
        sim.patch("opp", { status: "Closed — customer withdrew", tone: "bad" });
        return sim.finish("stopped", { kind: "stopped", summary: "The customer withdrew before any proposal, so no date was held and follow-up stopped." }).done();
      }

      case "free": {
        const text = (payload ?? "").trim();
        const t = normaliseReply(text);
        sim.say("customer", text || "(empty message)");
        const cancelRe = /\b(cancel|withdraw|call it off)\b/;
        if (declines(t) || (mentions(t, cancelRe) && !negated(t, cancelRe))) {
          s.step = "done";
          sim.emit("followup", "stopped", "Customer asked to stop", "All follow-ups cancelled.");
          const p = current(s);
          if (p) sim.patch("proposal", { status: `v${p.version} withdrawn by customer`, tone: "bad" });
          if (s.holdExpires !== null) {
            s.holdExpires = null;
            sim.patch("opp", { fields: [{ label: "Date hold", value: "Released", tone: "muted" }] });
          }
          sim.patch("opp", { status: "Closed — customer declined", tone: "bad" });
          return sim.finish("stopped", { kind: "stopped", summary: "The customer asked to stop. Follow-ups are cancelled and any date hold is released." }).done();
        }
        if (s.step === "awaiting_choice") {
          const pkgRe = (name: string) => new RegExp(`\\b${name.toLowerCase()}\\b`);
          const named = s.options.find((o) => mentions(t, pkgRe(o.name)) && !negated(t, pkgRe(o.name)));
          if (named) {
            choose(named.pkgId);
            return sim.done();
          }
          const other = PACKAGES.find((p) => !s.options.some((o) => o.pkgId === p.id) && mentions(t, pkgRe(p.name)) && !negated(t, pkgRe(p.name)));
          if (other) {
            sim.say("assistant", `${other.name} isn’t one of the options that fit your brief and ${aud(sim.num("budget"))} budget. I can only prepare proposals from the packages listed, or you can tell us a different budget or scope and we’ll recost.`);
            sim.emit("qualify", "info", `Package outside the fitting options requested (${other.name}) — not offered`);
          } else if (/cheap|less|lower|budget|discount/.test(t)) {
            const low = s.options.reduce((a, b) => (a.total <= b.total ? a : b));
            sim.say("assistant", `The lowest-cost approved option for your brief is ${low.name} at ${aud(low.total)}. Any discount is up to the owner, who reviews every proposal before it is sent.`);
            sim.emit("qualify", "info", "Price question answered from the price list", "Discounts are owner decisions.");
          } else {
            sim.say("assistant", `Sorry, I want to be sure I get this right — which package would you like: ${s.options.map((o) => o.name).join(" or ")}? If you have a question about what’s included, the owner can call you.`);
            sim.emit("qualify", "info", "Reply not understood — clarifying question asked");
          }
          return sim.wait("waiting_customer", choiceActions(s)).done();
        }
        if (s.step === "awaiting_customer") {
          const m = t.match(/(\d{1,3})\s*(guests|people)/);
          if (m) {
            sim.say("assistant", `Thanks — a change to ${m[1]} guests changes the price, so the owner will need to recost and approve a new version. Please use the change request so we record it properly.`);
            sim.emit("followup", "info", "Guest change mentioned — routed to a formal change request");
          } else {
            sim.say("assistant", "Thanks for your message. I’ve passed it to the owner, who will reply personally. Your proposal and date hold are unchanged.");
            sim.send({ channel: "task", to: "Owner", summary: `Customer question on ${s.oppId}`, status: "simulated" });
            sim.emit("followup", "info", "Question handed to owner", "The assistant does not change scope, price or terms.");
          }
          return sim.wait("waiting_customer", customerProposalActions(s, revised)).done();
        }
        return sim.done();
      }

      case "approve": {
        const p = current(s)!;
        const key = `${s.oppId}:proposal:v${p.version}`;
        if (!sim.claim(key, "check_owner", "proposal send")) return sim.done();
        p.status = "approved";
        p.link = `PL-${s.oppId.slice(3)}-v${p.version}`;
        sim.emit("check_owner", "passed", `Owner approved proposal v${p.version}`, "Feasibility, terms and total confirmed.", { opKey: key });
        if (s.holdExpires === null) {
          s.holdExpires = sim.run.clock + HOLD_DAYS * DAY;
          sim.send({ channel: "calendar", to: "Event calendar", summary: `Provisional hold ${s.date} (${HOLD_DAYS} days)`, status: "simulated", opKey: `${s.oppId}:hold` });
          sim.emit("proposal", "info", `Date hold placed for ${HOLD_DAYS} days`, `Expires ${fmtClock(s.holdExpires)}. A hold is not a booking.`);
        }
        sim.send({ channel: "email", to: sim.str("email"), summary: `Proposal v${p.version}: ${aud(p.total)}, deposit link ${p.link}`, status: "held", opKey: key });
        sim.emit("proposal", "confirmed", `Proposal v${p.version} sent with payment link ${p.link}`, undefined, { ref: p.link });
        sim.patch("proposal", { status: `v${p.version} sent — awaiting customer`, tone: "default", fields: [{ label: "Payment link", value: `${p.link} (references v${p.version} only)` }] });
        sim.patch("opp", { status: "Proposal sent", tone: "default", fields: [{ label: "Date hold", value: holdLabel(s), tone: "warn" }] });
        sim.say("staff", `Here is proposal v${p.version}: ${pkgById(p.pkgId).name}, ${p.scope.toLowerCase()} for ${p.guests} guests, ${aud(p.total)}. A ${aud(p.deposit)} deposit confirms your date; we’re holding ${s.date} for you for ${HOLD_DAYS} days.`);
        s.step = "awaiting_customer";
        sim.emit("followup", "waiting", "Waiting for the customer’s decision");
        return sim.wait("waiting_customer", customerProposalActions(s, revised)).done();
      }

      case "owner_decline": {
        const p = current(s)!;
        p.status = "declined";
        s.step = "done";
        sim.emit("check_owner", "stopped", `Owner declined proposal v${p.version}`, "Nothing new was sent to the customer.");
        sim.patch("proposal", { status: `v${p.version} declined by owner`, tone: "bad" });
        if (s.holdExpires !== null) {
          s.holdExpires = null;
          sim.patch("opp", { fields: [{ label: "Date hold", value: "Released", tone: "muted" }] });
        }
        sim.patch("opp", { status: "Closed — owner declined", tone: "bad" });
        return sim.finish("completed", { kind: "exception", summary: `The owner judged v${p.version} not feasible, so no proposal was sent and no booking exists.` }).done();
      }

      case "change_guests": {
        if (s.changeRequested) return sim.done();
        sim.advance(1 * DAY);
        const old = current(s)!;
        sim.say("customer", `Our numbers have changed — we’re now expecting ${revised} guests.`);
        s.changeRequested = true;
        sim.emit("followup", "info", `Change requested: ${old.guests} → ${revised} guests`);
        old.status = "superseded";
        sim.emit("scopechg", "info", `Scope changed — v${old.version} total ${aud(old.total)} invalidated`, `Payment link ${old.link} can no longer be used.`);
        s.guests = revised;
        sim.patch("opp", { fields: [{ label: "Guests", value: `${revised} (changed from ${old.guests})`, tone: "warn" }] });
        // recost: recheck capacity and cost
        if (s.guests > MAX_GUESTS) {
          sim.emit("check_capacity", "blocked", `Guest count ${s.guests} exceeds the ${MAX_GUESTS}-guest limit`);
          sim.emit("scopechg", "stopped", "Change not feasible — referred to owner");
          sim.patch("proposal", { status: `v${old.version} superseded — change referred to owner`, tone: "bad" });
          s.step = "done";
          return sim.finish("stopped", { kind: "exception", summary: `The change to ${s.guests} guests is above the event limit. v${old.version} is invalid and the owner will contact the customer.` }).done();
        }
        sim.emit("check_capacity", "passed", `Recheck: ${s.date} still held; ${s.guests} guests within limit`);
        sim.emit("capacity", "passed", `Recosted ${pkgById(old.pkgId).name} for ${s.guests} guests`, "recost");
        draftProposal(sim, old.pkgId);
        return sim.done();
      }

      case "pay_old": {
        const p = current(s)!;
        const old = [...s.proposals].reverse().find((x) => x.version < p.version && x.link)!;
        s.oldLinkTried = true;
        sim.say("customer", `(Clicks the deposit link from the v${old.version} email and tries to pay ${aud(old.deposit)}.)`);
        sim.send({ channel: "payment", to: "Payment provider (sandbox)", summary: `Deposit on ${old.link} rejected — no charge`, status: "failed" });
        sim.emit("check_payment", "blocked", `Payment rejected — link ${old.link} references superseded v${old.version}`, `Only the current proposal v${p.version} can be paid${p.status === "approved" ? "" : " once the owner approves it"}.`);
        sim.say("assistant", `That payment link was for an earlier version of your proposal, so nothing was charged. ${p.status === "approved" ? `Please use the link in proposal v${p.version}.` : `Your updated proposal v${p.version} is with the owner and will arrive with a new link.`}`);
        if (s.step === "awaiting_owner") {
          return sim
            .wait("waiting_staff", [
              { id: "approve", label: `Owner: approve and send v${p.version}`, actor: "staff", tone: "primary" },
              { id: "owner_decline", label: "Owner: decline (not feasible)", actor: "staff", tone: "danger" },
            ])
            .done();
        }
        return sim.wait("waiting_customer", customerProposalActions(s, revised)).done();
      }

      case "wait": {
        sim.advance(FOLLOW_UP_DAYS * DAY);
        const p = current(s)!;
        sim.emit("noresponse", "info", `No reply after ${FOLLOW_UP_DAYS} days`);
        if (s.holdExpires !== null && sim.run.clock >= s.holdExpires) {
          s.step = "done";
          p.status = "expired";
          s.holdExpires = null;
          sim.send({ channel: "calendar", to: "Event calendar", summary: `Release hold on ${s.date}`, status: "simulated", opKey: `${s.oppId}:hold_release` });
          sim.emit("check_owner", "stopped", `Date hold expired — ${s.date} released`, `Proposal v${p.version} expired with the hold.`);
          sim.emit("noresponse", "stopped", `No response after ${s.followUps} follow-ups — opportunity closed`);
          sim.patch("proposal", { status: `v${p.version} expired`, tone: "bad", fields: [{ label: "Payment link", value: `${p.link} (expired)`, tone: "bad" }] });
          sim.patch("opp", { status: "Closed — no response, hold expired", tone: "bad", fields: [{ label: "Date hold", value: "Expired and released", tone: "bad" }] });
          return sim.finish("stopped", { kind: "exception", summary: `The customer did not reply before the ${HOLD_DAYS}-day hold expired. The date was released and proposal v${p.version} can no longer be paid.` }).done();
        }
        if (s.followUps < MAX_FOLLOW_UPS) {
          s.followUps += 1;
          const key = `${s.oppId}:followup:${s.followUps}`;
          if (sim.claim(key, "noresponse", "follow-up")) {
            sim.say("assistant", `Just a reminder that we’re holding ${s.date} for you until ${fmtClock(s.holdExpires ?? 0)}. Proposal v${p.version} and its deposit link are ready whenever you are.`);
            sim.send({ channel: "email", to: sim.str("email"), summary: `Follow-up ${s.followUps} of ${MAX_FOLLOW_UPS} (hold reminder)`, status: "held", opKey: key });
            sim.emit("followup", "waiting", `Follow-up ${s.followUps} of ${MAX_FOLLOW_UPS} queued`, "bounded follow-up", { opKey: key });
          }
        } else {
          sim.emit("noresponse", "info", "Follow-up limit reached — no further messages", `Hold still expires ${fmtClock(s.holdExpires ?? 0)}.`);
        }
        sim.patch("opp", { fields: [{ label: "Follow-ups", value: `${s.followUps} of ${MAX_FOLLOW_UPS}` }] });
        return sim.wait("waiting_customer", customerProposalActions(s, revised)).done();
      }

      case "decline": {
        sim.advance(2 * HOUR);
        const p = current(s)!;
        p.status = "declined";
        sim.say("customer", "Thank you, but we’ve decided to go with another florist.");
        s.step = "done";
        s.holdExpires = null;
        sim.send({ channel: "calendar", to: "Event calendar", summary: `Release hold on ${s.date}`, status: "simulated", opKey: `${s.oppId}:hold_release` });
        sim.emit("followup", "stopped", "Customer declined — follow-up stopped");
        sim.patch("proposal", { status: `v${p.version} declined by customer`, tone: "bad" });
        sim.patch("opp", { status: "Lost — chose another supplier", tone: "bad", fields: [{ label: "Date hold", value: "Released", tone: "muted" }] });
        return sim.finish("completed", { kind: "exception", summary: "The customer declined the proposal. The date hold was released and follow-up stopped." }).done();
      }

      case "pay_current": {
        const p = current(s)!;
        sim.advance(3 * HOUR);
        if (p.status !== "approved" || !p.link) {
          sim.emit("check_payment", "blocked", `Payment blocked — v${p.version} is not owner-approved`);
          return sim.done();
        }
        if (s.holdExpires === null || sim.run.clock >= s.holdExpires) {
          sim.emit("check_payment", "blocked", "Payment blocked — date hold has expired");
          return sim.done();
        }
        if ((BOOKED[s.date] ?? 0) >= MAX_EVENTS_PER_DAY) {
          sim.emit("check_capacity", "blocked", `Date clash — ${s.date} no longer available`);
          return sim.done();
        }
        const key = `${s.oppId}:deposit:v${p.version}`;
        if (!sim.claim(key, "booking", "deposit")) return sim.done();
        const pay = sim.ref("PAY");
        sim.say("customer", `We accept proposal v${p.version} — deposit paid.`);
        sim.send({ channel: "payment", to: "Payment provider (sandbox)", summary: `Deposit ${aud(p.deposit)} on ${p.link} succeeded (${pay})`, status: "simulated", opKey: key });
        sim.emit("check_payment", "passed", `Payment ${pay} verified against current proposal v${p.version}`, `Link ${p.link}; owner-approved; accepted by customer.`, { ref: pay });
        p.status = "accepted";
        const bk = sim.ref("BK");
        const calKey = `${s.oppId}:booking`;
        sim.claim(calKey, "booking", "booking");
        sim.send({ channel: "calendar", to: "Event calendar", summary: `Confirm ${s.date} — ${bk} (hold converted)`, status: "simulated", opKey: calKey });
        sim.emit("booking", "confirmed", `Booking ${bk} recorded — deposit paid`, `${s.date}, ${p.guests} guests.`, { opKey: calKey, ref: bk });
        sim.record({
          id: "booking",
          title: "Event booking",
          ref: bk,
          status: "Confirmed — deposit paid",
          tone: "ok",
          fields: [
            { label: "Event", value: `${s.date}, ${sim.str("location")}` },
            { label: "Proposal", value: `v${p.version} — ${pkgById(p.pkgId).name}, ${p.scope.toLowerCase()}, ${p.guests} guests` },
            { label: "Total", value: aud(p.total) },
            { label: "Deposit", value: `${aud(p.deposit)} (${pay}, simulated)`, tone: "ok" },
            { label: "Balance due", value: `${aud(p.total - p.deposit)} before the event` },
          ],
        });
        sim.patch("proposal", { status: `v${p.version} accepted`, tone: "ok" });
        sim.patch("opp", { status: "Won — booked", tone: "ok", fields: [{ label: "Date hold", value: `Converted to booking ${bk}`, tone: "ok" }] });
        s.step = "done";
        return sim.finish("completed", { kind: "success", summary: `Booking ${bk} confirmed after the owner approved v${p.version} and the deposit ${pay} was verified against that version.` }).done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const eventSalesAssistant: Product = {
  id: "event-sales-assistant",
  no: 18,
  slug: "event-sales-assistant",
  name: "Event Sales Assistant",
  outcome: "Move event enquiries from brief to booking.",
  sectorLabel: "Florists caterers and occasion businesses",
  sectors: ["Local orders"],
  outcomes: ["Convert sales"],
  definition:
    "Qualifies an event enquiry on date, guest numbers, venue, budget and scope, then prepares priced options from the business’s approved packages. It keeps every proposal revision versioned and tied to the latest requirements, so only the current, owner-approved version can be accepted and paid.",
  situation:
    "A couple emails a florist about their wedding: flowers for 80 guests, ceremony and reception, delivered and set up in Newtown on a set date with a A$3,000 budget. After the proposal goes out, their guest count rises to 100, and the old price and payment link are still sitting in their inbox.",
  endState:
    "Each event enquiry has a complete brief, a clear capacity answer and a proposal costed from the price list. Revisions supersede earlier versions, the owner approves every version before it is sent, and a booking exists only when the current proposal is accepted and its deposit is paid.",
  handles: [
    "Builds the event brief and checks the date against committed events",
    "Costs approved packages by guest count, scope and venue delivery fee",
    "Offers a suitable smaller option or a polite decline when the budget is below the minimum",
    "Versions each proposal after a change and invalidates the old total and payment link",
    "Holds the date for a fixed period, follows up twice and releases the hold on expiry",
  ],
  boundaries: [
    "Never sets custom terms, feasibility or discounts — the owner approves every version",
    "Does not hold or commit a date that is already fully booked",
    "A positive reply is not a booking; booking needs the current version accepted and a verified deposit",
  ],
  delivered: [
    { title: "Proposal and deposit link", body: "Owner-approved proposal with version number, itemised package costs, deposit amount and a payment link that works only for that version." },
    { title: "Owner approval request", body: "Each drafted version arrives with the brief, the costing lines, any budget gap and approve or decline options." },
    { title: "Event opportunity and booking", body: "One record per enquiry with brief, date hold and expiry, follow-up count and the confirmed booking with deposit reference." },
  ],
  deployment: {
    rules: [
      "Your package list, per-table and per-guest pricing and delivery fees",
      "Events per day, maximum event size and minimum event value",
      "Deposit percentage, date hold length and follow-up timing",
      "Which changes need owner approval and who approves",
    ],
    systems: ["Lead CRM", "Event calendar and capacity", "Package price list", "Proposal tool", "Email or messaging", "Payment provider"],
  },
  measures: ["Event enquiries converted to paid bookings", "Expected contribution per event", "Time from enquiry to approved proposal"],
  reliability: [
    "Payments accepted against a superseded proposal (target: zero)",
    "Bookings on dates already at capacity (target: zero)",
    "Holds left open after expiry (target: zero)",
  ],
  harness: {
    systems:
      "Production uses a lead CRM, event capacity calendar, package price list, proposals, messaging and payments. The demo uses a sample calendar and price list, an outbox that holds every message and a sandbox payment event.",
    controls: [
      "Date capacity checked before any hold or commitment",
      "Minimum event value enforced; below-minimum budgets get a suitable option or a decline",
      "Every scope change creates a new version and invalidates the old total",
      "Owner approval required for each version before it is sent",
      "Deposit accepted only against the current, approved proposal and within the date hold",
    ],
  },
  ctaLine: "Want this preparing proposals from your own packages and calendar?",
  graph: {
    nodes: [
      { id: "enquiry", kind: "action", row: 0, title: "Event enquiry", input: "Customer email or form", rule: "Create one opportunity per contact and date", output: "Event opportunity record", failure: "—", system: "Lead CRM (demo: session record)" },
      { id: "qualify", kind: "action", row: 1, title: "Qualify date budget and scope", input: "Date, guests, venue, budget, scope", rule: "All brief fields required; choice must be an offered package", output: "Complete event brief", failure: "Missing field → brief incomplete", system: "Session state" },
      { id: "capacity", kind: "action", row: 2, title: "Check capacity and package fit", input: "Brief", rule: "Events per day, size limit, price list costing, minimum value", output: "Priced options within budget", failure: "Clash or no viable package → branch", system: "Event calendar + price list (demo: fixtures)" },
      { id: "proposal", kind: "action", row: 3, title: "Prepare owner approved proposal", input: "Chosen package", rule: "Rule-based costing, 30% deposit, versioned", output: "Proposal vN + payment link + date hold", failure: "Owner declines → nothing sent", system: "Proposal tool (demo: fixture)" },
      { id: "followup", kind: "action", row: 4, title: "Follow up and handle changes", input: "Sent proposal", rule: "Max 2 follow-ups; changes become a new version", output: "Follow-up state, change requests", failure: "Stop on decline or request", system: "Email (demo: held outbox)" },
      { id: "booking", kind: "action", row: 5, title: "Record accepted deposit paid booking", input: "Accepted current version + payment event", rule: "Booking only after verified deposit on current approved version", output: "Booking with deposit reference", failure: "No payment → stays pending", system: "Calendar + payments (demo: sandbox)" },
      { id: "noviable", kind: "branch", row: 1.4, title: "No viable package", input: "Date clash or budget below options", rule: "Offer another date or smaller scope; else decline", output: "Revised brief or polite decline", failure: "—" },
      { id: "scopechg", kind: "branch", row: 2.8, title: "Scope changed", input: "Guest count or scope change after proposal", rule: "Invalidate old total and link; recost", output: "New draft version", failure: "—" },
      { id: "noresponse", kind: "branch", row: 4.4, title: "No response", input: "No reply after 3 days", rule: "Up to 2 follow-ups; hold expires after 7 days", output: "Follow-up or released hold", failure: "—" },
      { id: "check_capacity", kind: "check", row: 1.6, title: "Capacity and minimums", input: "Date, guest count, costed options", rule: "Date below daily limit; value ≥ A$1,200", output: "Pass / blocked with reason", failure: "Clash → no commitment" },
      { id: "check_owner", kind: "check", row: 3.2, title: "Owner and version approval", input: "Draft version, date hold", rule: "Owner approves each version; hold expires on time", output: "Approved version with link", failure: "Declined or expired → stop" },
      { id: "check_payment", kind: "check", row: 5, title: "Current proposal payment", input: "Payment attempt", rule: "Link must reference the current approved version", output: "Verified payment reference", failure: "Old version → rejected, no charge" },
    ],
    edges: [
      { from: "enquiry", to: "qualify", kind: "flow" },
      { from: "qualify", to: "capacity", kind: "flow" },
      { from: "capacity", to: "proposal", kind: "flow" },
      { from: "proposal", to: "followup", kind: "flow" },
      { from: "followup", to: "booking", kind: "flow" },
      { from: "capacity", to: "noviable", kind: "return" },
      { from: "noviable", to: "qualify", kind: "return", label: "revise scope" },
      { from: "followup", to: "scopechg", kind: "return" },
      { from: "scopechg", to: "capacity", kind: "return", label: "recost" },
      { from: "followup", to: "noresponse", kind: "return" },
      { from: "noresponse", to: "followup", kind: "return", label: "bounded follow-up" },
      { from: "check_capacity", to: "capacity", kind: "check" },
      { from: "check_owner", to: "proposal", kind: "check" },
      { from: "check_payment", to: "booking", kind: "check" },
    ],
  },
  demo,
};
