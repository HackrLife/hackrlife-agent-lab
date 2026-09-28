import type { DemoAction, DemoDefinition, Product } from "../types";
import { Sim, aud, DAY } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

const BUSINESS = "Saltbush Guesthouse";
const WINDOW = "Tue 14 – Thu 16 Oct";
const RACK_RATE = 220;
/** Cleaning, linen, laundry, breakfast and card fees per occupied room night. */
const VARIABLE_COST = 62;
const OFFERS: Record<string, number> = {
  "15% off midweek": 0.15,
  "25% off midweek": 0.25,
  "40% off midweek": 0.4,
};
const OFFER_NAMES = Object.keys(OFFERS);

interface Segment {
  total: number;
  noConsent: number;
  optedOut: number;
  contactedRecently: number;
  alreadyBooked: number;
}
const SEGMENTS: Record<string, Segment> = {
  "Previous guests (last 24 months)": { total: 58, noConsent: 9, optedOut: 3, contactedRecently: 4, alreadyBooked: 2 },
  "Previous midweek guests": { total: 26, noConsent: 4, optedOut: 1, contactedRecently: 2, alreadyBooked: 1 },
  "Website enquiries with no stay": { total: 30, noConsent: 30, optedOut: 0, contactedRecently: 0, alreadyBooked: 0 },
};

const BOOKING_RATE = 0.08; // share of contacted guests who book (sample assumption)
const AVG_NIGHTS = 1.5;
const BATCH_MAX = 12;
const CONTACTS_PER_NIGHT = 4; // send limit: contacts per remaining allocated night
const WINDOW_DAYS = 3; // offer window closes after three simulated days

type Step = "blocked" | "awaiting_owner" | "running" | "done";

interface Booking {
  ref: string;
  nights: number;
  cancelled: boolean;
}

interface State {
  step: Step;
  offerName: string;
  price: number;
  contribution: number;
  allocation: number;
  available: number;
  directNights: number;
  bookings: Booking[];
  eligible: number;
  contacted: number;
  batches: number;
  day: number;
  active: boolean;
  filled: boolean;
  campaignRef: string;
}

/* ------------------------------------------------------------------ */
/* Deterministic rules                                                 */
/* ------------------------------------------------------------------ */

function priceFor(offer: string) {
  const d = OFFERS[offer] ?? 0.25;
  const price = Math.round(RACK_RATE * (1 - d));
  return { price, contribution: price - VARIABLE_COST };
}

function offerNights(s: State) {
  return s.bookings.filter((b) => !b.cancelled).reduce((a, b) => a + b.nights, 0);
}

function inventory(s: State) {
  const sold = offerNights(s);
  const unsold = Math.max(0, s.available - s.directNights - sold);
  const allocLeft = Math.max(0, Math.min(s.allocation - sold, unsold));
  return { sold, unsold, allocLeft };
}

function eligibleCount(seg: Segment) {
  return Math.max(0, seg.total - seg.noConsent - seg.optedOut - seg.contactedRecently - seg.alreadyBooked);
}

function inventoryFields(s: State) {
  const inv = inventory(s);
  return [
    { label: "Window", value: WINDOW },
    { label: "Unsold room nights", value: String(inv.unsold), tone: inv.unsold === 0 ? ("bad" as const) : ("default" as const) },
    { label: "Direct full-rate bookings", value: `${s.directNights} night${s.directNights === 1 ? "" : "s"}` },
    { label: "Offer nights booked", value: `${inv.sold} of ${s.allocation}` },
    { label: "Allocation remaining", value: String(inv.allocLeft), tone: inv.allocLeft === 0 ? ("warn" as const) : ("ok" as const) },
  ];
}

function refreshInventory(sim: Sim<State>) {
  sim.record({ id: "inventory", title: "Remaining inventory", status: `${inventory(sim.s).allocLeft} offer night(s) left`, fields: inventoryFields(sim.s) });
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

function propose(sim: Sim<State>) {
  const s = sim.s;
  const floor = sim.num("margin_floor");
  const { price, contribution } = priceFor(s.offerName);
  s.price = price;
  s.contribution = contribution;
  sim.emit("propose", "started", `Proposing “${s.offerName}” at ${aud(price)} per night`);
  if (contribution < floor) {
    s.step = "blocked";
    sim.emit("check_margin", "blocked", `Below margin floor: ${aud(contribution)} < ${aud(floor)} per night`, `${aud(price)} rate − ${aud(VARIABLE_COST)} variable cost = ${aud(contribution)} contribution.`);
    sim.emit("belowfloor", "blocked", "Offer blocked — below margin floor", "Nothing is proposed to the owner or sent to guests until the offer is revised.");
    sim.record({
      id: "campaign",
      title: "Campaign plan",
      status: "Blocked — below margin floor",
      tone: "bad",
      fields: [
        { label: "Offer", value: `${s.offerName} (${aud(price)}/night)` },
        { label: "Contribution per night", value: aud(contribution), tone: "bad" },
        { label: "Margin floor", value: aud(floor) },
      ],
    });
    const revised = bestOfferAboveFloor(floor);
    const actions: DemoAction[] = [];
    if (revised) actions.push({ id: "revise", label: `Owner: revise to “${revised}”`, actor: "staff", tone: "primary", hint: "Deepest discount that still clears the floor." });
    actions.push({ id: "stop_plan", label: "Owner: drop the campaign", actor: "staff", tone: "danger" });
    sim.wait("waiting_staff", actions);
    return;
  }
  sim.emit("check_margin", "passed", `Margin floor cleared: ${aud(contribution)} ≥ ${aud(floor)} per night`, `${aud(price)} rate − ${aud(VARIABLE_COST)} variable cost.`);
  const inv = inventory(s);
  const expectedNights = Math.min(inv.allocLeft, Math.round(s.eligible * BOOKING_RATE * AVG_NIGHTS));
  const estimate = expectedNights * contribution;
  s.campaignRef = s.campaignRef || sim.ref("CMP");
  sim.record({
    id: "campaign",
    title: "Campaign plan",
    ref: s.campaignRef,
    status: "Proposed — awaiting owner approval",
    tone: "warn",
    fields: [
      { label: "Offer", value: `${s.offerName}: ${aud(price)} per night (rack ${aud(RACK_RATE)})` },
      { label: "Allocation", value: `${s.allocation} room night${s.allocation === 1 ? "" : "s"} (of ${s.available} unsold)` },
      { label: "Audience", value: `${sim.str("segment")} — ${s.eligible} eligible` },
      { label: "Send plan", value: `Batches of up to ${BATCH_MAX}, max ${CONTACTS_PER_NIGHT} contacts per remaining night, one per day` },
      { label: "Contribution per night", value: aud(contribution), tone: "ok" },
      { label: "Contribution estimate", value: `${aud(estimate)} (${expectedNights} night${expectedNights === 1 ? "" : "s"})` },
      { label: "Assumption: booking rate", value: `${BOOKING_RATE * 100}% of contacted guests book (sample history)`, tone: "muted" },
      { label: "Assumption: stay length", value: `${AVG_NIGHTS} nights per booking on average`, tone: "muted" },
      { label: "Assumption: variable cost", value: `${aud(VARIABLE_COST)} per occupied night`, tone: "muted" },
      { label: "Assumption: displacement", value: "No full-rate booking is displaced; estimate is capped at the allocation", tone: "muted" },
    ],
  });
  sim.emit("propose", "passed", `Plan ${s.campaignRef} proposed`, `Estimated contribution ${aud(estimate)} with stated assumptions.`, { ref: s.campaignRef });
  s.step = "awaiting_owner";
  sim.emit("approve", "waiting", "Waiting for explicit owner approval", "No guest is contacted before the owner decides.");
  const decision = sim.str("owner_decision", "Approve");
  const actions: DemoAction[] =
    decision === "Reject"
      ? [{ id: "reject", label: "Owner: reject the campaign", actor: "staff", tone: "danger", hint: "Set “Owner decision” to Approve to try the other path." }]
      : [{ id: "approve", label: "Owner: approve the campaign", actor: "staff", tone: "primary", hint: "Set “Owner decision” to Reject to try the other path." }];
  sim.wait("waiting_staff", actions);
}

function bestOfferAboveFloor(floor: number): string | null {
  let best: string | null = null;
  for (const name of OFFER_NAMES) {
    if (priceFor(name).contribution >= floor) best = name; // offers are ordered by increasing discount
  }
  return best;
}

/** Recompute inventory, then send one bounded batch (or stop). Returns false if outreach stopped. */
function sendBatch(sim: Sim<State>) {
  const s = sim.s;
  const inv = inventory(s);
  refreshInventory(sim);
  sim.emit("check_inventory", "passed", `Inventory recomputed: ${inv.unsold} unsold, ${inv.allocLeft} offer night(s) left`);
  if (inv.allocLeft <= 0) {
    fill(sim);
    return;
  }
  const remainingAudience = s.eligible - s.contacted;
  if (remainingAudience <= 0) {
    sim.emit("batches", "stopped", "Eligible audience exhausted", "No guest is contacted twice for the same campaign.");
    s.active = false;
    sim.patch("campaign", { status: "Stopped — audience exhausted", tone: "warn" });
    return;
  }
  const size = Math.min(BATCH_MAX, remainingAudience, inv.allocLeft * CONTACTS_PER_NIGHT);
  const n = s.batches + 1;
  const key = `${s.campaignRef}:batch:${n}`;
  if (!sim.claim(key, "batches", "batch send")) return;
  s.batches = n;
  s.contacted += size;
  sim.send({ channel: "email", to: `${size} eligible previous guests`, summary: `Batch ${n}: “${s.offerName}” midweek offer, ${WINDOW}`, status: "held", opKey: key });
  sim.emit("batches", "passed", `Batch ${n} queued: ${size} guests`, `Held in the demo outbox. ${s.eligible - s.contacted} eligible guests not yet contacted.`, { opKey: key });
  if (n === 1) sim.say("assistant", `Hi, we have a few quiet midweek nights (${WINDOW}) at ${BUSINESS}. As a previous guest you can book at ${aud(s.price)} a night — reply or book online while the offer lasts.`);
  sim.patch("campaign", { status: "Running", tone: "ok", fields: [{ label: "Batches sent", value: `${s.batches} (${s.contacted} guests contacted)` }] });
}

function fill(sim: Sim<State>) {
  const s = sim.s;
  s.active = false;
  s.filled = true;
  sim.emit("filled", "stopped", "Allocation filled — outreach stopped", "Remaining batches cancelled. Later messages are not sent.");
  sim.emit("batches", "stopped", "No further batches", `${s.eligible - s.contacted} eligible guests will not be contacted.`);
  sim.patch("campaign", { status: "Filled — outreach stopped", tone: "ok" });
}

function trackActions(sim: Sim<State>): DemoAction[] {
  const s = sim.s;
  const inv = inventory(s);
  const actions: DemoAction[] = [];
  if (s.active && s.batches > 0 && inv.allocLeft >= 1) actions.push({ id: "book1", label: "Sample guest books 1 night", actor: "customer", tone: "primary" });
  if (s.active && s.batches > 0 && inv.allocLeft >= 2) actions.push({ id: "book2", label: "Sample guest books 2 nights", actor: "customer" });
  if (s.bookings.some((b) => !b.cancelled)) actions.push({ id: "cancel", label: "A guest cancels their booking", actor: "customer" });
  actions.push({ id: "next_day", label: s.day + 1 >= WINDOW_DAYS ? "Advance clock 1 day (offer window closes)" : "Advance clock 1 day (next batch)", actor: "clock" });
  if (s.active) actions.push({ id: "stop", label: "Owner: stop switch", actor: "staff", tone: "danger" });
  else actions.push({ id: "close", label: "Owner: close the campaign", actor: "staff" });
  return actions;
}

function closeWindow(sim: Sim<State>, why: string) {
  const s = sim.s;
  s.step = "done";
  s.active = false;
  const sold = offerNights(s);
  const realised = sold * s.contribution;
  sim.emit("track", "confirmed", `Campaign closed: ${sold} offer night${sold === 1 ? "" : "s"} booked`, `Contribution ${aud(realised)} at ${aud(s.contribution)} per night.`);
  sim.patch("campaign", { status: `Closed — ${sold} of ${s.allocation} nights booked`, tone: sold > 0 ? "ok" : "warn", fields: [{ label: "Contribution booked", value: aud(realised), tone: sold > 0 ? "ok" : "muted" }] });
  refreshInventory(sim);
  sim.finish("completed", {
    kind: sold > 0 ? "success" : "exception",
    summary: `${why} ${sold} offer night${sold === 1 ? " was" : "s were"} booked for ${aud(realised)} contribution, counted from booking events rather than messages sent.`,
  });
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Interactive simulation using a sample guesthouse calendar and guest list. No offer is sent, no room is held and no booking is taken.",
  assistantName: "Demand manager",
  channelLabel: "Offer email (held)",
  fields: [
    { kind: "number", name: "available_nights", label: "Unsold midweek room nights", min: 0, max: 12 },
    { kind: "number", name: "margin_floor", label: "Minimum contribution per night (A$)", min: 0, max: 200, step: 5, helper: `Rack rate ${aud(RACK_RATE)}; variable cost ${aud(VARIABLE_COST)} per night.` },
    { kind: "select", name: "offer", label: "Offer", options: OFFER_NAMES },
    { kind: "number", name: "allocation", label: "Offer allocation (room nights)", min: 1, max: 12 },
    { kind: "select", name: "segment", label: "Audience segment", options: Object.keys(SEGMENTS), helper: "Website enquiries have no marketing consent." },
    { kind: "select", name: "owner_decision", label: "Owner decision", options: ["Approve", "Reject"] },
    { kind: "toggle", name: "restart_on_cancel", label: "Restart outreach if a cancellation reopens the allocation" },
  ],
  scenarios: [
    { id: "fill_midweek", label: "Fill six midweek nights", kind: "success", description: "25% offer to previous guests with a four-night allocation. Book nights and watch outreach stop when full.", inputs: { available_nights: 6, margin_floor: 90, offer: "25% off midweek", allocation: 4, segment: "Previous guests (last 24 months)", owner_decision: "Approve", restart_on_cancel: false } },
    { id: "below_floor", label: "Offer below margin floor", kind: "exception", description: "A 40% discount earns less than the floor. The offer is blocked until the owner revises it.", inputs: { available_nights: 6, margin_floor: 90, offer: "40% off midweek", allocation: 4, segment: "Previous guests (last 24 months)", owner_decision: "Approve", restart_on_cancel: false } },
    { id: "owner_rejects", label: "Owner rejects", kind: "exception", description: "The plan is valid but the owner says no. Nothing is sent.", inputs: { available_nights: 6, margin_floor: 90, offer: "15% off midweek", allocation: 3, segment: "Previous midweek guests", owner_decision: "Reject", restart_on_cancel: false } },
    { id: "cancel_after_fill", label: "Cancellation after filling", kind: "exception", description: "A two-night allocation fills, then a guest cancels. The campaign stays stopped under its rule.", inputs: { available_nights: 4, margin_floor: 90, offer: "25% off midweek", allocation: 2, segment: "Previous midweek guests", owner_decision: "Approve", restart_on_cancel: false } },
    { id: "restart_rule", label: "Restart rule on cancellation", kind: "success", description: "Same as above, but the configured rule allows outreach to restart when a cancellation reopens the allocation.", inputs: { available_nights: 4, margin_floor: 90, offer: "25% off midweek", allocation: 2, segment: "Previous midweek guests", owner_decision: "Approve", restart_on_cancel: true } },
  ],
  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("demand-manager", scenarioId, inputs, {
      step: "running",
      offerName: "",
      price: 0,
      contribution: 0,
      allocation: 0,
      available: 0,
      directNights: 0,
      bookings: [],
      eligible: 0,
      contacted: 0,
      batches: 0,
      day: 0,
      active: false,
      filled: false,
      campaignRef: "",
    });
    const s = sim.s;
    s.available = Math.max(0, Math.round(sim.num("available_nights")));
    s.offerName = OFFERS[sim.str("offer")] !== undefined ? sim.str("offer") : "25% off midweek";

    // 1. Detect capacity gap
    sim.emit("detect", "started", `Reading calendar for ${WINDOW}`, "Sample calendar fixture.");
    if (s.available <= 0) {
      sim.emit("detect", "stopped", "No capacity gap", "Every room night in the window is sold.");
      sim.record({ id: "inventory", title: "Remaining inventory", status: "No gap", tone: "muted", fields: [{ label: "Window", value: WINDOW }, { label: "Unsold room nights", value: "0" }] });
      return sim.finish("stopped", { kind: "exception", summary: "There are no unsold nights in the window, so no campaign was proposed." }).done();
    }
    const requested = Math.max(1, Math.round(sim.num("allocation", 1)));
    s.allocation = Math.min(requested, s.available);
    if (requested > s.available) sim.emit("check_inventory", "info", `Allocation capped at ${s.available} unsold nights`, `Requested ${requested}; the offer can never sell more than the inventory.`);
    sim.emit("detect", "passed", `${s.available} unsold room nights found`, `Allocation for the offer: ${s.allocation}.`);
    refreshInventory(sim);

    // 2. Eligible audience
    const segName = sim.str("segment");
    const seg = SEGMENTS[segName] ?? SEGMENTS["Previous guests (last 24 months)"];
    s.eligible = eligibleCount(seg);
    sim.emit("audience", "started", `Filtering “${segName}” (${seg.total} contacts)`);
    sim.record({
      id: "audience",
      title: "Eligible audience",
      status: `${s.eligible} eligible`,
      tone: s.eligible > 0 ? "ok" : "bad",
      fields: [
        { label: "Segment", value: segName },
        { label: "Contacts in segment", value: String(seg.total) },
        { label: "Excluded: no marketing consent", value: String(seg.noConsent), tone: seg.noConsent ? "warn" : "muted" },
        { label: "Excluded: opted out", value: String(seg.optedOut), tone: seg.optedOut ? "warn" : "muted" },
        { label: "Excluded: contacted in last 30 days", value: String(seg.contactedRecently), tone: seg.contactedRecently ? "warn" : "muted" },
        { label: "Excluded: already booked in window", value: String(seg.alreadyBooked), tone: seg.alreadyBooked ? "warn" : "muted" },
      ],
    });
    if (s.eligible === 0) {
      sim.emit("audience", "stopped", "No eligible audience", "Nobody in this segment has marketing consent.");
      return sim.finish("stopped", { kind: "exception", summary: "No contact in the chosen segment is eligible to receive an offer, so no campaign was proposed." }).done();
    }
    sim.emit("audience", "passed", `${s.eligible} eligible previous guests`);

    // 3. Propose offer within margin floor
    propose(sim);
    return sim.done();
  },

  act(run, actionId) {
    const sim = Sim.from(run);
    const s = sim.s;

    switch (actionId) {
      case "revise": {
        if (s.step !== "blocked") return sim.done();
        const next = bestOfferAboveFloor(sim.num("margin_floor"));
        if (!next) return sim.done();
        sim.say("staff", `Owner: make it “${next}” instead.`);
        sim.emit("belowfloor", "info", `Owner revised offer to “${next}”`);
        s.offerName = next;
        propose(sim);
        return sim.done();
      }

      case "stop_plan": {
        s.step = "done";
        sim.emit("belowfloor", "stopped", "Owner dropped the campaign");
        sim.patch("campaign", { status: "Dropped — nothing sent", tone: "muted" });
        return sim.finish("stopped", { kind: "exception", summary: "The offer was below the margin floor and the owner dropped it. No guest was contacted." }).done();
      }

      case "reject": {
        s.step = "done";
        sim.emit("check_approval", "failed", "Owner rejected the plan");
        sim.emit("rejected", "stopped", "Campaign rejected — nothing sent", "No batch is queued and no allocation is held.");
        sim.patch("campaign", { status: "Rejected by owner — nothing sent", tone: "bad" });
        return sim.finish("stopped", { kind: "exception", summary: "The owner rejected the campaign. No message was queued and the nights stay on general sale." }).done();
      }

      case "approve": {
        if (s.step !== "awaiting_owner") return sim.done();
        const receipt = sim.ref("APR");
        sim.emit("check_approval", "passed", `Explicit owner approval recorded (${receipt})`, `Covers ${s.offerName}, ${s.allocation} nights, ${s.eligible} eligible guests.`, { ref: receipt });
        sim.emit("approve", "confirmed", "Campaign approved");
        sim.patch("campaign", { status: "Approved", tone: "ok", fields: [{ label: "Approval", value: `${receipt} — owner, Day 1`, tone: "ok" }] });
        s.step = "running";
        s.active = true;
        sendBatch(sim);
        sim.emit("track", "waiting", "Tracking bookings against the allocation");
        return sim.wait("waiting_customer", trackActions(sim)).done();
      }

      case "book1":
      case "book2": {
        const nights = actionId === "book1" ? 1 : 2;
        const inv = inventory(s);
        if (!s.active || inv.allocLeft < nights) return sim.done();
        sim.advance(2 * 60);
        const ref = sim.ref("BK");
        const key = `booking:${ref}`;
        if (!sim.claim(key, "track", "booking")) return sim.done();
        s.bookings.push({ ref, nights, cancelled: false });
        sim.say("customer", nights === 1 ? "We'd love to come back — booking Wednesday night please." : "Booking Tuesday and Wednesday nights, thanks!");
        sim.send({ channel: "calendar", to: "Property calendar", summary: `${ref}: reserve ${nights} night${nights === 1 ? "" : "s"} against ${s.campaignRef}`, status: "simulated", opKey: key });
        sim.emit("track", "confirmed", `Booking ${ref}: ${nights} night${nights === 1 ? "" : "s"} reserved against the allocation`, `${aud(nights * s.contribution)} contribution.`, { ref, opKey: key });
        sim.record({
          id: "bookings",
          title: "Offer bookings",
          status: `${offerNights(s)} night(s) booked`,
          tone: "ok",
          fields: s.bookings.map((b) => ({ label: b.ref, value: `${b.nights} night${b.nights === 1 ? "" : "s"}${b.cancelled ? " — cancelled" : ""}`, tone: b.cancelled ? ("muted" as const) : ("ok" as const) })),
        });
        refreshInventory(sim);
        const after = inventory(s);
        if (after.allocLeft <= 0) {
          sim.emit("check_inventory", "passed", "Allocation recomputed: 0 offer nights left");
          fill(sim);
          return sim.wait("waiting_staff", trackActions(sim)).done();
        }
        sim.emit("capacity", "info", `Capacity remains: ${after.allocLeft} offer night(s)`, "Next eligible batch goes out on the next day.");
        return sim.wait("waiting_customer", trackActions(sim)).done();
      }

      case "cancel": {
        const b = [...s.bookings].reverse().find((x) => !x.cancelled);
        if (!b) return sim.done();
        sim.advance(60);
        b.cancelled = true;
        sim.say("customer", "Sorry, something's come up — we need to cancel.");
        sim.send({ channel: "calendar", to: "Property calendar", summary: `${b.ref} cancelled — ${b.nights} night${b.nights === 1 ? "" : "s"} released`, status: "simulated", opKey: `cancel:${b.ref}` });
        sim.emit("track", "info", `Booking ${b.ref} cancelled — ${b.nights} night(s) released`, undefined, { ref: b.ref });
        sim.record({
          id: "bookings",
          title: "Offer bookings",
          status: `${offerNights(s)} night(s) booked`,
          tone: offerNights(s) > 0 ? "ok" : "muted",
          fields: s.bookings.map((x) => ({ label: x.ref, value: `${x.nights} night${x.nights === 1 ? "" : "s"}${x.cancelled ? " — cancelled" : ""}`, tone: x.cancelled ? ("muted" as const) : ("ok" as const) })),
        });
        refreshInventory(sim);
        if (s.filled && !s.active && s.step !== "done") {
          if (sim.bool("restart_on_cancel")) {
            s.active = true;
            s.filled = false;
            sim.emit("filled", "info", "Configured rule: restart on cancellation — campaign reopened", "The next batch goes out on the next day after inventory is recomputed.");
            sim.patch("campaign", { status: "Running — reopened by cancellation rule", tone: "ok" });
          } else {
            sim.emit("filled", "stopped", "Campaign not restarted (rule: no restart on cancellation)", "Released nights return to general sale; no new offer messages.");
            sim.patch("campaign", { status: "Filled — stopped; cancellation did not restart it", tone: "warn" });
          }
        }
        return sim.wait(s.active ? "waiting_customer" : "waiting_staff", trackActions(sim)).done();
      }

      case "next_day": {
        sim.advance(DAY);
        s.day += 1;
        if (s.day === 1) {
          s.directNights += 1;
          sim.emit("track", "info", "Direct full-rate booking recorded (1 night)", "Booked through the website, outside the campaign. Inventory must be recomputed.");
          refreshInventory(sim);
        }
        if (s.day >= WINDOW_DAYS) {
          closeWindow(sim, "The offer window has reached the stay dates.");
          return sim.done();
        }
        if (s.active) {
          sendBatch(sim);
        } else {
          sim.emit("batches", "stopped", "No batch sent — campaign is stopped", s.filled ? "Allocation filled." : "Outreach is not active.");
        }
        return sim.wait(s.active ? "waiting_customer" : "waiting_staff", trackActions(sim)).done();
      }

      case "stop": {
        s.active = false;
        sim.say("staff", "Owner: stop the campaign, please.");
        sim.emit("batches", "stopped", "Owner stop switch — outreach stopped");
        closeWindow(sim, "The owner used the stop switch, so no further batches were sent.");
        return sim.done();
      }

      case "close": {
        closeWindow(sim, "The owner closed the campaign after outreach stopped.");
        return sim.done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const demandManager: Product = {
  id: "demand-manager",
  no: 15,
  slug: "demand-manager",
  name: "Demand Manager",
  outcome: "Turn quiet periods into targeted booking opportunities.",
  sectorLabel: "Hotels and capacity based services",
  sectors: ["Accommodation", "Appointments"],
  outcomes: ["Fill capacity"],
  definition:
    "Detects future spare capacity and recommends an approved offer to a suitable existing audience, stopping outreach as the allocation fills. Capacity, margin and eligibility are calculated by fixed rules, and nothing is sent until the owner approves the plan.",
  situation:
    "A guesthouse has six unsold room nights midweek and a list of previous guests, some of whom have agreed to hear about offers. The owner would discount a few nights but not below what covers cleaning, linen and breakfast, and does not want to keep advertising once the rooms are gone.",
  endState:
    "Quiet nights are offered to the right past guests at a price that still earns a set contribution, the owner signs off once, and outreach stops by itself when the allocation is sold.",
  handles: [
    "Finds unsold nights in a date window and caps the offer allocation at real inventory",
    "Filters the audience on consent, opt-out, recent contact and existing bookings",
    "Checks the offer against the margin floor and states the contribution estimate with its assumptions",
    "Sends bounded daily batches only after owner approval, recomputing inventory before each",
    "Stops outreach when the allocation fills and applies the configured cancellation rule",
  ],
  boundaries: [
    "Never sends an offer below the owner's minimum contribution",
    "Sends nothing without explicit owner approval",
    "A cancellation does not restart outreach unless the owner configured that rule",
    "The public demo sends no messages and holds no rooms",
  ],
  delivered: [
    { title: "Offer email", body: "A short note to eligible past guests with the dates, the offer rate and how to book, sent in bounded batches." },
    { title: "Owner approval request", body: "Campaign plan with offer, allocation, eligible audience count, contribution estimate and the assumptions behind it." },
    { title: "Campaign record", body: "Approval receipt, batches sent, bookings reserved against the allocation, remaining inventory and the stop reason." },
  ],
  deployment: {
    rules: [
      "Your rack rates, variable cost per night and minimum contribution",
      "Which offers are approved and how large an allocation can be",
      "Audience rules: consent, recent-contact window and exclusions",
      "Batch size, send days and the stop switch",
      "What happens when a cancellation reopens the allocation",
    ],
    systems: ["Property management system or booking calendar", "Guest list with marketing consent", "Approved offer rules", "Email or SMS messaging"],
  },
  measures: ["Incremental contribution from quiet periods, not campaign message volume", "Offer nights booked against allocation", "Full-rate bookings displaced (target: none)"],
  reliability: ["Messages sent after the allocation filled (target: zero)", "Offers sent below the margin floor (target: zero)", "Duplicate batch sends (target: zero)"],
  harness: {
    systems:
      "Production reads inventory from the booking calendar, customer segments with consent, approved offer rules and a messaging service. The demo uses a sample calendar, a fictional guest list and an outbox that holds every message.",
    controls: [
      "Owner approval before any batch is queued",
      "Margin floor on the offer's contribution per night",
      "Audience eligibility: consent, opt-out, recent contact, existing booking",
      "Send limits per batch and per remaining night",
      "Allocation and inventory recomputed before every batch",
      "Stop switch, and fulfilment capacity capped at unsold nights",
    ],
  },
  ctaLine: "Want this watching your own booking calendar for quiet nights?",
  graph: {
    nodes: [
      { id: "detect", kind: "action", row: 0, title: "Detect future capacity gap", input: "Booking calendar for a date window", rule: "Unsold nights; allocation capped at inventory", output: "Inventory record", failure: "No unsold nights → no campaign", system: "Calendar (demo: sample fixture)" },
      { id: "audience", kind: "action", row: 1, title: "Select eligible audience", input: "Customer segment", rule: "Consent, not opted out, not contacted in 30 days, not already booked", output: "Eligible audience count", failure: "Nobody eligible → stop", system: "Guest list (demo: fixture)" },
      { id: "propose", kind: "action", row: 2, title: "Propose offer within margin floor", input: "Offer, rack rate, variable cost", rule: "Contribution per night ≥ floor; estimate with assumptions", output: "Campaign plan", failure: "Below floor → blocked", system: "Offer rules (demo: fixture)" },
      { id: "approve", kind: "action", row: 3, title: "Owner approves campaign", input: "Campaign plan", rule: "Explicit owner decision required", output: "Approval receipt", failure: "Rejected → nothing sent", system: "Owner console (demo: staff action)" },
      { id: "batches", kind: "action", row: 4, title: "Send bounded batches", input: "Approved plan, remaining audience", rule: `≤ ${BATCH_MAX} per batch, ≤ ${CONTACTS_PER_NIGHT} per remaining night, one batch a day`, output: "Offer messages", failure: "Allocation filled or stopped → no batch", system: "Email (demo: held outbox)" },
      { id: "track", kind: "action", row: 5, title: "Track bookings and remaining capacity", input: "Booking and cancellation events", rule: "Reserve each booking against the allocation", output: "Bookings, remaining inventory, contribution", failure: "Cancellation → configured rule", system: "Calendar (demo: sample events)" },
      { id: "belowfloor", kind: "branch", row: 1.6, title: "Below margin floor", input: "Contribution < floor", rule: "Block; owner may revise to a compliant offer", output: "Blocked plan", failure: "Owner drops → stop" },
      { id: "rejected", kind: "branch", row: 2.9, title: "Rejected", input: "Owner rejects", rule: "Stop; nothing sent", output: "Rejected plan", failure: "—" },
      { id: "capacity", kind: "branch", row: 4.3, title: "Capacity remains", input: "Allocation not yet filled", rule: "Next eligible batch on the next day", output: "Next batch", failure: "—" },
      { id: "filled", kind: "branch", row: 5.3, title: "Allocation filled", input: "Offer nights = allocation", rule: "Stop outreach; cancellation restarts only if configured", output: "Stopped campaign", failure: "—" },
      { id: "check_margin", kind: "check", row: 1.8, title: "Price and margin rules", input: "Offer rate", rule: `Rate − ${aud(VARIABLE_COST)} variable cost ≥ floor`, output: "Pass / blocked", failure: "Blocked → revise offer" },
      { id: "check_approval", kind: "check", row: 3, title: "Explicit approval", input: "Owner decision", rule: "Recorded approval before any send", output: "Approval receipt", failure: "Rejected → stop" },
      { id: "check_inventory", kind: "check", row: 4.1, title: "Inventory before send", input: "Calendar + offer bookings", rule: "Recompute unsold and allocation before every batch", output: "Remaining allocation", failure: "Zero left → stop outreach" },
    ],
    edges: [
      { from: "detect", to: "audience", kind: "flow" },
      { from: "audience", to: "propose", kind: "flow" },
      { from: "propose", to: "approve", kind: "flow" },
      { from: "approve", to: "batches", kind: "flow" },
      { from: "batches", to: "track", kind: "flow" },
      { from: "propose", to: "belowfloor", kind: "return" },
      { from: "belowfloor", to: "propose", kind: "return", label: "revise offer" },
      { from: "approve", to: "rejected", kind: "return" },
      { from: "track", to: "capacity", kind: "return" },
      { from: "capacity", to: "batches", kind: "return", label: "next eligible batch" },
      { from: "track", to: "filled", kind: "return" },
      { from: "check_margin", to: "propose", kind: "check" },
      { from: "check_approval", to: "approve", kind: "check" },
      { from: "check_inventory", to: "batches", kind: "check" },
    ],
  },
  demo,
};
