import type { DemoAction, DemoDefinition, Product } from "../types";
import { Sim, aud, fmtClock, MIN, affirms, declines, mentions, normaliseReply } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional) — Northside Auto                               */
/* ------------------------------------------------------------------ */

const GARAGE = "Northside Auto";
const ADVISER = "Dan Okafor (service adviser)";

type ItemId = "brake" | "filter";

interface Item {
  id: ItemId;
  name: string;
  plain: string;
  price: number; // GST inclusive
  optional: boolean;
}

interface Estimate {
  ref: string;
  customerId: string;
  customer: string;
  phone: string;
  vehicle: string;
  technician: string;
  versions: Record<1 | 2, Item[]>;
  revisionNote: string;
  /** Technical question about an item on THIS estimate: button label and full wording. */
  questionShort: string;
  question: string;
  adviserAnswer: string;
}

const ESTIMATES: Record<string, Estimate> = {
  "EST-2231 · Corolla: front brakes + cabin filter": {
    ref: "EST-2231",
    customerId: "C-1042",
    customer: "Sam Whitfield",
    phone: "0491 570 006",
    vehicle: "2017 Toyota Corolla hatch · BKZ-42T (V-3310)",
    technician: "Aaron Petrov",
    versions: {
      1: [
        { id: "brake", name: "Front brake pads and rotors", plain: "Front pads are worn to 2 mm and both rotors measured below minimum thickness.", price: 486, optional: false },
        { id: "filter", name: "Cabin air filter (optional)", plain: "Filters air coming into the cabin. Due at this interval; not a safety item.", price: 68, optional: true },
      ],
      2: [
        { id: "brake", name: "Front brake pads, rotors and caliper slide pins", plain: "As before, plus two seized caliper slide pins found when the wheels came off.", price: 532, optional: false },
        { id: "filter", name: "Cabin air filter (optional)", plain: "Filters air coming into the cabin. Due at this interval; not a safety item.", price: 68, optional: true },
      ],
    },
    revisionNote: "Technician found seized caliper slide pins: brake line changed from A$486 to A$532.",
    questionShort: "Do I really need new rotors?",
    question: "Do I really need new rotors, or would pads alone do?",
    adviserAnswer: "Aaron measured both front rotors at 24.1 mm; the minimum for this car is 25 mm, so we won’t fit new pads to them. The cabin filter is optional — leaving it off doesn’t affect the brakes.",
  },
  "EST-2245 · Mazda 3: rear brakes + engine air filter": {
    ref: "EST-2245",
    customerId: "C-1187",
    customer: "Priya Nair",
    phone: "0491 570 157",
    vehicle: "2015 Mazda 3 · CRN-18P (V-3452)",
    technician: "Aaron Petrov",
    versions: {
      1: [
        { id: "brake", name: "Rear brake shoes and drum machining", plain: "Rear shoes are worn to 1.5 mm and the drums are scored.", price: 372, optional: false },
        { id: "filter", name: "Engine air filter (optional)", plain: "Filters air going into the engine. Dirty but still usable.", price: 54, optional: true },
      ],
      2: [
        { id: "brake", name: "Rear brake shoes, drum machining and wheel cylinder", plain: "As before, plus a leaking rear wheel cylinder found during the job.", price: 409, optional: false },
        { id: "filter", name: "Engine air filter (optional)", plain: "Filters air going into the engine. Dirty but still usable.", price: 54, optional: true },
      ],
    },
    revisionNote: "Technician found a leaking wheel cylinder: brake line changed from A$372 to A$409.",
    questionShort: "Can the drums be kept without machining?",
    question: "Do the rear drums really need machining, or could you just fit new shoes?",
    adviserAnswer: "The shoes are below the 2 mm service limit and the drum surface is scored, so the shoes need replacing. The air filter is optional.",
  },
};

const ESTIMATE_OPTIONS = Object.keys(ESTIMATES);

type Step = "choose" | "adviser" | "done";

interface State {
  step: Step;
  version: 1 | 2;
  /** Version the customer was shown when they made their selection. */
  shownVersion: 1 | 2;
  revised: boolean;
  selected: Record<ItemId, boolean>;
  questionAsked: boolean;
  questionReason: "technical" | "price";
  authRef: string | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function est(sim: Sim<State>): Estimate {
  return ESTIMATES[sim.str("estimate")] ?? ESTIMATES[ESTIMATE_OPTIONS[0]];
}

function items(sim: Sim<State>): Item[] {
  return est(sim).versions[sim.s.version];
}

/** Deterministic total in cents to avoid floating-point drift. */
function totals(list: Item[]) {
  const cents = list.reduce((a, i) => a + Math.round(i.price * 100), 0);
  return { total: cents / 100, gst: Math.round(cents / 11) / 100 };
}

function selectedItems(sim: Sim<State>) {
  return items(sim).filter((i) => sim.s.selected[i.id]);
}

function estimateRecord(sim: Sim<State>) {
  const e = est(sim);
  const s = sim.s;
  sim.record({
    id: "estimate",
    title: "Technician-approved estimate",
    ref: `${e.ref} v${s.version}`,
    status: s.version === 2 ? "Current v2 (v1 superseded)" : "Current v1",
    tone: s.version === 2 ? "warn" : "default",
    fields: [
      ...e.versions[s.version].map((i) => ({ label: i.name, value: aud(i.price) })),
      { label: "Full estimate", value: aud(totals(e.versions[s.version]).total) },
      { label: "Technician", value: e.technician },
      ...(s.version === 2 ? [{ label: "Revision", value: e.revisionNote, tone: "warn" as const }] : []),
    ],
  });
}

function selectionRecord(sim: Sim<State>) {
  const chosen = selectedItems(sim);
  const t = totals(chosen);
  sim.record({
    id: "selection",
    title: "Customer selection (not yet authorised)",
    status: chosen.length ? `${chosen.length} item${chosen.length === 1 ? "" : "s"} selected` : "Nothing selected",
    tone: "muted",
    fields: [
      ...items(sim).map((i) => ({ label: i.name, value: sim.s.selected[i.id] ? "Approve" : "Decline", tone: sim.s.selected[i.id] ? ("ok" as const) : ("muted" as const) })),
      { label: "Selected total", value: aud(t.total) },
    ],
  });
}

function chooseActions(sim: Sim<State>): DemoAction[] {
  const s = sim.s;
  const list = items(sim);
  const acts: DemoAction[] = list.map((i) => ({
    id: `toggle_${i.id}`,
    label: `${s.selected[i.id] ? "Decline" : "Approve"}: ${i.name} (${aud(i.price)})`,
    actor: "customer" as const,
  }));
  const chosen = selectedItems(sim);
  if (chosen.length) {
    acts.unshift({ id: "submit", label: `Confirm selection — ${aud(totals(chosen).total)}`, actor: "customer", tone: "primary" });
    acts.push({ id: "submit_twice", label: "Confirm (double tap / network retry)", actor: "customer", hint: "The confirmation arrives twice." });
  }
  acts.push({ id: "pickup_yes", label: "Reply “Yes” to the pickup-time question", actor: "customer", hint: "An unrelated yes is not an approval." });
  if (!s.questionAsked) acts.push({ id: "ask_question", label: `Ask “${est(sim).questionShort}”`, actor: "customer" });
  acts.push({ id: "decline_all", label: "Decline all work", actor: "customer", tone: "danger" });
  acts.push({ id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. Why does the filter need doing?" } });
  return acts;
}

function explain(sim: Sim<State>) {
  const e = est(sim);
  const list = items(sim);
  sim.emit("explain", "started", `Explaining ${e.ref} v${sim.s.version} in plain language`, "Only the technician’s notes are used.");
  sim.say(
    "assistant",
    `Hi ${e.customer.split(" ")[0]}, here’s ${e.technician.split(" ")[0]}’s estimate for your car (${e.ref}, version ${sim.s.version}):\n` +
      list.map((i) => `• ${i.name} — ${aud(i.price)}. ${i.plain}`).join("\n") +
      `\nPlease approve or decline each item, then confirm. Separately: will you be collecting the car before 5:30 pm today?`,
  );
  sim.emit("explain", "passed", "Line items explained");
}

function toChoose(sim: Sim<State>) {
  sim.s.step = "choose";
  sim.s.shownVersion = sim.s.version;
  selectionRecord(sim);
  sim.emit("choose", "waiting", "Waiting for item-level decisions");
  sim.wait("waiting_customer", chooseActions(sim));
}

function adviserReview(sim: Sim<State>, reason: "technical" | "price") {
  const s = sim.s;
  s.step = "adviser";
  s.questionAsked = true;
  s.questionReason = reason;
  sim.emit("techq", "waiting", reason === "technical" ? "Technical question — service adviser review" : "Price question — service adviser review", "The assistant does not give technical advice or change prices.");
  sim.say("assistant", "Good question — I’ll pass that to our service adviser so you get an accurate answer. Your approval is on hold until then.");
  sim.send({ channel: "task", to: ADVISER, summary: `${reason === "technical" ? "Technical" : "Price"} question on ${est(sim).ref} v${s.version}`, status: "simulated" });
  sim.wait("waiting_staff", [{ id: "adviser_answer", label: "Adviser: answer the customer", actor: "staff", tone: "primary" }]);
}

function submit(sim: Sim<State>, times: number) {
  const s = sim.s;
  const e = est(sim);
  sim.emit("validate", "started", "Validating explicit approval", `Selection made on v${s.shownVersion}.`);

  // Revision arrives between selection and submission (toggle).
  if (sim.bool("revision") && !s.revised) {
    s.revised = true;
    s.version = 2;
    sim.emit("issue", "info", `Technician revised ${e.ref} to v2`, e.revisionNote);
    estimateRecord(sim);
  }
  if (s.shownVersion !== s.version) {
    sim.emit("check_version", "failed", `Estimate v${s.shownVersion} is stale — approval blocked`, `Current version is v${s.version}. Nothing was authorised.`);
    sim.emit("changed", "waiting", "Estimate changed — customer to review new version", e.revisionNote);
    sim.patch("workshop", { status: "On hold — estimate revised, awaiting review", tone: "warn" });
    sim.send({ channel: "sms", to: e.phone, summary: `${e.ref} v${s.version} for review (v${s.shownVersion} withdrawn)`, status: "held" });
    sim.say("assistant", `Before we record anything: the estimate has just changed. ${e.revisionNote} Please review version ${s.version} and confirm again.`);
    explain(sim);
    toChoose(sim);
    return;
  }

  const chosen = selectedItems(sim);
  const declined = items(sim).filter((i) => !s.selected[i.id]);
  const t = totals(chosen);
  sim.emit("check_inferred", "passed", "Explicit item selection received", `Approved: ${chosen.map((i) => i.id).join(", ")}. Declined: ${declined.map((i) => i.id).join(", ") || "none"}.`);
  sim.emit("validate", "passed", `Totals recalculated: ${aud(t.total)}`, `Sum of approved lines on v${s.version}; GST included ${aud(t.gst)}.`);

  const key = `${e.ref}:v${s.version}:authorisation`;
  for (let n = 0; n < times; n++) {
    if (!sim.claim(key, "record", "authorisation")) continue;
    const ref = sim.ref("AUTH");
    s.authRef = ref;
    sim.say("customer", `Confirm: ${chosen.map((i) => i.name).join(" and ")}.`);
    sim.send({ channel: "crm", to: "Garage management system", summary: `${ref} authorisation on ${e.ref} v${s.version}: ${aud(t.total)}`, status: "simulated", opKey: key });
    sim.emit("check_receipt", "passed", `Authorisation ${ref} written with version and timestamp`, undefined, { ref, opKey: key });
    sim.record({
      id: "receipt",
      title: "Approval receipt",
      ref,
      status: `Authorised — ${e.ref} v${s.version}`,
      tone: "ok",
      fields: [
        { label: "Customer", value: `${e.customer} (${e.customerId})` },
        { label: "Vehicle", value: e.vehicle },
        { label: "Estimate version", value: `${e.ref} v${s.version}` },
        { label: "Approved items", value: chosen.map((i) => `${i.name} ${aud(i.price)}`).join("; "), tone: "ok" },
        { label: "Declined items", value: declined.map((i) => i.name).join("; ") || "None", tone: "muted" },
        { label: "Total approved", value: `${aud(t.total)} (incl. GST ${aud(t.gst)})` },
        { label: "Timestamp", value: fmtClock(sim.run.clock) },
        { label: "Method", value: "Explicit item selection via verified link" },
      ],
    });
    sim.patch("workshop", { status: "Authorised — proceed with approved items only", tone: "ok", fields: [{ label: "Proceed with", value: chosen.map((i) => i.name).join("; ") }, { label: "Do not fit", value: declined.map((i) => i.name).join("; ") || "—" }] });
    sim.send({ channel: "task", to: "Workshop job board", summary: `Release job for ${e.ref} v${s.version}: ${chosen.map((i) => i.id).join(" + ")}`, status: "simulated", opKey: `${key}:workshop` });
    sim.send({ channel: "sms", to: e.phone, summary: `Approval receipt ${ref}`, status: "held", opKey: `${key}:receipt` });
    sim.emit("record", "confirmed", "Authorisation recorded and workshop notified", `${chosen.length} of ${items(sim).length} items.`, { ref, opKey: key });
  }
  if (times > 1) sim.say("system", "The second confirmation carried the same operation key and was ignored — one authorisation exists.");
  s.step = "done";
  sim.finish("completed", {
    kind: "success",
    summary: `Authorisation ${s.authRef} records ${chosen.length === items(sim).length ? "all items" : "only the selected items"} on ${e.ref} v${s.version} for ${aud(t.total)}. The workshop was released only after this valid confirmation.`,
  });
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Interactive simulation using sample estimates. No message is sent, no job is released and no real authorisation is recorded.",
  assistantName: `${GARAGE} approvals`,
  channelLabel: "Estimate link and SMS",
  fields: [
    { kind: "select", name: "estimate", label: "Sample estimate", options: ESTIMATE_OPTIONS },
    { kind: "select", name: "brake_decision", label: "Brake work", options: ["Approve", "Decline"] },
    { kind: "select", name: "filter_decision", label: "Optional filter", options: ["Approve", "Decline"] },
    { kind: "toggle", name: "technical_question", label: "Customer asks a technical question" },
    { kind: "toggle", name: "revision", label: "Technician revises the estimate before submission" },
  ],
  scenarios: [
    { id: "brakes_only", label: "Approve brakes only", kind: "success", description: "The driver approves the brake work and declines the optional filter.", inputs: { estimate: ESTIMATE_OPTIONS[0], brake_decision: "Approve", filter_decision: "Decline", technical_question: false, revision: false } },
    { id: "all_items", label: "Approve everything", kind: "success", description: "The Mazda owner approves both lines on the estimate.", inputs: { estimate: ESTIMATE_OPTIONS[1], brake_decision: "Approve", filter_decision: "Approve", technical_question: false, revision: false } },
    { id: "technical_question", label: "Technical question", kind: "exception", description: "The driver asks whether the brake work on the estimate is really needed. The adviser answers before approval.", inputs: { estimate: ESTIMATE_OPTIONS[0], brake_decision: "Approve", filter_decision: "Decline", technical_question: true, revision: false } },
    { id: "revised", label: "Estimate revised", kind: "exception", description: "The technician issues v2 while the driver is choosing. The v1 approval is blocked.", inputs: { estimate: ESTIMATE_OPTIONS[0], brake_decision: "Approve", filter_decision: "Approve", technical_question: false, revision: true } },
    { id: "decline_all", label: "Decline all work", kind: "exception", description: "The driver declines both items. Nothing is authorised and the adviser arranges collection.", inputs: { estimate: ESTIMATE_OPTIONS[1], brake_decision: "Decline", filter_decision: "Decline", technical_question: false, revision: false } },
  ],
  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("repair-approvals", scenarioId, inputs, {
      step: "choose",
      version: 1,
      shownVersion: 1,
      revised: false,
      selected: { brake: false, filter: false },
      questionAsked: false,
      questionReason: "technical",
      authRef: null,
    });
    const s = sim.s;
    const e = est(sim);
    s.selected = { brake: sim.str("brake_decision") === "Approve", filter: sim.str("filter_decision") === "Approve" };

    sim.emit("issue", "started", `Technician issued ${e.ref} v1`, `${e.technician} · ${e.vehicle}`);
    estimateRecord(sim);
    sim.record({ id: "workshop", title: "Workshop job state", status: "On hold — awaiting authorisation", tone: "warn", fields: [{ label: "Vehicle", value: e.vehicle }] });
    const linkKey = `${e.ref}:v1:link`;
    sim.claim(linkKey, "issue", "estimate link");
    sim.send({ channel: "sms", to: e.phone, summary: `Estimate ${e.ref} v1 link`, status: "held", opKey: linkKey });
    sim.emit("issue", "passed", "Estimate link queued (held)");

    sim.advance(20 * MIN);
    sim.emit("verify", "started", "Customer opened the estimate link");
    sim.emit("check_identity", "passed", `Customer ${e.customerId} verified; v1 is current`, "Link token matches the customer on the estimate (fixture).");
    sim.emit("verify", "passed", "Customer and version verified");

    explain(sim);
    if (sim.bool("technical_question")) {
      sim.say("customer", e.question);
      adviserReview(sim, "technical");
      return sim.done();
    }
    toChoose(sim);
    return sim.done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;
    const e = est(sim);
    sim.advance(2 * MIN);

    switch (actionId) {
      case "toggle_brake":
      case "toggle_filter": {
        if (s.step !== "choose") return sim.done();
        const id: ItemId = actionId === "toggle_brake" ? "brake" : "filter";
        s.selected[id] = !s.selected[id];
        const item = items(sim).find((i) => i.id === id)!;
        sim.emit("choose", "info", `${s.selected[id] ? "Approved" : "Declined"}: ${item.name}`, "Selection only — not yet authorised.");
        selectionRecord(sim);
        return sim.wait("waiting_customer", chooseActions(sim)).done();
      }

      case "submit":
      case "submit_twice": {
        if (s.step !== "choose" || selectedItems(sim).length === 0) return sim.done();
        submit(sim, actionId === "submit_twice" ? 2 : 1);
        return sim.done();
      }

      case "pickup_yes": {
        if (s.step !== "choose") return sim.done();
        sim.say("customer", "Yes.");
        sim.emit("check_inferred", "blocked", "“Yes” to the pickup question is not an approval", "Authorisation requires explicit item selection and confirmation.");
        sim.say("assistant", "Thanks — noted you’ll collect before 5:30 pm. That isn’t an approval of the repair: please approve or decline each item and press confirm.");
        return sim.wait("waiting_customer", chooseActions(sim)).done();
      }

      case "ask_question": {
        if (s.step !== "choose") return sim.done();
        sim.say("customer", e.question);
        adviserReview(sim, "technical");
        return sim.done();
      }

      case "adviser_answer": {
        if (s.step !== "adviser") return sim.done();
        sim.advance(25 * MIN);
        sim.say("staff", `Dan: ${s.questionReason === "technical" ? e.adviserAnswer : "The prices are the parts and labour on the estimate. You can leave the optional item off to reduce the total."}`);
        sim.emit("techq", "passed", "Adviser answered — back to item selection");
        toChoose(sim);
        return sim.done();
      }

      case "decline_all": {
        if (s.step !== "choose") return sim.done();
        sim.say("customer", "Please don’t do any of the work. I’ll collect the car.");
        s.step = "done";
        s.selected = { brake: false, filter: false };
        selectionRecord(sim);
        sim.emit("decline", "stopped", "Customer declined all work", "No authorisation recorded; adviser arranges collection.");
        sim.patch("workshop", { status: "Do not proceed — all work declined", tone: "bad" });
        sim.send({ channel: "task", to: ADVISER, summary: `All work declined on ${e.ref} v${s.version} — arrange collection`, status: "simulated" });
        return sim.finish("stopped", { kind: "exception", summary: `The customer declined every item on ${e.ref} v${s.version}. No authorisation exists and the adviser has a task to arrange collection.` }).done();
      }

      case "free": {
        if (s.step !== "choose") return sim.done();
        const text = String(payload ?? "").trim();
        const t = normaliseReply(text);
        sim.say("customer", text || "…");
        if (/^\s*stop\b/.test(t) || mentions(t, /\b(unsubscribe|stop (messaging|contacting|texting))\b/)) {
          s.step = "done";
          sim.emit("check_inferred", "stopped", "Customer asked to stop messages — nothing authorised");
          sim.send({ channel: "task", to: ADVISER, summary: `Customer stopped messages on ${e.ref} — call to confirm decision`, status: "simulated" });
          sim.patch("workshop", { status: "On hold — adviser to call", tone: "warn" });
          return sim.finish("stopped", { kind: "stopped", summary: "The customer asked to stop messages. No authorisation was recorded and the adviser will call." }).done();
        }
        const TECH = /\b(why|really need|necessary|safe|explain|difference|what does|what is|rotors?|pads?|drums?|shoes?|cylinder|slide pins?|filter|machining|wear|worn)\b|\?/;
        const PRICE = /\b(cheap|cheaper|discount|lower|price match|too much|expensive)\b/;
        if (mentions(t, PRICE)) {
          adviserReview(sim, "price");
          return sim.done();
        }
        if (mentions(t, TECH) && !affirms(t) && !declines(t)) {
          adviserReview(sim, "technical");
          return sim.done();
        }
        if (declines(t)) {
          sim.emit("check_inferred", "blocked", "Ambiguous “no” is not recorded as a decision");
          sim.say("assistant", "Just to check — do you want to decline all the work? Use “Decline all work” to confirm, or choose the items you do want.");
          return sim.wait("waiting_customer", chooseActions(sim)).done();
        }
        if (affirms(t)) {
          sim.emit("check_inferred", "blocked", "Conversational “yes” is not an item approval", "Nothing recorded.");
          sim.say("assistant", "Thanks. To approve work I need you to choose each item and press confirm — a reply on its own isn’t recorded as approval.");
          return sim.wait("waiting_customer", chooseActions(sim)).done();
        }
        sim.emit("choose", "info", "Reply not understood — asking again");
        sim.say("assistant", "Sorry, I didn’t follow. You can approve or decline each item, ask a question for the service adviser, or decline all work.");
        return sim.wait("waiting_customer", chooseActions(sim)).done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const repairApprovals: Product = {
  id: "repair-approvals",
  no: 7,
  slug: "repair-approvals",
  name: "Repair Approvals",
  outcome: "Get clear approval before work begins.",
  sectorLabel: "Independent automotive",
  sectors: ["Automotive"],
  outcomes: ["Convert sales"],
  definition:
    "Explains a technician-approved estimate in plain language and records the customer’s decision on each line item against a specific estimate version. Technical questions go to the service adviser, and the workshop is released only for the work the customer explicitly approved.",
  situation:
    "A driver receives an estimate for front brake work and an optional cabin filter, and wants only the brakes done. The adviser normally rings, explains, writes the decision on the job card and hopes the price hasn’t changed since.",
  endState:
    "Every job starts with a receipt showing who approved which items on which estimate version, for what total and when. Nothing is fitted that wasn’t approved, and the adviser only handles genuine questions.",
  handles: [
    "Explains each estimate line using the technician’s notes",
    "Records approve or decline per item and recalculates the total",
    "Blocks approval of a superseded estimate and asks for review",
    "Routes technical and price questions to the service adviser",
    "Issues one approval receipt and releases only the approved work",
  ],
  boundaries: [
    "Never treats a “yes” to another question as approval",
    "Gives no technical advice beyond the technician’s written notes",
    "Does not change prices or scope — the adviser does",
  ],
  delivered: [
    { title: "Approval receipt", body: "Customer, estimate reference and version, approved and declined items, total including GST and timestamp." },
    { title: "Adviser question", body: "A task for the service adviser with the customer’s question and the estimate version; approval waits for the answer." },
    { title: "Workshop release", body: "Job-board update listing only the approved items, written after a valid confirmation." },
  ],
  deployment: {
    rules: [
      "Which estimate lines are optional and how they are described",
      "Version locking: when a revision invalidates open approvals",
      "How customers are verified before approving",
      "Which questions always go to the service adviser",
    ],
    systems: ["Garage management system", "Customer verification", "Estimates", "SMS or email"],
  },
  measures: ["Approval turnaround time", "Approved work completed (not total estimate value sent)"],
  reliability: [
    "Work started without a matching authorisation (target: zero)",
    "Approvals recorded against a superseded version (target: zero)",
    "Duplicate authorisations from repeated confirmations (target: zero)",
  ],
  harness: {
    systems:
      "Production connects the garage management system, customer verification, estimates and messaging. The demo uses two fictional Northside Auto estimates with a fixed v2 revision and an outbox that holds every message.",
    controls: [
      "Version locking: approvals must reference the current estimate",
      "Explicit item-level approval; no inferred consent",
      "Verified customer before any decision is recorded",
      "Arithmetic check on the approved lines",
      "Audit trail with one operation key per authorisation",
      "Service adviser owns every technical or price claim",
    ],
  },
  ctaLine: "Want this sending your estimates for approval?",
  graph: {
    nodes: [
      { id: "issue", kind: "action", row: 0, title: "Technician issues estimate", input: "Technician findings and priced lines", rule: "Versioned estimate; optional items marked", output: "Estimate vN + customer link", failure: "Revision → new version supersedes", system: "Garage management system (demo: fixture)" },
      { id: "verify", kind: "action", row: 1, title: "Verify customer and version", input: "Link opened", rule: "Token matches customer; version is current", output: "Verified session", failure: "Mismatch → no decisions accepted", system: "Customer verification (demo: fixture)" },
      { id: "explain", kind: "action", row: 2, title: "Explain approved line items", input: "Estimate lines + technician notes", rule: "Plain language from approved notes only", output: "Explanation message", failure: "Technical question → adviser", system: "Messaging (demo: held)" },
      { id: "choose", kind: "action", row: 3, title: "Customer chooses items", input: "Approve/decline per line", rule: "Explicit selection per item", output: "Draft selection (not authorised)", failure: "Decline all → stop", system: "Session state" },
      { id: "validate", kind: "action", row: 4, title: "Validate explicit approval", input: "Confirmed selection", rule: "Current version; totals recalculated", output: "Validated approval", failure: "Stale version → review new version", system: "Estimate service (demo: fixture)" },
      { id: "record", kind: "action", row: 5, title: "Record authorisation and notify workshop", input: "Validated approval", rule: "One authorisation per operation key", output: "Approval receipt + job release", failure: "Duplicate confirmation → ignored", system: "GMS + job board (demo: simulated)" },
      { id: "techq", kind: "branch", row: 0.6, title: "Technical question", input: "Question needing advice", rule: "Service adviser answers; approval waits", output: "Adviser answer", failure: "—" },
      { id: "changed", kind: "branch", row: 2.5, title: "Estimate changed", input: "Newer version than the one shown", rule: "Block; customer reviews new version", output: "Re-explained estimate", failure: "—" },
      { id: "decline", kind: "branch", row: 4.3, title: "Decline all work", input: "Customer declines every item", rule: "Stop; adviser arranges collection", output: "Declined record, no authorisation", failure: "—" },
      { id: "check_identity", kind: "check", row: 0.9, title: "Identity and version", input: "Link token, estimate version", rule: "Verified customer on the current version", output: "Verified", failure: "Fail → no decisions accepted" },
      { id: "check_inferred", kind: "check", row: 2.9, title: "No inferred approval", input: "Customer replies", rule: "Only explicit item selection counts", output: "Explicit decision", failure: "Unrelated yes → blocked" },
      { id: "check_version", kind: "check", row: 4, title: "Current version at submission", input: "Selected version vs current", rule: "Must match", output: "Pass / blocked", failure: "Stale → review requested" },
      { id: "check_receipt", kind: "check", row: 5, title: "Authorisation receipt", input: "Authorisation write", rule: "Version, items, total, timestamp recorded", output: "Receipt reference", failure: "No receipt → workshop stays on hold" },
    ],
    edges: [
      { from: "issue", to: "verify", kind: "flow" },
      { from: "verify", to: "explain", kind: "flow" },
      { from: "explain", to: "choose", kind: "flow" },
      { from: "choose", to: "validate", kind: "flow" },
      { from: "validate", to: "record", kind: "flow" },
      { from: "explain", to: "techq", kind: "return" },
      { from: "techq", to: "explain", kind: "return", label: "adviser answer" },
      { from: "validate", to: "changed", kind: "return" },
      { from: "changed", to: "explain", kind: "return", label: "review new version" },
      { from: "choose", to: "decline", kind: "return" },
      { from: "check_identity", to: "verify", kind: "check" },
      { from: "check_inferred", to: "choose", kind: "check" },
      { from: "check_version", to: "validate", kind: "check" },
      { from: "check_receipt", to: "record", kind: "check" },
    ],
  },
  demo,
};
