import type { DemoAction, DemoDefinition, Product, RecordField } from "../types";
import { Sim, aud, DAY, HOUR } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

const SHOP = "Fern & Flour";
const TODAY = "Mon 6 Oct";
const DATES = ["Fri 10 Oct", "Sat 11 Oct", "Sun 12 Oct"];
const NOTICE_DAYS: Record<string, number> = { "Fri 10 Oct": 4, "Sat 11 Oct": 5, "Sun 12 Oct": 6 };
const MIN_NOTICE_DAYS = 3;

type Item = "Birthday cake" | "Flower arrangement";
const ITEMS: Item[] = ["Birthday cake", "Flower arrangement"];

/** Remaining production slots per day (sample production calendar). */
const CAPACITY: Record<Item, Record<string, number>> = {
  "Birthday cake": { "Fri 10 Oct": 2, "Sat 11 Oct": 0, "Sun 12 Oct": 1 },
  "Flower arrangement": { "Fri 10 Oct": 3, "Sat 11 Oct": 0, "Sun 12 Oct": 2 },
};

/** Catalogue-approved prices only. */
const TIERS: Record<Item, { size: number; price: number }[]> = {
  "Birthday cake": [
    { size: 12, price: 85 },
    { size: 20, price: 120 },
    { size: 30, price: 165 },
    { size: 40, price: 210 },
  ],
  "Flower arrangement": [
    { size: 12, price: 65 },
    { size: 24, price: 110 },
    { size: 36, price: 150 },
  ],
};
const EXTRA_UNIT: Record<Item, number> = { "Birthday cake": 5, "Flower arrangement": 4 };
const UNIT: Record<Item, string> = { "Birthday cake": "servings", "Flower arrangement": "stems" };
const DELIVERY_FEE = 15;
const CUSTOM_FEE: Record<Item, number> = { "Birthday cake": 45, "Flower arrangement": 30 };
const DEPOSIT_SHARE = 0.5;
const MAX_ASKS = 3;
const FULFILMENT = ["Collection 10am", "Collection 3pm", "Delivery (A$15)"];

type Step = "gathering" | "capfull" | "owner" | "clarify" | "checkout" | "confirmed" | "done";

interface Brief {
  item: Item;
  date: string | null;
  qty: number | null;
  style: string;
  fulfilment: string | null;
  dietary: string;
  budget: number | null;
  designNote: string;
}

interface State {
  step: Step;
  brief: Brief;
  asks: number;
  unclear: number;
  quoteVersion: number;
  revised: boolean;
  total: number;
  deposit: number;
  customFee: number;
  payRef: string;
  orderRef: string;
  ticketRef: string;
  requestRef: string;
}

/* ------------------------------------------------------------------ */
/* Deterministic rules                                                 */
/* ------------------------------------------------------------------ */

function missing(b: Brief): string[] {
  const m: string[] = [];
  if (!b.date) m.push("date");
  if (!b.qty) m.push(b.item === "Birthday cake" ? "serving count" : "stem count");
  if (!b.fulfilment) m.push(b.item === "Birthday cake" ? "collection time or delivery" : "delivery or collection time");
  return m;
}

function isCustom(b: Brief) {
  return b.style.startsWith("Custom");
}

function catalogue(item: Item, qty: number) {
  const tiers = TIERS[item];
  const tier = tiers.find((t) => t.size >= qty);
  if (tier) return { label: `${tier.size} ${UNIT[item]} (catalogue size)`, price: tier.price };
  const top = tiers[tiers.length - 1];
  const extra = qty - top.size;
  return { label: `${top.size} ${UNIT[item]} + ${extra} at ${aud(EXTRA_UNIT[item])} each (catalogue rate)`, price: top.price + extra * EXTRA_UNIT[item] };
}

function alternatives(item: Item, date: string) {
  return DATES.filter((d) => d !== date && (CAPACITY[item][d] ?? 0) > 0);
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

function briefRecord(sim: Sim<State>) {
  const b = sim.s.brief;
  const m = missing(b);
  const unknown = (v: string | null) => (v ? { value: v } : { value: "Not stated", tone: "muted" as const });
  const fields: RecordField[] = [
    { label: "Item", value: b.item },
    { label: "Date", ...unknown(b.date), ...(b.date ? {} : { tone: "bad" as const }) },
    { label: b.item === "Birthday cake" ? "Servings" : "Stems", ...unknown(b.qty ? String(b.qty) : null) },
    { label: "Style", value: b.style + (b.designNote ? ` — ${b.designNote}` : ""), tone: isCustom(b) ? "warn" : "default" },
    { label: "Delivery / collection", ...unknown(b.fulfilment) },
    { label: "Dietary request", value: b.dietary || "None stated", tone: b.dietary ? "warn" : "muted" },
    { label: "Budget", value: b.budget ? aud(b.budget) : "Not stated", tone: b.budget ? "default" : "muted" },
  ];
  sim.record({
    id: "brief",
    title: "Order brief (fixed schema)",
    ref: sim.s.requestRef,
    status: m.length ? `Incomplete — missing ${m.join(", ")}` : "Complete",
    tone: m.length ? "warn" : "ok",
    fields,
  });
}

function setRequest(sim: Sim<State>, status: string, tone: "ok" | "warn" | "bad" | "muted" | "default") {
  sim.record({
    id: "request",
    title: "Request status",
    ref: sim.s.requestRef,
    status,
    tone,
    fields: [
      { label: "Customer", value: "Jess Taylor (jess.taylor@mail.example)" },
      { label: "Confirmed order", value: sim.s.orderRef || "None — not an order until the deposit is verified", tone: sim.s.orderRef ? "ok" : "muted" },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

function gatherActions(sim: Sim<State>): DemoAction[] {
  const b = sim.s.brief;
  const a: DemoAction[] = [];
  const inputDate = sim.str("date");
  const willGiveDate = DATES.includes(inputDate);
  const hasOutstandingFromInputs =
    (!b.date && willGiveDate) || (!b.qty && sim.num("quantity") > 0) || (!b.fulfilment && FULFILMENT.includes(sim.str("fulfilment")));
  if (hasOutstandingFromInputs) {
    a.push({ id: "answer", label: "Reply with the missing details", actor: "customer", tone: "primary", hint: "Uses the date, quantity and delivery inputs." });
  }
  if (!b.date) a.push({ id: "give_date", label: "Reply: “Let’s say Friday 10 October.”", actor: "customer" });
  a.push({ id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. Saturday, 20 people, I’ll collect at 10am" } });
  a.push({ id: "no_reply", label: "Advance clock 2 days (no reply)", actor: "clock" });
  return a;
}

function askForMissing(sim: Sim<State>) {
  const s = sim.s;
  const m = missing(s.brief);
  s.asks += 1;
  sim.emit("missing", "waiting", `Missing details: ${m.join(", ")}`, `Question ${s.asks} of ${MAX_ASKS}.`);
  if (!s.brief.date) {
    sim.emit("check_capacity", "blocked", "Checkout blocked — no date", "Capacity cannot be checked and no quote or deposit can be sent without a date.");
  }
  const q = m.map((x) => (x === "date" ? "which date you need it" : x === "serving count" ? "roughly how many people it should serve" : x === "stem count" ? "about how many stems you’d like" : x.startsWith("collection") ? "whether you’ll collect (10am or 3pm) or want delivery" : "whether you’d like delivery or collection at 10am or 3pm"));
  sim.say("assistant", `Happy to help! So I can check the kitchen calendar, could you tell me ${q.join(", ").replace(/, ([^,]*)$/, " and $1")}?`);
  setRequest(sim, s.brief.date ? "Enquiry — incomplete" : "Enquiry — incomplete, checkout blocked (no date)", "warn");
  s.step = "gathering";
  sim.wait("waiting_customer", gatherActions(sim));
}

/** Re-evaluate the brief after any customer input. */
function progress(sim: Sim<State>) {
  const s = sim.s;
  briefRecord(sim);
  const m = missing(s.brief);
  if (m.length) {
    if (s.asks >= MAX_ASKS) {
      handoffIncomplete(sim, `Still missing ${m.join(", ")} after ${MAX_ASKS} questions.`);
      return;
    }
    askForMissing(sim);
    return;
  }
  sim.emit("brief", "passed", "Order brief complete", `${s.brief.item}, ${s.brief.date}, ${s.brief.qty} ${UNIT[s.brief.item]}, ${s.brief.fulfilment}.`);
  checkCapacity(sim);
}

function handoffIncomplete(sim: Sim<State>, why: string) {
  const s = sim.s;
  s.step = "done";
  sim.emit("missing", "stopped", "Handed to owner — enquiry incomplete", why);
  sim.send({ channel: "task", to: "Owner — Priya", summary: `Incomplete enquiry ${s.requestRef}: follow up personally`, status: "simulated", opKey: `${s.requestRef}:handoff` });
  setRequest(sim, "Incomplete enquiry — handed to owner, no checkout", "muted");
  sim.finish("stopped", { kind: "exception", summary: `${why} The enquiry went to the owner as incomplete; no quote, deposit or order was created.` });
}

function checkCapacity(sim: Sim<State>) {
  const s = sim.s;
  const b = s.brief;
  const date = b.date!;
  const notice = NOTICE_DAYS[date] ?? 0;
  sim.emit("capacity", "started", `Checking ${date} in the production calendar`);
  if (notice < MIN_NOTICE_DAYS) {
    sim.emit("check_capacity", "failed", `Cutoff missed: ${notice} days’ notice (minimum ${MIN_NOTICE_DAYS})`);
  }
  const slots = CAPACITY[b.item][date] ?? 0;
  if (slots <= 0 || notice < MIN_NOTICE_DAYS) {
    const alts = alternatives(b.item, date);
    sim.emit("check_capacity", "failed", `${date} is fully booked for ${b.item.toLowerCase()}s`, `Alternatives with space: ${alts.join(", ") || "none"}.`);
    sim.emit("capfull", "waiting", "Capacity full — alternative dates offered", alts.join(", "));
    s.step = "capfull";
    setRequest(sim, "Enquiry — date unavailable", "warn");
    const a: DemoAction[] = alts.map((d, i) => ({ id: `alt${i + 1}`, label: `Choose ${d}`, actor: "customer" as const, tone: i === 0 ? ("primary" as const) : ("default" as const) }));
    if (alts.length) {
      sim.say("assistant", `Sorry — ${date} is already fully booked in our kitchen. I can do ${alts.join(" or ")}. Would one of those work?`);
    } else {
      sim.say("assistant", `Sorry — ${date} is fully booked and there’s no other day with space this week.`);
    }
    a.push({ id: "free", label: "Type your own reply", actor: "customer", freeText: { placeholder: "e.g. Sunday works" } });
    a.push({ id: "keep_date", label: `Only ${date} will do`, actor: "customer", tone: "danger" });
    sim.wait("waiting_customer", a);
    return;
  }
  sim.emit("check_capacity", "passed", `${date}: ${slots} slot${slots === 1 ? "" : "s"} free; ${notice} days’ notice`, `Cutoff ${MIN_NOTICE_DAYS} days before the order date.`);
  sim.emit("capacity", "passed", `Slot provisionally held for ${date}`, "Held until the quote expires; not an order.");
  draftQuote(sim);
}

function draftQuote(sim: Sim<State>) {
  const s = sim.s;
  const b = s.brief;
  s.quoteVersion += 1;
  const base = catalogue(b.item, b.qty!);
  const delivery = b.fulfilment?.startsWith("Delivery") ? DELIVERY_FEE : 0;
  s.total = base.price + delivery;
  const flags: string[] = [];
  if (isCustom(b)) flags.push("custom design");
  if (b.dietary) flags.push("dietary request");
  const fields: RecordField[] = [
    { label: "Version", value: `v${s.quoteVersion}` },
    { label: b.item, value: `${base.label}: ${aud(base.price)}` },
    ...(delivery ? [{ label: "Delivery", value: `${aud(delivery)} (catalogue)` }] : []),
    ...(isCustom(b) ? [{ label: "Custom design", value: "Not priced — owner sets the design fee", tone: "warn" as const }] : []),
    { label: "Catalogue total", value: aud(s.total) },
    ...(b.budget && s.total > b.budget ? [{ label: "Budget", value: `${aud(s.total - b.budget)} over the stated ${aud(b.budget)} — not discounted`, tone: "warn" as const }] : []),
  ];
  sim.record({ id: "quote", title: "Quote", ref: `${s.requestRef}-v${s.quoteVersion}`, status: "Draft — awaiting owner review", tone: "warn", fields });
  sim.emit("owner", "waiting", `Quote v${s.quoteVersion} drafted from catalogue prices`, `${aud(s.total)} before any owner-set design fee.`);
  if (b.dietary) {
    sim.emit("check_review", "blocked", `Dietary request flagged for owner: ${b.dietary}`, "No safety guarantee is given by the assistant.");
    sim.say("assistant", `I’ve noted “${b.dietary}” for the owner to review. I can’t promise the ${b.item === "Birthday cake" ? "cake" : "arrangement"} will be safe for an allergy or intolerance — our kitchen handles nuts, gluten and dairy, and the owner will tell you what can be done.`);
  }
  if (isCustom(b)) {
    sim.emit("check_review", "blocked", "Custom design needs owner review", "Design fee is not calculated automatically.");
  }
  if (!flags.length) sim.emit("check_review", "info", "No custom design or dietary request — owner checks price only");
  sim.say("assistant", `Thanks — I’ve put your ${b.item.toLowerCase()} request together. The owner will review it and send a quote shortly.`);
  s.step = "owner";
  setRequest(sim, "Quote — awaiting owner review", "warn");
  const a: DemoAction[] = [
    { id: "owner_approve", label: isCustom(b) ? `Owner: approve quote with ${aud(CUSTOM_FEE[b.item])} design fee` : "Owner: approve quote", actor: "staff", tone: "primary" },
  ];
  if (!s.revised) a.push({ id: "owner_revise", label: "Owner: brief needs revision", actor: "staff", hint: "Ask the customer to clarify before quoting." });
  a.push({ id: "owner_decline", label: "Owner: decline the order", actor: "staff", tone: "danger" });
  sim.wait("waiting_staff", a);
}

/* ------------------------------------------------------------------ */
/* Free-text parsing (simple, conservative keyword rules)              */
/* ------------------------------------------------------------------ */

interface Parsed {
  date?: string;
  otherDay?: string;
  qty?: number;
  budget?: number;
  fulfilment?: string;
  collectNoTime?: boolean;
  dietary?: string;
  stop?: boolean;
  price?: boolean;
}

function parse(text: string): Parsed {
  const t = ` ${text.toLowerCase()} `;
  const p: Parsed = {};
  if (/\b(stop|cancel|never ?mind|not interested)\b/.test(t)) p.stop = true;
  if (/\b(fri|friday)\b|\b10(th)?\b(?! ?(am|pm|people|serv|guest|stem))/.test(t)) p.date = "Fri 10 Oct";
  else if (/\b(sat|saturday)\b|\b11(th)?\b(?! ?(am|pm|people|serv|guest|stem))/.test(t)) p.date = "Sat 11 Oct";
  else if (/\b(sun|sunday)\b|\b12(th)?\b(?! ?(am|pm|people|serv|guest|stem))/.test(t)) p.date = "Sun 12 Oct";
  else {
    const other = t.match(/\b(monday|tuesday|wednesday|thursday|tomorrow|today)\b/);
    if (other) p.otherDay = other[1];
  }
  const q = t.match(/\b(\d{1,3})\s*(people|persons|serves|servings|guests|kids|pax|stems|flowers)\b/);
  if (q) p.qty = Number(q[1]);
  const money = t.match(/\$\s?(\d{2,4})/);
  if (money) p.budget = Number(money[1]);
  if (/\bdeliver/.test(t)) p.fulfilment = "Delivery (A$15)";
  else if (/\b(collect|pick ?up)/.test(t)) {
    const tm = t.match(/\b(\d{1,2})(?::\d{2})?\s*(am|pm)\b/);
    if (tm) p.fulfilment = tm[2] === "am" ? "Collection 10am" : "Collection 3pm";
    else p.collectNoTime = true;
  } else {
    const tm = t.match(/\b(\d{1,2})(?::\d{2})?\s*(am|pm)\b/);
    if (tm) p.fulfilment = tm[2] === "am" ? "Collection 10am" : "Collection 3pm";
  }
  const diet = t.match(/\b(nut|peanut|gluten|coeliac|celiac|dairy|lactose|vegan|egg)[a-z-]*\b/);
  if (diet) p.dietary = `${diet[1].charAt(0).toUpperCase()}${diet[1].slice(1)}-related request (customer’s words: “${text.trim().slice(0, 60)}”)`;
  if (/\b(cheaper|discount|price|cost|how much)\b/.test(t)) p.price = true;
  return p;
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

function firstMessage(b: Brief, partial: boolean, full: { date: string; qty: number; fulfilment: string }) {
  const thing = b.item === "Birthday cake" ? "a chocolate birthday cake for my daughter" : "a flower arrangement for my mum’s birthday";
  const parts = [`Hi! Could you do ${thing}?`];
  if (!partial) {
    if (full.date) parts.push(`It’s for ${full.date}.`);
    if (full.qty) parts.push(b.item === "Birthday cake" ? `About ${full.qty} people.` : `Around ${full.qty} stems.`);
    if (full.fulfilment) parts.push(full.fulfilment.startsWith("Delivery") ? "Delivery please." : `I’ll pick it up at ${full.fulfilment.replace("Collection ", "")}.`);
  }
  if (isCustom(b)) parts.push("I have a photo of a design I’d like copied.");
  if (b.dietary) parts.push(`Note: ${b.dietary.toLowerCase()}.`);
  if (b.budget) parts.push(`Budget is about ${aud(b.budget)}.`);
  return parts.join(" ");
}

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Interactive simulation using a sample catalogue and production calendar. No message is sent, no deposit is taken and no order reaches a real kitchen.",
  assistantName: "Order assistant",
  channelLabel: "Website chat",
  fields: [
    { kind: "select", name: "item", label: "Cake or flowers", options: ITEMS },
    { kind: "toggle", name: "partial_first", label: "First message leaves out date, quantity and collection time" },
    { kind: "select", name: "date", label: "Date the customer wants", options: ["Not stated", ...DATES], helper: "Sat 11 Oct is fully booked." },
    { kind: "number", name: "quantity", label: "Servings (cake) or stems (flowers)", min: 0, max: 80, helper: "0 = not stated." },
    { kind: "number", name: "budget", label: "Budget (A$)", min: 0, max: 1000, step: 5, helper: "0 = not stated." },
    { kind: "select", name: "style", label: "Style", options: ["Catalogue design", "Custom design (reference photo)"] },
    { kind: "select", name: "fulfilment", label: "Delivery or collection", options: ["Not stated", ...FULFILMENT] },
    { kind: "text", name: "dietary", label: "Dietary request", helper: "e.g. “Nut allergy”. Leave blank for none." },
  ],
  scenarios: [
    { id: "cake_complete", label: "Birthday cake", kind: "success", description: "The customer first leaves out the date, serving count and collection time. The assistant asks, the owner approves, the deposit confirms the order.", inputs: { item: "Birthday cake", partial_first: true, date: "Fri 10 Oct", quantity: 20, budget: 150, style: "Catalogue design", fulfilment: "Collection 10am", dietary: "" } },
    { id: "missing_date", label: "No date given", kind: "exception", description: "The customer answers everything except the date. Checkout stays blocked until a date is given.", inputs: { item: "Birthday cake", partial_first: true, date: "Not stated", quantity: 12, budget: 100, style: "Catalogue design", fulfilment: "Collection 3pm", dietary: "" } },
    { id: "capacity_full", label: "Full production day", kind: "exception", description: "Saturday is fully booked. The assistant offers the days that still have space.", inputs: { item: "Birthday cake", partial_first: false, date: "Sat 11 Oct", quantity: 30, budget: 180, style: "Catalogue design", fulfilment: "Collection 10am", dietary: "" } },
    { id: "dietary_custom", label: "Nut allergy and custom design", kind: "exception", description: "The request is flagged for owner review with no safety guarantee, and the custom design fee is set by the owner.", inputs: { item: "Birthday cake", partial_first: false, date: "Sun 12 Oct", quantity: 20, budget: 200, style: "Custom design (reference photo)", fulfilment: "Delivery (A$15)", dietary: "Nut allergy" } },
    { id: "flowers", label: "Flower delivery", kind: "success", description: "A complete flower order with delivery, priced from the catalogue.", inputs: { item: "Flower arrangement", partial_first: false, date: "Sun 12 Oct", quantity: 24, budget: 120, style: "Catalogue design", fulfilment: "Delivery (A$15)", dietary: "" } },
  ],
  start(inputs, scenarioId) {
    const item: Item = ITEMS.includes(inputs.item as Item) ? (inputs.item as Item) : "Birthday cake";
    const sim = Sim.begin<State>("order-assistant", scenarioId, inputs, {
      step: "gathering",
      brief: { item, date: null, qty: null, style: "Catalogue design", fulfilment: null, dietary: "", budget: null, designNote: "" },
      asks: 0,
      unclear: 0,
      quoteVersion: 0,
      revised: false,
      total: 0,
      deposit: 0,
      customFee: 0,
      payRef: "",
      orderRef: "",
      ticketRef: "",
      requestRef: "",
    });
    const s = sim.s;
    s.requestRef = sim.ref("REQ");
    const partial = sim.bool("partial_first");
    const full = {
      date: DATES.includes(sim.str("date")) ? sim.str("date") : "",
      qty: Math.max(0, Math.round(sim.num("quantity"))),
      fulfilment: FULFILMENT.includes(sim.str("fulfilment")) ? sim.str("fulfilment") : "",
    };
    s.brief.style = sim.str("style").startsWith("Custom") ? "Custom design (reference photo)" : "Catalogue design";
    s.brief.dietary = sim.str("dietary").trim();
    s.brief.budget = sim.num("budget") > 0 ? sim.num("budget") : null;
    if (isCustom(s.brief)) s.brief.designNote = "reference photo supplied";

    // 1. Customer message
    sim.say("customer", firstMessage(s.brief, partial, full));
    sim.emit("message", "passed", "Customer message received", `Website chat, ${TODAY}.`, { ref: s.requestRef });

    // 2. Structured brief
    if (!partial) {
      s.brief.date = full.date || null;
      s.brief.qty = full.qty || null;
      s.brief.fulfilment = full.fulfilment || null;
    }
    sim.emit("brief", "started", "Extracting fields into the fixed order schema", "Only stated values are filled; nothing is guessed.");
    progress(sim);
    return sim.done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;
    const b = s.brief;

    switch (actionId) {
      case "answer": {
        if (s.step !== "gathering") return sim.done();
        sim.advance(20);
        const parts: string[] = [];
        const d = sim.str("date");
        if (!b.date) {
          if (DATES.includes(d)) {
            b.date = d;
            parts.push(`It’s for ${d}.`);
          } else parts.push("Not sure about the date yet.");
        }
        const q = Math.round(sim.num("quantity"));
        if (!b.qty && q > 0) {
          b.qty = q;
          parts.push(b.item === "Birthday cake" ? `About ${q} people.` : `Around ${q} stems.`);
        }
        const f = sim.str("fulfilment");
        if (!b.fulfilment && FULFILMENT.includes(f)) {
          b.fulfilment = f;
          parts.push(f.startsWith("Delivery") ? "Delivery please." : `I’ll collect at ${f.replace("Collection ", "")}.`);
        }
        sim.say("customer", parts.join(" "));
        sim.emit("brief", "info", "Reply parsed into the brief");
        progress(sim);
        return sim.done();
      }

      case "give_date": {
        if (s.step !== "gathering" || b.date) return sim.done();
        sim.advance(20);
        sim.say("customer", "Let’s say Friday 10 October.");
        b.date = "Fri 10 Oct";
        sim.emit("brief", "info", "Date added: Fri 10 Oct");
        progress(sim);
        return sim.done();
      }

      case "no_reply": {
        if (s.step !== "gathering") return sim.done();
        sim.advance(2 * DAY);
        if (s.asks >= MAX_ASKS) {
          handoffIncomplete(sim, "The customer stopped replying.");
          return sim.done();
        }
        sim.emit("missing", "info", "No reply in 2 days — one reminder");
        askForMissing(sim);
        return sim.done();
      }

      case "free": {
        if (s.step !== "gathering" && s.step !== "capfull") return sim.done();
        sim.advance(10);
        const text = (payload ?? "").trim();
        sim.say("customer", text || "(empty message)");
        const p = parse(text);
        if (p.stop) {
          s.step = "done";
          sim.emit("missing", "stopped", "Customer withdrew the enquiry");
          setRequest(sim, "Withdrawn — no order", "muted");
          sim.say("assistant", "No problem — I’ve closed this request. Get in touch any time.");
          return sim.finish("stopped", { kind: "stopped", summary: "The customer withdrew the enquiry. No quote, deposit or order was created." }).done();
        }
        const got: string[] = [];
        if (p.date) {
          b.date = p.date;
          got.push(`date ${p.date}`);
        }
        if (p.qty) {
          b.qty = p.qty;
          got.push(`${p.qty} ${UNIT[b.item]}`);
        }
        if (p.budget) {
          b.budget = p.budget;
          got.push(`budget ${aud(p.budget)}`);
        }
        if (p.fulfilment) {
          b.fulfilment = p.fulfilment;
          got.push(p.fulfilment);
        }
        if (p.dietary && !b.dietary) {
          b.dietary = p.dietary;
          got.push("dietary request (for owner review)");
        }
        if (s.step === "capfull") {
          if (p.date) {
            sim.emit("capfull", "info", `Customer chose ${p.date}`);
            briefRecord(sim);
            checkCapacity(sim);
            return sim.done();
          }
          sim.emit("capfull", "info", "Reply did not name a date with space");
          sim.say("assistant", `Sorry, I didn’t catch a date there. I can do ${alternatives(b.item, b.date ?? "").join(" or ") || "no other day this week"} — which would suit?`);
          return sim.done();
        }
        if (!got.length) {
          s.unclear += 1;
          sim.emit("brief", "info", "Reply not understood — nothing added to the brief", p.otherDay ? `“${p.otherDay}” is not a production day in this demo.` : p.price ? "Price question: prices come only from the catalogue." : undefined);
          if (s.unclear >= 3) {
            handoffIncomplete(sim, "Three replies could not be matched to the order form.");
            return sim.done();
          }
          if (p.price) sim.say("assistant", "Our prices come from a fixed catalogue and the owner reviews every quote, so I can’t change them. Once I have the details I’ll get you an exact figure.");
          else if (p.otherDay) sim.say("assistant", `We make custom orders for Friday to Sunday this week — would ${DATES.filter((d) => (CAPACITY[b.item][d] ?? 0) > 0).join(" or ")} work?`);
          else sim.say("assistant", `Sorry, I’m not sure I followed. Could you tell me ${missing(b).join(", ") || "a little more"}?`);
          sim.wait("waiting_customer", gatherActions(sim));
          return sim.done();
        }
        if (p.collectNoTime && !b.fulfilment) got.push("collection (time still needed)");
        sim.emit("brief", "info", `Reply parsed: ${got.join(", ")}`);
        progress(sim);
        return sim.done();
      }

      case "alt1":
      case "alt2": {
        if (s.step !== "capfull" || !b.date) return sim.done();
        const alts = alternatives(b.item, b.date);
        const pick = alts[actionId === "alt1" ? 0 : 1];
        if (!pick) return sim.done();
        sim.advance(15);
        sim.say("customer", `${pick} works.`);
        sim.emit("capfull", "info", `Customer chose alternative date ${pick}`);
        b.date = pick;
        briefRecord(sim);
        checkCapacity(sim);
        return sim.done();
      }

      case "keep_date": {
        if (s.step !== "capfull") return sim.done();
        s.step = "done";
        sim.say("customer", `It has to be ${b.date}, sorry.`);
        sim.emit("capfull", "stopped", "No capacity on the requested date — enquiry closed", "The owner can add it to a waitlist; the assistant does not overbook.");
        setRequest(sim, "Closed — date unavailable, no order", "muted");
        return sim.finish("stopped", { kind: "exception", summary: `${b.date} has no production capacity and the customer could not move, so no quote or order was created.` }).done();
      }

      case "owner_revise": {
        if (s.step !== "owner" || s.revised) return sim.done();
        s.revised = true;
        s.step = "clarify";
        sim.say("staff", "Owner: before I price this, I need to know more.");
        sim.emit("revision", "waiting", "Brief needs revision — customer asked to clarify");
        sim.patch("quote", { status: `v${s.quoteVersion} withdrawn — brief under revision`, tone: "muted" });
        const qText = b.dietary
          ? "The owner asks: is this a severe allergy? We can leave nuts off the cake but it’s made in a kitchen that uses nuts."
          : isCustom(b)
            ? "The owner asks: could you confirm the colours and any writing on the design?"
            : "The owner asks: which flavour and colour would you like?";
        sim.say("assistant", qText);
        setRequest(sim, "Enquiry — clarifying with customer", "warn");
        return sim
          .wait("waiting_customer", [
            { id: "clarify_reply", label: "Reply with the clarification", actor: "customer", tone: "primary" },
            { id: "withdraw", label: "Withdraw the request", actor: "customer", tone: "danger" },
          ])
          .done();
      }

      case "clarify_reply": {
        if (s.step !== "clarify") return sim.done();
        sim.advance(HOUR);
        const reply = b.dietary
          ? "It’s a mild allergy — no nuts on or in the cake is fine, we understand about the kitchen."
          : isCustom(b)
            ? "Pink and gold, with “Happy 7th Ava” on top."
            : "Chocolate with pink icing, please.";
        sim.say("customer", reply);
        b.designNote = (b.designNote ? b.designNote + "; " : "") + reply.replace(/\.$/, "");
        sim.emit("revision", "passed", "Clarification added to the brief");
        briefRecord(sim);
        sim.emit("brief", "passed", "Brief revised");
        draftQuote(sim);
        return sim.done();
      }

      case "withdraw": {
        s.step = "done";
        sim.say("customer", "Actually, let’s leave it.");
        sim.emit("revision", "stopped", "Customer withdrew during revision");
        setRequest(sim, "Withdrawn — no order", "muted");
        return sim.finish("stopped", { kind: "stopped", summary: "The customer withdrew while the brief was being clarified. No deposit or order was created." }).done();
      }

      case "owner_decline": {
        if (s.step !== "owner") return sim.done();
        s.step = "done";
        sim.emit("check_review", "failed", "Owner declined the order");
        sim.emit("owner", "stopped", "Order declined by owner");
        sim.patch("quote", { status: "Declined by owner", tone: "bad" });
        setRequest(sim, "Declined — no order", "bad");
        sim.say("assistant", "Sorry — the owner isn’t able to take this order. Nothing has been charged.");
        return sim.finish("stopped", { kind: "exception", summary: "The owner declined the request, so no quote or deposit was sent." }).done();
      }

      case "owner_approve": {
        if (s.step !== "owner") return sim.done();
        sim.advance(2 * HOUR);
        s.customFee = isCustom(b) ? CUSTOM_FEE[b.item] : 0;
        s.total += s.customFee;
        s.deposit = Math.round(s.total * DEPOSIT_SHARE);
        const approval = sim.ref("APR");
        if (b.dietary) sim.emit("check_review", "passed", "Owner reviewed dietary request", "Owner decides what the kitchen can do; the quote carries no safety guarantee.");
        if (isCustom(b)) sim.emit("check_review", "passed", `Owner approved custom design fee ${aud(s.customFee)}`);
        sim.emit("check_review", "passed", `Owner approved quote v${s.quoteVersion}: ${aud(s.total)}`, undefined, { ref: approval });
        sim.emit("owner", "confirmed", "Design and price approved", undefined, { ref: approval });
        sim.patch("quote", {
          status: `Approved v${s.quoteVersion} — deposit requested`,
          tone: "ok",
          fields: [
            ...(isCustom(b) ? [{ label: "Custom design", value: `${aud(s.customFee)} (set by owner)` }] : []),
            ...(b.dietary ? [{ label: "Dietary note", value: "Reviewed by owner — no allergen-free guarantee", tone: "warn" as const }] : []),
            { label: "Total", value: aud(s.total) },
            { label: "Deposit (50%)", value: aud(s.deposit) },
            { label: "Owner approval", value: approval, tone: "ok" },
          ],
        });
        // 5. Send deposit checkout
        const key = `${s.requestRef}:checkout:v${s.quoteVersion}`;
        if (sim.claim(key, "checkout", "deposit request")) {
          sim.send({ channel: "chat", to: "Jess Taylor", summary: `Quote v${s.quoteVersion} ${aud(s.total)} + deposit link ${aud(s.deposit)}`, status: "held", opKey: key });
          sim.emit("checkout", "waiting", `Deposit checkout sent: ${aud(s.deposit)}`, "Slot held for 48 hours. Held in the demo outbox.", { opKey: key });
        }
        sim.say("assistant", `Good news — ${SHOP} can make this for ${b.date}. Total ${aud(s.total)}; a ${aud(s.deposit)} deposit confirms your order.${b.dietary ? " Please note we can’t guarantee allergen-free preparation." : ""} The link is valid for 48 hours.`);
        s.step = "checkout";
        setRequest(sim, "Quote approved — deposit unpaid (not an order)", "warn");
        return sim
          .wait("waiting_customer", [
            { id: "pay_deposit", label: `Pay ${aud(s.deposit)} deposit (sample)`, actor: "customer", tone: "primary" },
            { id: "expire", label: "Advance clock 48 hours (deposit unpaid)", actor: "clock" },
          ])
          .done();
      }

      case "expire": {
        if (s.step !== "checkout") return sim.done();
        sim.advance(2 * DAY);
        s.step = "done";
        sim.emit("checkout", "stopped", "Deposit not paid within 48 hours — quote expired", "Held slot released. No order exists.");
        sim.patch("quote", { status: `Expired v${s.quoteVersion} — unpaid`, tone: "muted" });
        setRequest(sim, "Unpaid — quote expired, no order", "muted");
        return sim.finish("stopped", { kind: "exception", summary: "The approved quote was never paid, so it expired and the slot was released. It stays an unpaid request, not an order." }).done();
      }

      case "pay_deposit":
      case "replay": {
        if (actionId === "pay_deposit" && s.step !== "checkout") return sim.done();
        if (actionId === "replay" && s.step !== "confirmed") return sim.done();
        sim.advance(actionId === "replay" ? 2 : 30);
        if (actionId === "pay_deposit") s.payRef = sim.ref("PAY");
        else sim.emit("deposit", "info", `Deposit event ${s.payRef} received again`, "Payment provider retried the webhook.", { ref: s.payRef });
        const key = `deposit:${s.payRef}`;
        if (!sim.claim(key, "deposit", "deposit event")) {
          sim.claim(`ticket:${s.payRef}`, "deposit", "production ticket");
          sim.patch("order", { fields: [{ label: "Duplicate deposit events", value: "Ignored — one order kept", tone: "ok" }] });
          return sim.done();
        }
        sim.say("customer", "Deposit paid!");
        sim.send({ channel: "payment", to: "Payment provider (sandbox)", summary: `Deposit ${s.payRef} succeeded — ${aud(s.deposit)}`, status: "simulated", opKey: key });
        sim.emit("check_payment", "passed", `Deposit event ${s.payRef} verified`, `${aud(s.deposit)} against quote v${s.quoteVersion}.`, { ref: s.payRef, opKey: key });
        s.orderRef = sim.ref("ORD");
        s.ticketRef = sim.ref("PT");
        const tKey = `ticket:${s.payRef}`;
        sim.claim(tKey, "deposit", "production ticket");
        sim.send({ channel: "task", to: "Production calendar", summary: `${s.ticketRef}: ${b.item}, ${b.date}, ${b.qty} ${UNIT[b.item]}${b.dietary ? " — DIETARY NOTE" : ""}`, status: "simulated", opKey: tKey });
        sim.emit("deposit", "confirmed", `Order ${s.orderRef} created with production ticket ${s.ticketRef}`, undefined, { ref: s.orderRef, opKey: tKey });
        sim.record({
          id: "order",
          title: "Confirmed order",
          ref: s.orderRef,
          status: "Confirmed — deposit paid",
          tone: "ok",
          fields: [
            { label: "Item", value: `${b.item}, ${b.qty} ${UNIT[b.item]}` },
            { label: "Date", value: `${b.date} — ${b.fulfilment}` },
            { label: "Total / deposit", value: `${aud(s.total)} / ${aud(s.deposit)} paid` },
            { label: "Balance due", value: aud(s.total - s.deposit) },
            { label: "Deposit event", value: `${s.payRef} (simulated)`, tone: "ok" },
            { label: "Production ticket", value: `${s.ticketRef} — awaiting kitchen` },
            ...(b.dietary ? [{ label: "Dietary", value: `${b.dietary} — owner reviewed, no guarantee`, tone: "warn" as const }] : []),
          ],
        });
        sim.patch("quote", { status: `Accepted v${s.quoteVersion} — deposit paid`, tone: "ok" });
        setRequest(sim, `Confirmed order ${s.orderRef}`, "ok");
        sim.say("assistant", `Your order ${s.orderRef} is confirmed for ${b.date}. The balance of ${aud(s.total - s.deposit)} is due on ${b.fulfilment?.startsWith("Delivery") ? "delivery" : "collection"}.`);
        s.step = "confirmed";
        return sim
          .wait("waiting_staff", [
            { id: "ticket_ack", label: "Kitchen: accept production ticket", actor: "staff", tone: "primary" },
            { id: "replay", label: "Payment provider resends the deposit event", actor: "clock", hint: "Must not create a second order." },
          ])
          .done();
      }

      case "ticket_ack": {
        if (s.step !== "confirmed") return sim.done();
        s.step = "done";
        sim.say("staff", `Kitchen: ${s.ticketRef} scheduled for ${b.date}.`);
        sim.emit("deposit", "confirmed", `Production ticket ${s.ticketRef} accepted by the kitchen`);
        sim.patch("order", { fields: [{ label: "Production ticket", value: `${s.ticketRef} — scheduled`, tone: "ok" }] });
        return sim
          .finish("completed", {
            kind: "success",
            summary: `Deposit ${s.payRef} was verified, creating one order ${s.orderRef} and production ticket ${s.ticketRef} for ${b.date}. Prices came only from the catalogue${s.customFee ? " plus the owner-set design fee" : ""}.`,
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

export const orderAssistant: Product = {
  id: "order-assistant",
  no: 17,
  slug: "order-assistant",
  name: "Order Assistant",
  outcome: "Turn scattered messages into complete orders.",
  sectorLabel: "Florists, custom cake bakers and caterers",
  sectors: ["Local orders"],
  outcomes: ["Manage orders", "Capture enquiries"],
  definition:
    "Collects a complete custom-order brief, checks production constraints and sends an owner-approved deposit request. Prices come only from the catalogue, custom designs and dietary requests go to the owner, and an order exists only once the deposit is verified.",
  situation:
    "A customer messages asking for a birthday cake but leaves out the date, how many people it should serve and when they will collect it. Saturday is already full in the kitchen, and a nut allergy mention needs the owner’s judgement rather than a quick yes.",
  endState:
    "Every enquiry becomes a complete brief in one fixed format, the owner approves a catalogue-priced quote in one step, and only deposit-paid requests reach the production calendar.",
  handles: [
    "Asks for missing details and fills a fixed order schema without guessing",
    "Checks the date against cutoff and production capacity and offers days with space",
    "Prices from the catalogue only and flags custom designs and dietary requests for the owner",
    "Sends the owner-approved deposit request and creates one order and production ticket per verified deposit",
    "Keeps incomplete, unpaid and confirmed requests visibly separate",
  ],
  boundaries: [
    "Never promises that food is safe for an allergy or intolerance",
    "Never invents a price or discount outside the catalogue",
    "No checkout without a date, and no order without a verified deposit",
    "The public demo sends no messages and takes no payment",
  ],
  delivered: [
    { title: "Customer quote and deposit link", body: "Item, date, size, delivery or collection time, catalogue price and deposit, sent only after the owner approves." },
    { title: "Owner review", body: "The structured brief with any custom design or dietary request flagged, the catalogue calculation and a one-step approve, revise or decline." },
    { title: "Order and production ticket", body: "Created once from the verified deposit event, with balance due and any dietary note carried onto the kitchen ticket." },
  ],
  deployment: {
    rules: [
      "Your catalogue sizes, prices, delivery fee and deposit share",
      "Production capacity per day and order cutoff",
      "Which requests need owner review (custom designs, dietary, large orders)",
      "How long a quote holds a production slot",
    ],
    systems: ["Website chat, messaging or order form", "Product catalogue", "Production calendar", "Quoting", "Payments"],
  },
  measures: ["Deposit-paid orders", "Fulfilled order value", "Production exception rate"],
  reliability: ["Duplicate orders from repeated deposit events (target: zero)", "Quotes sent without owner approval (target: zero)", "Orders accepted on a full production day (target: zero)"],
  harness: {
    systems:
      "Production connects messaging or a form, the product catalogue, a production calendar, quoting and payments. The demo uses a sample catalogue and calendar, keyword rules for typed replies and an outbox that holds every message.",
    controls: [
      "Order cutoff and daily production capacity",
      "Required fields before any capacity check or checkout",
      "Owner review of custom designs and dietary requests, with no safety guarantee",
      "Catalogue-approved prices only",
      "Verified deposit event before an order or production ticket exists",
    ],
  },
  ctaLine: "Want this turning your own messages into complete orders?",
  graph: {
    nodes: [
      { id: "message", kind: "action", row: 0, title: "Customer message", input: "Chat, message or form", rule: "Log the request with a reference", output: "Enquiry reference", failure: "—", system: "Website chat (demo: simulated)" },
      { id: "brief", kind: "action", row: 1, title: "Build structured order brief", input: "Customer messages", rule: "Fixed schema; only stated values; keyword rules for typed replies", output: "Order brief", failure: "Missing fields → ask customer", system: "Session state" },
      { id: "capacity", kind: "action", row: 2, title: "Check date and production capacity", input: "Complete brief", rule: `≥ ${MIN_NOTICE_DAYS} days’ notice; free slot on the day`, output: "Provisional slot", failure: "Full day → alternatives", system: "Production calendar (demo: fixture)" },
      { id: "owner", kind: "action", row: 3, title: "Owner approves design and price", input: "Brief + catalogue calculation", rule: "Owner approves every quote; sets any custom design fee", output: "Approved quote version", failure: "Needs revision → clarify; decline → stop", system: "Owner console (demo: staff action)" },
      { id: "checkout", kind: "action", row: 4, title: "Send deposit checkout", input: "Approved quote", rule: "50% deposit; slot held 48 hours", output: "Deposit request", failure: "Unpaid → quote expires, slot released", system: "Chat + payment link (demo: held outbox)" },
      { id: "deposit", kind: "action", row: 5, title: "Verify deposit and create order", input: "Deposit event", rule: "One order and ticket per event id", output: "Order + production ticket", failure: "Duplicate event → ignored", system: "Payments (demo: simulated event)" },
      { id: "missing", kind: "branch", row: 0.8, title: "Missing details", input: "Date, quantity or fulfilment not stated", rule: `Ask; max ${MAX_ASKS} questions, then owner handoff`, output: "Question to customer", failure: "No date → checkout blocked" },
      { id: "capfull", kind: "branch", row: 2.4, title: "Capacity full", input: "No slot on the requested day", rule: "Offer days with space; never overbook", output: "Alternative dates", failure: "Customer can’t move → close" },
      { id: "revision", kind: "branch", row: 4, title: "Brief needs revision", input: "Owner needs more detail", rule: "Customer clarifies; brief and quote re-versioned", output: "Revised brief", failure: "Customer withdraws → stop" },
      { id: "check_capacity", kind: "check", row: 1.6, title: "Cutoff and capacity", input: "Date and item", rule: "Date required; notice and daily slots checked", output: "Pass / blocked", failure: "Blocked → no checkout" },
      { id: "check_review", kind: "check", row: 3, title: "Design and dietary review", input: "Custom design, dietary request, price", rule: "Owner review; no safety guarantee; catalogue prices only", output: "Owner approval", failure: "Declined → stop" },
      { id: "check_payment", kind: "check", row: 4.9, title: "Payment verified", input: "Deposit event", rule: "Succeeded event for the current quote version", output: "Verified payment reference", failure: "Unpaid → not an order" },
    ],
    edges: [
      { from: "message", to: "brief", kind: "flow" },
      { from: "brief", to: "capacity", kind: "flow" },
      { from: "capacity", to: "owner", kind: "flow" },
      { from: "owner", to: "checkout", kind: "flow" },
      { from: "checkout", to: "deposit", kind: "flow" },
      { from: "brief", to: "missing", kind: "return" },
      { from: "missing", to: "brief", kind: "return", label: "ask customer" },
      { from: "capacity", to: "capfull", kind: "return" },
      { from: "capfull", to: "brief", kind: "return", label: "alternative date" },
      { from: "owner", to: "revision", kind: "return" },
      { from: "revision", to: "brief", kind: "return", label: "clarify" },
      { from: "check_capacity", to: "capacity", kind: "check" },
      { from: "check_review", to: "owner", kind: "check" },
      { from: "check_payment", to: "deposit", kind: "check" },
    ],
  },
  demo,
};
