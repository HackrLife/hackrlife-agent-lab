import type { DemoDefinition, Product, Run } from "../types";
import { Sim, aud, DAY, HOUR } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

/** Simulation day 0 = Monday 5 October 2026, 09:00. */
const BASE = Date.UTC(2026, 9, 5);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateLabel(day: number): string {
  const d = new Date(BASE + day * 86400000);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

interface Item {
  id: string;
  name: string;
  price: number;
  inStock: boolean;
}

const PREVIOUS_ID = "garden_rose";
/** Current catalogue. The previous bouquet's stock is set by the visitor input. */
const CATALOGUE: Item[] = [
  { id: "garden_rose", name: "Garden rose bouquet", price: 95, inStock: true },
  { id: "seasonal_posy", name: "Seasonal posy", price: 65, inStock: true },
  { id: "native_bunch", name: "Native wildflower bunch", price: 85, inStock: true },
  { id: "peony_rose", name: "Peony and rose bouquet", price: 110, inStock: true },
  { id: "orchid", name: "Orchid arrangement", price: 140, inStock: false },
  { id: "luxe_rose", name: "Luxe rose box", price: 160, inStock: true },
];

const BANDS: { label: string; min: number; max: number }[] = [
  { label: "Up to A$80", min: 0, max: 80 },
  { label: "A$80–A$120", min: 80, max: 120 },
  { label: "A$120 and over", min: 120, max: 100000 },
];
const LEAD_TIMES = ["7 days", "14 days", "21 days"];
const DELIVERY_FEE = 15;
const CUTOFF_HOUR_DAY_BEFORE = 14;
const MAX_PREF_CHANGES = 3;

type Step = "scheduled" | "awaiting_choice" | "awaiting_fulfilment" | "awaiting_alt_fulfilment" | "done";

interface State {
  step: Step;
  custId: string;
  occ: number; // occasion day offset
  lead: number;
  band: number;
  offered: string[];
  chosen: string | null;
  prefChanges: number;
  dateChanged: boolean;
  reminderCount: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function stockOf(sim: Sim<State>, id: string): boolean {
  if (id === PREVIOUS_ID) return sim.bool("previous_in_stock");
  return CATALOGUE.find((c) => c.id === id)?.inStock ?? false;
}

function item(id: string): Item {
  return CATALOGUE.find((c) => c.id === id) ?? CATALOGUE[0];
}

function today(sim: Sim<State>): number {
  return Math.floor(sim.run.clock / DAY);
}

function dueDay(s: State): number {
  return s.occ - s.lead;
}

function cutoffAt(s: State): number {
  // 14:00 on the day before the occasion, in sim minutes (sim starts 09:00)
  return (s.occ - 1) * DAY + (CUTOFF_HOUR_DAY_BEFORE - 9) * HOUR;
}

function scheduleReminder(sim: Sim<State>, note: string) {
  const s = sim.s;
  const due = Math.max(dueDay(s), today(sim));
  s.step = "scheduled";
  sim.record({
    id: "reminder",
    title: "Occasion reminder",
    status: `Scheduled for ${dateLabel(due)}`,
    tone: "default",
    fields: [
      { label: "Occasion", value: `Anniversary — ${dateLabel(s.occ)}` },
      { label: "Lead time", value: `${s.lead} days before (stated by customer)` },
      { label: "Budget preference", value: `${BANDS[s.band].label} (stated)` },
      { label: "Previous order", value: `${item(PREVIOUS_ID).name} (order history)` },
      { label: "Not used", value: "No inferred details — only stated preferences and order history", tone: "muted" },
      { label: "Note", value: note, tone: "muted" },
    ],
  });
  sim.emit("approaches", "waiting", `Reminder scheduled for ${dateLabel(due)}`, note);
  const wait = due - today(sim);
  sim.wait("running", [
    { id: "advance", label: wait > 0 ? `Advance clock to reminder (${wait} day${wait === 1 ? "" : "s"})` : "Run the reminder now", actor: "clock", tone: "primary" },
    { id: "opt_out", label: "Customer turns off occasion reminders", actor: "customer", tone: "danger" },
  ]);
}

function selectProducts(sim: Sim<State>, context: string) {
  const s = sim.s;
  const band = BANDS[s.band];
  sim.emit("select", "started", "Selecting available products", `${context} · ${band.label}`);
  const prevOk = stockOf(sim, PREVIOUS_ID);
  const prev = item(PREVIOUS_ID);
  const prevInBand = prev.price >= band.min && prev.price <= band.max;
  if (!prevOk) {
    sim.emit("check_stock", "failed", `${prev.name} unavailable — alternatives offered`, "Current catalogue shows it out of stock this week.");
  } else {
    sim.emit("check_stock", "passed", `${prev.name} in stock`);
  }
  const inStock = CATALOGUE.filter((c) => stockOf(sim, c.id));
  let alts = inStock.filter((c) => c.id !== PREVIOUS_ID && c.price >= band.min && c.price <= band.max);
  if (alts.length === 0) {
    const mid = (band.min + Math.min(band.max, 200)) / 2;
    alts = inStock.filter((c) => c.id !== PREVIOUS_ID).sort((a, b) => Math.abs(a.price - mid) - Math.abs(b.price - mid)).slice(0, 2);
    sim.emit("check_stock", "info", "No in-stock items in the stated band — nearest prices shown");
  }
  const offered = [...(prevOk && prevInBand ? [PREVIOUS_ID] : []), ...alts.slice(0, 2).map((c) => c.id)];
  s.offered = offered;
  const unavailable = CATALOGUE.filter((c) => !stockOf(sim, c.id)).map((c) => c.name);
  sim.emit("select", "passed", `${offered.length} available product(s) offered`, offered.map((id) => `${item(id).name} ${aud(item(id).price)}`).join(" · "));
  sim.record({
    id: "invitation",
    title: "Reorder invitation",
    status: "Sent — awaiting customer",
    tone: "default",
    fields: [
      ...offered.map((id) => ({ label: id === PREVIOUS_ID ? "Same as last time" : "Suggested", value: `${item(id).name} — ${aud(item(id).price)}`, tone: "ok" as const })),
      ...(prevOk ? [] : [{ label: "Previous bouquet", value: `${prev.name} — unavailable`, tone: "warn" as const }]),
      { label: "Not offered (out of stock)", value: unavailable.join(", ") || "—", tone: "muted" },
      { label: "Delivery cutoff", value: `${dateLabel(s.occ - 1)}, 2pm` },
    ],
  });
}

function sendReminder(sim: Sim<State>) {
  const s = sim.s;
  s.reminderCount += 1;
  const key = `${s.custId}:reminder:${dateLabel(s.occ)}`;
  const first = !sim.run.opKeys.includes(key);
  if (first) sim.claim(key, "approaches", "reminder");
  const names = s.offered.map((id) => `${item(id).name} (${aud(item(id).price)})`);
  const prevOk = stockOf(sim, PREVIOUS_ID);
  sim.say(
    "assistant",
    `Hi ${sim.str("customer").split(" ")[0]}, your anniversary is on ${dateLabel(s.occ)}. ${prevOk && s.offered.includes(PREVIOUS_ID) ? `Would you like the ${item(PREVIOUS_ID).name} again? ` : `The ${item(PREVIOUS_ID).name} you ordered last time isn’t available this week. `}Available in your ${BANDS[s.band].label} range: ${names.join(", ")}. Order by 2pm on ${dateLabel(s.occ - 1)} for delivery on the day.`,
  );
  if (first) sim.send({ channel: "email", to: sim.str("email"), summary: `Anniversary reminder — ${s.offered.length} products`, status: "held", opKey: key });
  else sim.send({ channel: "email", to: sim.str("email"), summary: "Updated suggestions after preference change", status: "held" });
  sim.emit("choose", "waiting", "Reminder delivered — waiting for the customer");
  sim.patch("reminder", { status: `Sent ${dateLabel(today(sim))}`, tone: "ok" });
  s.step = "awaiting_choice";
  sim.wait("waiting_customer", choiceActions(sim));
}

function choiceActions(sim: Sim<State>): Run["actions"] {
  const s = sim.s;
  const acts: Run["actions"] = s.offered.map((id, i) => ({
    id: `choose_${id}`,
    label: id === PREVIOUS_ID ? `Reorder ${item(id).name} (${aud(item(id).price)})` : `Choose ${item(id).name} (${aud(item(id).price)})`,
    actor: "customer" as const,
    ...(i === 0 ? { tone: "primary" as const } : {}),
  }));
  if (s.prefChanges < MAX_PREF_CHANGES) {
    const next = (s.band + 1) % BANDS.length;
    acts.push({ id: "change_budget", label: `Change budget preference to ${BANDS[next].label}`, actor: "customer" });
  }
  const changed = Math.round(sim.num("changed_occasion_in"));
  if (!s.dateChanged && changed > 0 && changed !== s.occ) {
    acts.push({ id: "update_date", label: `Update anniversary date to ${dateLabel(changed)}`, actor: "customer", hint: "“We actually celebrate on a different day this year.”" });
  }
  acts.push({ id: "opt_out", label: "Stop occasion reminders", actor: "customer", tone: "danger" });
  acts.push({ id: "lapse", label: "Advance clock to the occasion (no order)", actor: "clock" });
  return acts;
}

function nextReminderDay(s: State): number {
  return s.occ + 365 - s.lead;
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary:
    "Interactive simulation using a sample customer, catalogue and delivery calendar. No reminder is sent, no order is placed and no payment is taken.",
  assistantName: "Occasion reminders",
  channelLabel: "Reminder email and replies",
  fields: [
    { kind: "text", name: "customer", label: "Customer (fictional)" },
    { kind: "text", name: "email", label: "Customer email" },
    { kind: "number", name: "occasion_in", label: "Anniversary in (days from today)", min: 1, max: 120, helper: "Today is Mon 5 Oct 2026 in the simulation." },
    { kind: "select", name: "lead_time", label: "Reminder lead time", options: LEAD_TIMES },
    { kind: "select", name: "budget_pref", label: "Stated budget preference", options: BANDS.map((b) => b.label) },
    { kind: "toggle", name: "previous_in_stock", label: "Previous bouquet in stock", helper: "Off = the Garden rose bouquet is unavailable." },
    { kind: "toggle", name: "cutoff_passed", label: "Customer replies after the delivery cutoff", helper: "Reply arrives after 2pm the day before the occasion." },
    { kind: "number", name: "changed_occasion_in", label: "Changed anniversary date (days from today)", min: 0, max: 120, helper: "0 = unchanged. Otherwise the customer updates the date at the reminder." },
    { kind: "toggle", name: "existing_order", label: "Order already placed for this occasion" },
    { kind: "toggle", name: "opted_in", label: "Customer opted in to reminders" },
  ],
  scenarios: [
    { id: "anniversary", label: "Anniversary reorder", kind: "success", description: "Opted in, reminder two weeks before, previous bouquet in stock.", inputs: { customer: "Mia Chen", email: "mia.chen@mail.example", occasion_in: 20, lead_time: "14 days", budget_pref: "A$80–A$120", previous_in_stock: true, cutoff_passed: false, changed_occasion_in: 0, existing_order: false, opted_in: true } },
    { id: "date_changed", label: "Changed occasion date", kind: "exception", description: "At the reminder the customer moves the anniversary a week later; the reminder is rescheduled.", inputs: { customer: "Mia Chen", email: "mia.chen@mail.example", occasion_in: 20, lead_time: "14 days", budget_pref: "A$80–A$120", previous_in_stock: true, cutoff_passed: false, changed_occasion_in: 27, existing_order: false, opted_in: true } },
    { id: "sold_out", label: "Previous bouquet unavailable", kind: "exception", description: "The bouquet from last year is out of stock, so available alternatives are offered.", inputs: { customer: "Oscar Reid", email: "oscar.reid@mail.example", occasion_in: 16, lead_time: "7 days", budget_pref: "A$80–A$120", previous_in_stock: false, cutoff_passed: false, changed_occasion_in: 0, existing_order: false, opted_in: true } },
    { id: "cutoff", label: "Delivery cutoff passed", kind: "exception", description: "The customer replies after the cutoff; delivery on the day is blocked and collection is offered.", inputs: { customer: "Hana Suzuki", email: "hana.suzuki@mail.example", occasion_in: 20, lead_time: "14 days", budget_pref: "A$80–A$120", previous_in_stock: true, cutoff_passed: true, changed_occasion_in: 0, existing_order: false, opted_in: true } },
    { id: "already_ordered", label: "Already ordered", kind: "exception", description: "An order for this anniversary already exists, so no invitation is sent.", inputs: { customer: "Leo Martin", email: "leo.martin@mail.example", occasion_in: 20, lead_time: "14 days", budget_pref: "A$120 and over", previous_in_stock: true, cutoff_passed: false, changed_occasion_in: 0, existing_order: true, opted_in: true } },
    { id: "not_opted_in", label: "No reminder permission", kind: "exception", description: "The customer never opted in, so nothing is scheduled.", inputs: { customer: "Ruby Allen", email: "ruby.allen@mail.example", occasion_in: 20, lead_time: "14 days", budget_pref: "Up to A$80", previous_in_stock: true, cutoff_passed: false, changed_occasion_in: 0, existing_order: false, opted_in: false } },
  ],

  start(inputs, scenarioId) {
    const lead = parseInt(String(inputs.lead_time), 10);
    const bandIdx = BANDS.findIndex((b) => b.label === inputs.budget_pref);
    const sim = Sim.begin<State>("occasion-reminders", scenarioId, inputs, {
      step: "scheduled",
      custId: "",
      occ: 0,
      lead: Number.isFinite(lead) ? lead : 14,
      band: bandIdx >= 0 ? bandIdx : 1,
      offered: [],
      chosen: null,
      prefChanges: 0,
      dateChanged: false,
      reminderCount: 0,
    });
    const s = sim.s;
    s.occ = Math.round(sim.num("occasion_in"));
    s.custId = sim.ref("C");
    sim.emit("approaches", "started", "Saved occasion loaded", `${sim.str("customer")} · anniversary ${s.occ > 0 ? dateLabel(s.occ) : "(invalid)"}`);
    if (!(s.occ > 0)) {
      sim.emit("approaches", "failed", "Occasion date invalid", "The occasion must be in the future.");
      sim.record({ id: "occasion", title: "Saved occasion", status: "Invalid date", tone: "bad", fields: [{ label: "Occasion in", value: String(sim.str("occasion_in")) }] });
      return sim.finish("failed", { kind: "failed", summary: "The saved occasion date is not in the future, so no reminder was calculated. Fix the date and run again." }).done();
    }
    sim.record({
      id: "occasion",
      title: "Saved occasion",
      ref: s.custId,
      status: sim.bool("opted_in") ? "Opted in" : "No reminder permission",
      tone: sim.bool("opted_in") ? "ok" : "muted",
      fields: [
        { label: "Customer", value: `${sim.str("customer")} (${sim.str("email")})` },
        { label: "Occasion", value: `Anniversary — ${dateLabel(s.occ)} (customer-provided)` },
        { label: "Reminder preference", value: sim.bool("opted_in") ? `${s.lead} days before, by email` : "Not given", tone: sim.bool("opted_in") ? "default" : "muted" },
        { label: "Budget preference", value: BANDS[s.band].label },
        { label: "Last order", value: `${item(PREVIOUS_ID).name}, ${aud(item(PREVIOUS_ID).price)} (last year)` },
        { label: "Reminder eligibility", value: sim.bool("opted_in") ? "Active" : "None", tone: sim.bool("opted_in") ? "ok" : "muted" },
      ],
    });

    if (!sim.bool("opted_in")) {
      s.step = "done";
      sim.emit("check_perm", "blocked", "No explicit reminder permission", "Occasion reminders need an opt-in; order history alone is not enough.");
      sim.emit("prefcheck", "stopped", "Nothing scheduled");
      return sim.finish("stopped", { kind: "exception", summary: "The customer has not opted in to occasion reminders, so no reminder was scheduled or sent." }).done();
    }
    sim.emit("check_perm", "passed", "Explicit opt-in on record", `Reminder ${s.lead} days before; uses stated preferences and order history only.`);
    scheduleReminder(sim, dueDay(s) <= 0 ? "Inside the lead time — reminder due now." : `${s.lead} days before ${dateLabel(s.occ)}.`);
    return sim.done();
  },

  act(run, actionId) {
    const sim = Sim.from(run);
    const s = sim.s;

    if (actionId.startsWith("choose_")) {
      const id = actionId.slice(7);
      if (s.step !== "awaiting_choice" || !s.offered.includes(id)) return sim.done();
      const late = sim.bool("cutoff_passed");
      if (late) {
        const target = cutoffAt(s) + HOUR;
        if (target > sim.run.clock) sim.advance(target - sim.run.clock);
        sim.say("system", `Reply arrives ${dateLabel(today(sim))} at 3pm — after the 2pm delivery cutoff.`);
      } else {
        sim.advance(3 * HOUR);
      }
      s.chosen = id;
      sim.say("customer", id === PREVIOUS_ID ? "Yes please — the same bouquet as last time." : `I’ll take the ${item(id).name}, please.`);
      sim.emit("choose", "passed", `Customer chose ${item(id).name}`, aud(item(id).price));
      s.step = "awaiting_fulfilment";
      return sim
        .wait("waiting_customer", [
          { id: "deliver", label: `Deliver on ${dateLabel(s.occ)} (+${aud(DELIVERY_FEE)})`, actor: "customer", tone: "primary" },
          { id: "collect", label: `Collect in store on ${dateLabel(s.occ)}`, actor: "customer" },
        ])
        .done();
    }

    const checkout = (mode: "deliver" | "collect") => {
      const id = s.chosen!;
      const it = item(id);
      sim.emit("checkout", "started", `Validating ${mode === "deliver" ? "delivery" : "collection"} and checkout`);
      if (!stockOf(sim, id)) {
        sim.emit("check_stock", "failed", `${it.name} no longer in stock`);
        s.step = "done";
        sim.finish("failed", { kind: "failed", summary: `${it.name} went out of stock before checkout, so no order was taken.` });
        return;
      }
      sim.emit("check_stock", "passed", `Stock rechecked at checkout: ${it.name} available`);
      if (mode === "deliver") {
        if (sim.run.clock >= cutoffAt(s)) {
          sim.emit("check_cutoff", "blocked", `Delivery cutoff passed (${dateLabel(s.occ - 1)}, 2pm)`, `Delivery on ${dateLabel(s.occ)} is no longer available.`);
          sim.emit("cutoff", "waiting", "Cutoff missed — alternative fulfilment offered", "Collection in store on the day is still available.");
          sim.say("assistant", `Sorry — the cutoff for delivery on ${dateLabel(s.occ)} was 2pm on ${dateLabel(s.occ - 1)}, and it has passed. You can still collect the ${it.name} from the shop on the day, or choose not to order.`);
          s.step = "awaiting_alt_fulfilment";
          sim.wait("waiting_customer", [
            { id: "collect", label: `Collect in store on ${dateLabel(s.occ)}`, actor: "customer", tone: "primary" },
            { id: "no_order", label: "Don’t order this time", actor: "customer" },
          ]);
          return;
        }
        sim.emit("check_cutoff", "passed", `Before cutoff (${dateLabel(s.occ - 1)}, 2pm)`);
      } else {
        sim.emit("check_cutoff", "passed", "Collection has no delivery cutoff");
      }
      const total = it.price + (mode === "deliver" ? DELIVERY_FEE : 0);
      const key = `${s.custId}:order:${dateLabel(s.occ)}`;
      if (!sim.claim(key, "record", "order")) return;
      const ord = sim.ref("ORD");
      const pay = sim.ref("PAY");
      sim.send({ channel: "payment", to: "Checkout (sandbox)", summary: `Sample checkout ${aud(total)} — ${pay}`, status: "simulated", opKey: key });
      sim.emit("checkout", "confirmed", `Sample checkout ${pay} succeeded`, aud(total), { opKey: key, ref: pay });
      const fKey = `${s.custId}:fulfil:${dateLabel(s.occ)}`;
      sim.claim(fKey, "record", "fulfilment request");
      sim.send({ channel: "task", to: "Delivery calendar", summary: mode === "deliver" ? `Delivery request ${dateLabel(s.occ)} — ${ord}` : `Collection request ${dateLabel(s.occ)} — ${ord}`, status: "simulated", opKey: fKey });
      const next = nextReminderDay(s);
      sim.emit("record", "confirmed", `Order ${ord} recorded; next reminder ${dateLabel(next)}`, undefined, { opKey: fKey, ref: ord });
      sim.record({
        id: "order",
        title: "Reorder receipt",
        ref: ord,
        status: "Paid (sample checkout)",
        tone: "ok",
        fields: [
          { label: "Product", value: `${it.name} — ${aud(it.price)}` },
          { label: mode === "deliver" ? "Delivery" : "Collection", value: `${dateLabel(s.occ)}${mode === "deliver" ? ` (+${aud(DELIVERY_FEE)})` : ", in store"}` },
          { label: "Total", value: aud(total) },
          { label: "Payment", value: `${pay} (simulated)`, tone: "ok" },
          { label: "Fulfilment request", value: mode === "deliver" ? "Delivery run booked (simulated)" : "Collection slot noted (simulated)" },
        ],
      });
      sim.patch("invitation", { status: "Converted to order", tone: "ok" });
      sim.patch("reminder", { status: `Next reminder ${dateLabel(next)}`, tone: "ok", fields: [{ label: "Occasion order", value: `${ord} — no further invitation this year`, tone: "ok" }] });
      s.step = "done";
      sim.finish("completed", {
        kind: "success",
        summary: `Order ${ord} placed for ${dateLabel(s.occ)} after stock and ${mode === "deliver" ? "cutoff" : "collection"} checks passed; the next reminder is set for ${dateLabel(next)}.`,
      });
    };

    switch (actionId) {
      case "advance": {
        const target = Math.max(dueDay(s), today(sim)) * DAY;
        if (target > sim.run.clock) sim.advance(target - sim.run.clock);
        sim.emit("approaches", "started", `Saved occasion approaches — ${dateLabel(today(sim))}`, `${s.occ - today(sim)} days to ${dateLabel(s.occ)}.`);
        sim.emit("prefcheck", "started", "Checking preference and existing orders");
        sim.emit("check_perm", "passed", "Opt-in still active");
        if (sim.bool("existing_order")) {
          s.step = "done";
          const ref = "ORD-7310";
          sim.emit("check_perm", "blocked", `Existing order ${ref} for this occasion — invitation suppressed`);
          sim.emit("already", "stopped", "Already ordered — no invitation sent", "The next reminder rolls to next year.");
          const key = `${s.custId}:reminder:${dateLabel(s.occ)}`;
          sim.claim(key, "already", "reminder");
          sim.send({ channel: "email", to: sim.str("email"), summary: "Anniversary reminder (suppressed — already ordered)", status: "suppressed", opKey: key });
          sim.patch("reminder", { status: `Suppressed — next reminder ${dateLabel(nextReminderDay(s))}`, tone: "muted", fields: [{ label: "Occasion order", value: `${ref} (placed by the customer)` }] });
          return sim.finish("stopped", { kind: "exception", summary: `An order for this anniversary already exists, so no reminder was sent. The next reminder is set for ${dateLabel(nextReminderDay(s))}.` }).done();
        }
        sim.emit("check_perm", "passed", "No existing order for this occasion");
        sim.emit("prefcheck", "passed", "Preferences reused as stated", `${BANDS[s.band].label}; previous item from order history. No inferred details.`);
        selectProducts(sim, "Reminder");
        sendReminder(sim);
        return sim.done();
      }

      case "change_budget": {
        if (s.prefChanges >= MAX_PREF_CHANGES) return sim.done();
        s.prefChanges += 1;
        const from = BANDS[s.band].label;
        s.band = (s.band + 1) % BANDS.length;
        sim.say("customer", `Could you show me options in the ${BANDS[s.band].label} range instead?`);
        sim.emit("choose", "info", `Budget preference changed: ${from} → ${BANDS[s.band].label}`, "Stated by the customer; saved for future reminders.");
        sim.patch("occasion", { fields: [{ label: "Budget preference", value: `${BANDS[s.band].label} (updated by customer)` }] });
        sim.patch("reminder", { fields: [{ label: "Budget preference", value: `${BANDS[s.band].label} (stated)` }] });
        selectProducts(sim, "Preference change");
        sendReminder(sim);
        return sim.done();
      }

      case "update_date": {
        const changed = Math.round(sim.num("changed_occasion_in"));
        if (s.dateChanged || !(changed > 0)) return sim.done();
        s.dateChanged = true;
        const old = s.occ;
        sim.advance(2 * HOUR);
        sim.say("customer", `We’re celebrating on ${dateLabel(changed)} this year — can you remind me for that date?`);
        s.occ = changed;
        s.offered = [];
        sim.emit("datechg", "info", `Occasion date changed: ${dateLabel(old)} → ${dateLabel(changed)}`, "reschedule");
        sim.patch("occasion", { fields: [{ label: "Occasion", value: `Anniversary — ${dateLabel(changed)} (updated by customer)`, tone: "warn" }] });
        sim.patch("invitation", { status: "Closed — date changed", tone: "muted" });
        if (changed <= today(sim)) {
          s.step = "done";
          sim.emit("datechg", "stopped", "New date is not in the future — no reminder");
          return sim.finish("stopped", { kind: "exception", summary: "The updated date has already passed, so no reminder was rescheduled." }).done();
        }
        sim.emit("check_perm", "passed", "Date accuracy: customer-provided date saved");
        sim.say("assistant", `Thanks — I’ve updated your anniversary to ${dateLabel(changed)}. I’ll send your reminder on ${dateLabel(Math.max(dueDay(s), today(sim)))}.`);
        scheduleReminder(sim, `Rescheduled from ${dateLabel(old - s.lead)} after the date change.`);
        return sim.done();
      }

      case "deliver": {
        if (s.step !== "awaiting_fulfilment") return sim.done();
        sim.say("customer", `Please deliver on ${dateLabel(s.occ)}.`);
        checkout("deliver");
        return sim.done();
      }

      case "collect": {
        if (s.step !== "awaiting_fulfilment" && s.step !== "awaiting_alt_fulfilment") return sim.done();
        sim.say("customer", `I’ll collect it from the shop on ${dateLabel(s.occ)}.`);
        if (s.step === "awaiting_alt_fulfilment") {
          sim.emit("cutoff", "passed", "Alternative fulfilment chosen: collection", "alternative fulfilment");
          sim.emit("select", "info", "Product availability rechecked for collection");
        }
        checkout("collect");
        return sim.done();
      }

      case "no_order": {
        sim.say("customer", "Never mind, I won’t order this time.");
        s.step = "done";
        const next = nextReminderDay(s);
        sim.emit("cutoff", "stopped", "Customer chose not to order");
        sim.emit("record", "info", `No order; next reminder ${dateLabel(next)}`);
        sim.patch("invitation", { status: "Closed — no order", tone: "muted" });
        sim.patch("reminder", { status: `Next reminder ${dateLabel(next)}`, tone: "default" });
        return sim.finish("completed", { kind: "exception", summary: `Delivery was past its cutoff and the customer chose not to collect, so no order was taken. The next reminder is set for ${dateLabel(next)}.` }).done();
      }

      case "lapse": {
        const target = s.occ * DAY;
        if (target > sim.run.clock) sim.advance(target - sim.run.clock);
        s.step = "done";
        const next = nextReminderDay(s);
        sim.emit("choose", "stopped", "No reply by the occasion — invitation lapsed", "One reminder per occasion; no chasing.");
        sim.emit("record", "info", `No order; next reminder ${dateLabel(next)}`);
        sim.patch("invitation", { status: "Lapsed — no reply", tone: "muted" });
        sim.patch("reminder", { status: `Next reminder ${dateLabel(next)}`, tone: "default" });
        return sim.finish("completed", { kind: "exception", summary: `The customer did not reply before ${dateLabel(s.occ)}. No follow-up was sent; the next reminder is set for ${dateLabel(next)}.` }).done();
      }

      case "opt_out": {
        sim.say("customer", "Please stop sending me occasion reminders.");
        s.step = "done";
        sim.emit("optout", "stopped", "Opt-out recorded — future reminder eligibility deleted");
        sim.emit("check_perm", "stopped", "Reminder permission withdrawn", "Saved occasion kept for order history only; no reminders will be scheduled.");
        sim.send({ channel: "crm", to: "Customer preferences", summary: "Remove occasion reminder eligibility", status: "simulated", opKey: `${s.custId}:optout` });
        sim.patch("occasion", { status: "Opted out", tone: "bad", fields: [{ label: "Reminder eligibility", value: "Deleted at customer request", tone: "bad" }, { label: "Reminder preference", value: "Withdrawn", tone: "bad" }] });
        sim.patch("reminder", { status: "Cancelled — no future reminders", tone: "bad" });
        sim.patch("invitation", { status: "Closed — opted out", tone: "muted" });
        return sim.finish("stopped", { kind: "stopped", summary: "The customer opted out. Future reminder eligibility was deleted and nothing further is scheduled." }).done();
      }
    }
    return sim.done();
  },
};

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const occasionReminders: Product = {
  id: "occasion-reminders",
  no: 19,
  slug: "occasion-reminders",
  name: "Occasion Reminders",
  outcome: "Help customers remember the next occasion.",
  sectorLabel: "Florists bakeries and gift businesses",
  sectors: ["Local orders"],
  outcomes: ["Grow repeat business"],
  definition:
    "Uses dates and preferences customers have given you to invite a repeat order a set time before each occasion. Every invitation is built from current products and delivery cutoffs, and only customers who opted in receive one.",
  situation:
    "A customer opted in to an anniversary reminder two weeks before the date and ordered a garden rose bouquet last year. This year the owner wants to remind her in time, suggest what is actually in stock within her stated budget, and not send a reminder if she has already ordered.",
  endState:
    "Opted-in customers get one timely, accurate invitation per occasion, can reorder in a few taps, and the next reminder date is set automatically. Changed dates, existing orders and opt-outs are respected without anyone checking a spreadsheet.",
  handles: [
    "Calculates reminder dates from customer-provided occasions and lead times, and reschedules when a date changes",
    "Suppresses the invitation when an order for that occasion already exists",
    "Suggests in-stock products within the stated budget, with alternatives when last year’s item is unavailable",
    "Rechecks stock and delivery cutoff at checkout and offers collection when delivery is closed",
    "Records the order, the delivery or collection request and the next reminder date",
  ],
  boundaries: [
    "Never reminds anyone without an explicit opt-in; opt-out removes future eligibility",
    "Reuses stated preferences and order history only — no inferred personal details",
    "Sends one invitation per occasion and does not chase",
  ],
  delivered: [
    { title: "Reorder receipt", body: "Product, price, delivery or collection date, sample payment reference and order number." },
    { title: "Delivery or collection request", body: "A request on the delivery calendar or collection list for the occasion date, linked to the order." },
    { title: "Saved occasion record", body: "Customer-provided date, lead time, stated budget band, permission status and the next reminder date." },
  ],
  deployment: {
    rules: [
      "Which occasions you remind for and the lead times offered",
      "Budget bands and which products may be suggested",
      "Delivery cutoffs, delivery areas and collection hours",
      "Opt-in wording and how opt-outs are recorded",
    ],
    systems: ["Customer preference store or CRM", "Occasion dates", "Product catalogue and stock", "Delivery calendar", "Online checkout"],
  },
  measures: ["Completed repeat occasion orders", "Contribution after discounts", "Share of reminders that convert to an order"],
  reliability: [
    "Reminders sent without an opt-in (target: zero)",
    "Invitations sent when an occasion order already exists (target: zero)",
    "Orders accepted after the delivery cutoff for delivery (target: zero)",
  ],
  harness: {
    systems:
      "Production uses customer preferences, occasion dates, the catalogue, a delivery calendar and checkout. The demo uses a sample customer and catalogue, an outbox that holds the reminder and a sandbox checkout event.",
    controls: [
      "Explicit reminder permission checked before scheduling and before sending",
      "Date accuracy: only customer-provided dates; changes reschedule the reminder",
      "Current availability checked when suggesting and again at checkout",
      "Delivery cutoff enforced; collection offered as the alternative",
      "Duplicate-order suppression per occasion",
    ],
  },
  ctaLine: "Want this reminding your own customers before their occasions?",
  graph: {
    nodes: [
      { id: "approaches", kind: "action", row: 0, title: "Saved occasion approaches", input: "Saved occasion, lead time", rule: "Reminder date = occasion − stated lead time", output: "Scheduled reminder", failure: "Invalid date → nothing scheduled", system: "Preference store (demo: fixture)" },
      { id: "prefcheck", kind: "action", row: 1, title: "Check preference and existing order", input: "Customer record, orders", rule: "Opt-in active; no order for this occasion", output: "Eligible reminder", failure: "Existing order → suppress", system: "CRM + orders (demo: fixture)" },
      { id: "select", kind: "action", row: 2, title: "Select available products", input: "Stated budget band, previous item", rule: "In stock and in band; previous item first if available", output: "Invitation with up to 3 products", failure: "Previous item unavailable → alternatives", system: "Catalogue (demo: fixture)" },
      { id: "choose", kind: "action", row: 3, title: "Customer chooses or updates date", input: "Reminder reply", rule: "Choice must be an offered product", output: "Selected product or changed preference", failure: "No reply → lapse, no chasing", system: "Email (demo: held outbox)" },
      { id: "checkout", kind: "action", row: 4, title: "Validate delivery and checkout", input: "Product + fulfilment choice", rule: "Recheck stock and cutoff; sample checkout", output: "Payment reference", failure: "Cutoff passed → collection offered", system: "Delivery calendar + checkout (demo: sandbox)" },
      { id: "record", kind: "action", row: 5, title: "Record order and next reminder", input: "Verified checkout", rule: "One order per occasion; next reminder next year", output: "Order, fulfilment request, next reminder date", failure: "—", system: "Orders + delivery calendar (demo: simulated)" },
      { id: "already", kind: "branch", row: 1, title: "Already ordered", input: "Order exists for this occasion", rule: "Suppress invitation", output: "Stop; next reminder next year", failure: "—" },
      { id: "datechg", kind: "branch", row: 2.6, title: "Occasion date changed", input: "Customer gives a new date", rule: "Save date; recalculate reminder", output: "Rescheduled reminder", failure: "—" },
      { id: "optout", kind: "branch", row: 3.4, title: "Opted out", input: "Customer stops reminders", rule: "Delete future eligibility", output: "No further reminders", failure: "—" },
      { id: "cutoff", kind: "branch", row: 4.3, title: "Cutoff missed", input: "Delivery requested after cutoff", rule: "Offer collection or no order", output: "Alternative fulfilment", failure: "—" },
      { id: "check_perm", kind: "check", row: 0.9, title: "Permission and duplicate check", input: "Opt-in flag, occasion orders", rule: "Explicit opt-in; one order per occasion", output: "Allow / suppress", failure: "No permission → nothing sent" },
      { id: "check_stock", kind: "check", row: 2.3, title: "Current stock", input: "Catalogue", rule: "Only in-stock items offered or sold", output: "Available product list", failure: "Unavailable → alternatives" },
      { id: "check_cutoff", kind: "check", row: 4.3, title: "Delivery cutoff", input: "Reply time, occasion date", rule: "Delivery orders by 2pm the day before", output: "Delivery allowed / blocked", failure: "Blocked → collection" },
    ],
    edges: [
      { from: "approaches", to: "prefcheck", kind: "flow" },
      { from: "prefcheck", to: "select", kind: "flow" },
      { from: "select", to: "choose", kind: "flow" },
      { from: "choose", to: "checkout", kind: "flow" },
      { from: "checkout", to: "record", kind: "flow" },
      { from: "prefcheck", to: "already", kind: "return" },
      { from: "choose", to: "datechg", kind: "return" },
      { from: "datechg", to: "approaches", kind: "return", label: "reschedule" },
      { from: "choose", to: "optout", kind: "return" },
      { from: "checkout", to: "cutoff", kind: "return" },
      { from: "cutoff", to: "select", kind: "return", label: "alternative fulfilment" },
      { from: "check_perm", to: "prefcheck", kind: "check" },
      { from: "check_stock", to: "select", kind: "check" },
      { from: "check_cutoff", to: "checkout", kind: "check" },
    ],
  },
  demo,
};
