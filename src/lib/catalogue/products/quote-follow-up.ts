import type { DemoAction, DemoDefinition, Product } from "../types";
import { Sim, aud, DAY, HOUR } from "../sim";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional)                                                */
/* ------------------------------------------------------------------ */

const BUSINESS = "Greenleaf Gardening";
const OWNER = "Ben (owner)";
const CUSTOMER = { name: "Hannah Lee", email: "hannah@lee.example" };
const QUOTE_NO = "Q-2417";

interface QuoteVersion {
  price: number;
  scope: string;
  wasteRemoval: boolean;
  note: string;
}

/** Three versioned sample quotes from the quoting tool. */
const VERSIONS: QuoteVersion[] = [
  { price: 420, scope: "Trim front and side hedges (about 40 m); clippings bagged and left on site", wasteRemoval: false, note: "Original quote" },
  { price: 480, scope: "Trim front and side hedges (about 40 m) and remove green waste", wasteRemoval: true, note: "Owner-approved revision: green waste removal +A$60" },
  { price: 520, scope: "Trim front and side hedges, remove green waste and shape two topiary balls", wasteRemoval: true, note: "Owner-approved revision: topiary shaping +A$40" },
];
const VERSION_OPTIONS = VERSIONS.map((v, i) => `v${i + 1} — ${aud(v.price)}`);

/** The extra task the customer asks for, and the owner's approved price for it, by current version. */
const EXTRA_REQUEST: { ask: string; task: string; extra: number }[] = [
  { ask: "Could you also take the green waste away?", task: "green waste removal", extra: 60 },
  { ask: "Could you also shape the two topiary balls by the gate?", task: "topiary shaping", extra: 40 },
  { ask: "Could you also mow the front lawn while you're there?", task: "front lawn mow", extra: 50 },
];

const FOLLOW_UP_DAYS = [3, 7, 12];
const MAX_FOLLOW_UPS = FOLLOW_UP_DAYS.length;
const VALID_DAYS = 30;
const REPLIES = ["Accept", "Ask a question", "Request an extra task", "Decline", "No reply"];

type Step = "await_due" | "await_reply" | "await_owner_scope" | "await_owner_price" | "await_owner_expired" | "done";

interface Version {
  price: number;
  scope: string;
  wasteRemoval: boolean;
  note: string;
}

interface State {
  step: Step;
  day: number; // days since the original quote was issued
  versionNo: number;
  versions: Version[]; // index = versionNo - 1
  versionIssuedDay: number;
  sent: number; // follow-ups sent for the current version
  fu: string[]; // status per follow-up slot for the current version
  lastKey: string | null;
  superseded: number[];
  pendingExtra: { task: string; extra: number } | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function cur(s: State): Version {
  return s.versions[s.versionNo - 1];
}

function nextDue(s: State): number | null {
  return s.sent < MAX_FOLLOW_UPS ? s.versionIssuedDay + FOLLOW_UP_DAYS[s.sent] : null;
}

function expiresDay(s: State) {
  return s.versionIssuedDay + VALID_DAYS;
}

function quoteRecord(sim: Sim<State>, status: string, tone: "ok" | "warn" | "bad" | "default" | "muted" = "default") {
  const s = sim.s;
  const v = cur(s);
  sim.record({
    id: "quote",
    title: `Quote ${QUOTE_NO}`,
    ref: `${QUOTE_NO}-v${s.versionNo}`,
    status,
    tone,
    fields: [
      { label: "Current version", value: `v${s.versionNo}` },
      { label: "Price", value: aud(v.price) },
      { label: "Scope", value: v.scope },
      { label: "Version note", value: v.note },
      { label: "Issued", value: `Day ${s.versionIssuedDay}` },
      { label: "Valid until", value: `Day ${expiresDay(s)}`, tone: s.day >= expiresDay(s) ? "bad" : "default" },
      { label: "Superseded", value: s.superseded.length ? s.superseded.map((n) => `v${n}`).join(", ") : "None", tone: s.superseded.length ? "warn" : "muted" },
    ],
  });
}

function followUpRecord(sim: Sim<State>) {
  const s = sim.s;
  sim.record({
    id: "followups",
    title: `Follow-ups for v${s.versionNo}`,
    status: `${s.sent} of ${MAX_FOLLOW_UPS} sent`,
    tone: s.sent >= MAX_FOLLOW_UPS ? "warn" : "default",
    fields: FOLLOW_UP_DAYS.map((d, i) => ({
      label: `Follow-up ${i + 1} (day ${s.versionIssuedDay + d})`,
      value: s.fu[i],
      tone: s.fu[i].startsWith("Cancelled") ? ("muted" as const) : s.fu[i].startsWith("Sent") ? ("ok" as const) : ("default" as const),
    })),
  });
}

function replyActions(sim: Sim<State>, opts: { oldLink?: boolean } = {}): DemoAction[] {
  const s = sim.s;
  const planned = sim.str("planned_reply");
  const due = nextDue(s);
  const tone = (r: string) => (planned === r ? ("primary" as const) : ("default" as const));
  const acts: DemoAction[] = [
    { id: "reply_accept", label: "“Yes, let's go ahead.”", actor: "customer", tone: tone("Accept") },
    { id: "reply_question", label: "“Does that include taking the clippings away?”", actor: "customer", tone: tone("Ask a question") },
    { id: "reply_extra", label: `“${EXTRA_REQUEST[Math.min(s.versionNo - 1, EXTRA_REQUEST.length - 1)].ask}”`, actor: "customer", tone: tone("Request an extra task"), hint: "Scope change — needs the owner." },
    { id: "reply_decline", label: "“Thanks, but we won't go ahead.”", actor: "customer", tone: planned === "Decline" ? "primary" : "danger" },
    { id: "free", label: "Write your own reply", actor: "customer", freeText: { placeholder: "e.g. “Can you do it any cheaper?”" } },
  ];
  if (opts.oldLink && s.superseded.length) acts.push({ id: "accept_old", label: `Click Accept on the old v${s.superseded[s.superseded.length - 1]} link`, actor: "customer" });
  if (s.lastKey) acts.push({ id: "retry_send", label: "Simulate messaging retry", actor: "clock", hint: "The last message is submitted to the provider again." });
  acts.push({
    id: "advance",
    label: due !== null ? `Advance clock to day ${due} (no reply)` : "Advance clock 3 days (no reply)",
    actor: "clock",
    tone: planned === "No reply" ? "primary" : "default",
  });
  return acts;
}

function waitReply(sim: Sim<State>, opts: { oldLink?: boolean } = {}) {
  sim.s.step = "await_reply";
  return sim.wait("waiting_customer", replyActions(sim, opts));
}

function waitDue(sim: Sim<State>) {
  const s = sim.s;
  s.step = "await_due";
  const due = nextDue(s)!;
  return sim.wait("running", [{ id: "advance", label: `Advance clock to day ${due} (follow-up ${s.sent + 1} due)`, actor: "clock", tone: "primary" }]);
}

function versionCheck(sim: Sim<State>): boolean {
  const s = sim.s;
  if (s.day >= expiresDay(s)) {
    sim.emit("check_quote", "failed", `Quote v${s.versionNo} expired on day ${expiresDay(s)}`, `Quotes are valid for ${VALID_DAYS} days. No follow-up or acceptance on an expired quote.`);
    sim.emit("version", "blocked", "Expired — owner decision needed");
    quoteRecord(sim, "Expired — awaiting owner", "bad");
    s.step = "await_owner_expired";
    sim.wait("waiting_staff", [
      { id: "reissue", label: `Owner: reissue as v${s.versionNo + 1} at ${aud(cur(s).price)}, valid ${VALID_DAYS} days`, actor: "staff", tone: "primary" },
      { id: "close_expired", label: "Owner: close the quote", actor: "staff", tone: "danger" },
    ]);
    return false;
  }
  sim.emit("check_quote", "passed", `v${s.versionNo} is the current approved quote`, `${aud(cur(s).price)} · valid until day ${expiresDay(s)}.`);
  sim.emit("version", "passed", `Quote v${s.versionNo} open and current`);
  return true;
}

function sendFollowUp(sim: Sim<State>) {
  const s = sim.s;
  const n = s.sent + 1;
  const key = `${QUOTE_NO}:v${s.versionNo}:followup:${n}`;
  sim.emit("check_contact", "passed", `Follow-up ${n} of ${MAX_FOLLOW_UPS} allowed`, "Within the contact limit; no decision or opt-out recorded.");
  if (!sim.claim(key, "send", "follow-up")) return;
  s.sent = n;
  s.fu[n - 1] = `Sent day ${s.day} (held)`;
  s.lastKey = key;
  const v = cur(s);
  const text =
    n === 1
      ? `Hi Hannah, it's the ${BUSINESS} assistant. Just checking you received quote ${QUOTE_NO} (v${s.versionNo}) for ${aud(v.price)}: ${v.scope.toLowerCase()}. Happy to answer any questions.`
      : n === 2
        ? `Hi Hannah, a quick reminder about your hedge-trimming quote (${aud(v.price)}). It's valid until day ${expiresDay(s)}. Reply yes to go ahead or ask anything.`
        : `Hi Hannah, last reminder about quote ${QUOTE_NO} — we won't message again about it. Reply any time before day ${expiresDay(s)} if you'd like to go ahead.`;
  sim.say("assistant", text);
  sim.send({ channel: "sms", to: CUSTOMER.name, summary: `Follow-up ${n} of ${MAX_FOLLOW_UPS} for v${s.versionNo}`, status: "held", opKey: key });
  sim.emit("send", "passed", `Follow-up ${n} of ${MAX_FOLLOW_UPS} sent (held)`, "Held in the demo outbox.", { opKey: key });
  followUpRecord(sim);
  quoteRecord(sim, `Open — follow-up ${n} sent`);
}

function cancelRemaining(sim: Sim<State>, reason: string) {
  const s = sim.s;
  let n = 0;
  for (let i = s.sent; i < MAX_FOLLOW_UPS; i++) {
    s.fu[i] = `Cancelled — ${reason}`;
    n++;
  }
  if (n) sim.send({ channel: "sms", to: CUSTOMER.name, summary: `${n} scheduled follow-up${n === 1 ? "" : "s"} cancelled (${reason})`, status: "suppressed" });
  followUpRecord(sim);
  return n;
}

/* ------------------------------ Outcomes ------------------------------ */

function accept(sim: Sim<State>) {
  const s = sim.s;
  sim.emit("classify", "passed", "Classified: acceptance");
  if (!versionCheck(sim)) return sim;
  sim.emit("approve", "passed", "Acceptance at the approved price — no owner change needed");
  const key = `${QUOTE_NO}:accept:v${s.versionNo}`;
  if (!sim.claim(key, "record", "acceptance")) return waitReply(sim);
  const n = cancelRemaining(sim, "accepted");
  sim.emit("check_contact", "stopped", "Reminders stopped on acceptance", `${n} scheduled follow-up${n === 1 ? "" : "s"} cancelled.`);
  quoteRecord(sim, `Accepted v${s.versionNo} — ${aud(cur(s).price)}`, "ok");
  sim.send({ channel: "crm", to: "Sample quoting tool", summary: `Mark ${QUOTE_NO}-v${s.versionNo} accepted`, status: "simulated", opKey: key });
  sim.emit("record", "confirmed", `Quote v${s.versionNo} accepted`, undefined, { opKey: key, ref: `${QUOTE_NO}-v${s.versionNo}` });
  const inv = sim.ref("BI");
  sim.send({ channel: "sms", to: CUSTOMER.name, summary: `Booking invitation ${inv}: choose a date for the hedge trim`, status: "held", opKey: `${key}:invite` });
  sim.emit("record", "info", "Booking invitation sent (held)", "Customer chooses a date from the gardener's calendar.", { ref: inv });
  sim.record({ id: "invite", title: "Booking invitation", ref: inv, status: "Sent — waiting for customer to pick a date", tone: "default", fields: [{ label: "For", value: `${QUOTE_NO}-v${s.versionNo}` }, { label: "Channel", value: "SMS link (held in demo)" }] });
  sim.say("assistant", `Thanks Hannah — quote v${s.versionNo} (${aud(cur(s).price)}) is accepted. Here's a link to pick a day that suits for the hedge trim.`);
  s.step = "done";
  return sim.finish("completed", { kind: "success", summary: `Quote v${s.versionNo} was accepted at the approved ${aud(cur(s).price)}. Remaining reminders were cancelled and a booking invitation was sent.` });
}

function decline(sim: Sim<State>, reason: string, stopped = false) {
  const s = sim.s;
  sim.emit("classify", "passed", stopped ? "Classified: stop request" : "Classified: decline");
  const key = `${QUOTE_NO}:close`;
  sim.claim(key, "record", "close");
  const n = cancelRemaining(sim, stopped ? "customer asked to stop" : "declined");
  sim.emit("check_contact", "stopped", "Sequence closed", `${n} scheduled follow-up${n === 1 ? "" : "s"} cancelled. No further messages.`);
  quoteRecord(sim, stopped ? "Closed — customer asked to stop" : "Declined — closed", "bad");
  sim.send({ channel: "crm", to: "Sample quoting tool", summary: `Close ${QUOTE_NO} (${reason})`, status: "simulated", opKey: key });
  sim.emit("record", "stopped", stopped ? "Quote closed — stop request" : "Quote closed — declined", reason, { opKey: key });
  sim.say("assistant", stopped ? "Understood — we won't contact you about this quote again." : "Thanks for letting us know, Hannah. We've closed the quote — get in touch any time.");
  s.step = "done";
  return sim.finish(stopped ? "stopped" : "completed", { kind: stopped ? "stopped" : "exception", summary: stopped ? "The customer asked to stop, so the sequence closed and no further follow-ups will be sent." : "The customer declined. The quote is closed with the reason recorded and all remaining follow-ups cancelled." });
}

function noReplyLimit(sim: Sim<State>, atStart: boolean) {
  const s = sim.s;
  sim.emit("noreply", "stopped", `No reply after ${MAX_FOLLOW_UPS} follow-ups`, "Bounded retry exhausted.");
  sim.emit("check_contact", "stopped", "Contact limit reached", "No more automated messages for this version.");
  const key = `${QUOTE_NO}:v${s.versionNo}:owner-call`;
  if (sim.claim(key, "record", "owner task")) sim.send({ channel: "task", to: OWNER, summary: `Call Hannah about ${QUOTE_NO} — no reply to ${MAX_FOLLOW_UPS} follow-ups`, status: "simulated", opKey: key });
  quoteRecord(sim, "Open — no reply, owner to call", "warn");
  followUpRecord(sim);
  sim.emit("record", "stopped", "Handed to owner for a personal call");
  s.step = "done";
  return sim.finish("stopped", {
    kind: "exception",
    summary: atStart
      ? `All ${MAX_FOLLOW_UPS} follow-ups were already sent before day ${s.day}, so no more are allowed. The owner has a task to call.`
      : `The customer did not reply to ${MAX_FOLLOW_UPS} follow-ups, so automated reminders stopped at the limit and the owner has a task to call.`,
  });
}

function scopeRequest(sim: Sim<State>, said: string) {
  const s = sim.s;
  const req = EXTRA_REQUEST[Math.min(s.versionNo - 1, EXTRA_REQUEST.length - 1)];
  s.pendingExtra = { task: req.task, extra: req.extra };
  sim.emit("classify", "passed", "Classified: scope change request");
  sim.emit("scope", "waiting", `Scope change requested: ${req.task}`, "Routed to the owner.");
  sim.emit("check_scope", "blocked", "No automatic price change", "Scope and price change only with owner approval.");
  const key = `${QUOTE_NO}:v${s.versionNo}:scope-task`;
  if (sim.claim(key, "scope", "owner task")) sim.send({ channel: "task", to: OWNER, summary: `Approve scope change on v${s.versionNo}: “${said}”`, status: "simulated", opKey: key });
  sim.say("assistant", "Good question — changes to the job need Ben's approval, so I've passed it to him. You'll hear back shortly.");
  quoteRecord(sim, `Open — scope change awaiting owner`, "warn");
  sim.record({ id: "owner", title: "Owner decision", status: "Waiting for owner", tone: "warn", fields: [{ label: "Request", value: said }, { label: "Automatic price change", value: "Not allowed", tone: "muted" }] });
  s.step = "await_owner_scope";
  return sim.wait("waiting_staff", [
    { id: "approve_scope", label: `Owner: approve ${req.task} +${aud(req.extra)} → v${s.versionNo + 1}`, actor: "staff", tone: "primary" },
    { id: "keep_scope", label: `Owner: keep v${s.versionNo} unchanged`, actor: "staff" },
    { id: "owner_call", label: "Owner: take over by phone", actor: "staff" },
  ]);
}

function priceRequest(sim: Sim<State>, said: string) {
  const s = sim.s;
  sim.emit("classify", "passed", "Classified: price objection");
  sim.emit("scope", "waiting", "Price change requested", "The assistant cannot change price.");
  sim.emit("check_scope", "blocked", "No automatic price change", "Owner decides.");
  sim.say("assistant", "I can't change the price myself — I've asked Ben to look at it.");
  sim.record({ id: "owner", title: "Owner decision", status: "Waiting for owner", tone: "warn", fields: [{ label: "Request", value: said }, { label: "Automatic price change", value: "Not allowed", tone: "muted" }] });
  s.step = "await_owner_price";
  return sim.wait("waiting_staff", [
    { id: "keep_price", label: `Owner: keep ${aud(cur(s).price)}`, actor: "staff", tone: "primary" },
    { id: "owner_call", label: "Owner: take over by phone", actor: "staff" },
  ]);
}

function issueVersion(sim: Sim<State>, v: Version, via: string) {
  const s = sim.s;
  const old = s.versionNo;
  s.superseded.push(old);
  s.versions.push(v);
  s.versionNo = s.versions.length;
  s.versionIssuedDay = s.day;
  s.sent = 0;
  s.fu = FOLLOW_UP_DAYS.map(() => "Scheduled");
  s.pendingExtra = null;
  const key = `${QUOTE_NO}:v${s.versionNo}:issue`;
  sim.claim(key, "revised", "quote issue");
  sim.emit("revised", "info", `Revised quote v${s.versionNo} issued — v${old} superseded`, via, { opKey: key, ref: `${QUOTE_NO}-v${s.versionNo}` });
  sim.send({ channel: "email", to: CUSTOMER.email, summary: `Quote ${QUOTE_NO}-v${s.versionNo}: ${aud(v.price)}`, status: "held", opKey: key });
  s.lastKey = key;
  sim.say("assistant", `Here's the updated quote v${s.versionNo}: ${v.scope.toLowerCase()} for ${aud(v.price)}, valid until day ${expiresDay(s)}. It replaces v${old}.`);
  versionCheck(sim);
  quoteRecord(sim, `Open — v${s.versionNo} sent`);
  followUpRecord(sim);
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

const demo: DemoDefinition<State> = {
  mode: "simulation",
  boundary: "Uses three sample quote versions and a simulation clock. No message is sent and no quote or calendar is changed.",
  assistantName: "Greenleaf assistant",
  channelLabel: "SMS thread with the customer",
  fields: [
    { kind: "number", name: "days_since_issued", label: "Days since quote issued", min: 0, max: 60, suffix: "days", helper: `Follow-ups on days ${FOLLOW_UP_DAYS.join(", ")}; quotes expire after ${VALID_DAYS} days.` },
    { kind: "select", name: "quote_version", label: "Current quote version", options: VERSION_OPTIONS, helper: "Earlier versions count as superseded." },
    { kind: "select", name: "planned_reply", label: "Customer's likely reply", options: REPLIES, helper: "Highlights that reply; you can still choose any." },
  ],
  scenarios: [
    { id: "accepted", label: "Accepted", kind: "success", description: "The A$420 hedge-trimming quote is accepted after the first follow-up.", inputs: { days_since_issued: 2, quote_version: VERSION_OPTIONS[0], planned_reply: "Accept" } },
    { id: "question", label: "Question", kind: "success", description: "The customer asks what's included, gets an answer from the quote, then accepts.", inputs: { days_since_issued: 2, quote_version: VERSION_OPTIONS[0], planned_reply: "Ask a question" } },
    { id: "revision", label: "Revision", kind: "exception", description: "The customer asks for an extra task. The owner approves a new version; no automatic price change.", inputs: { days_since_issued: 2, quote_version: VERSION_OPTIONS[0], planned_reply: "Request an extra task" } },
    { id: "decline", label: "Decline", kind: "exception", description: "Revised v2 quote, second follow-up. The customer declines and the sequence closes.", inputs: { days_since_issued: 6, quote_version: VERSION_OPTIONS[1], planned_reply: "Decline" } },
    { id: "silence", label: "Silence", kind: "exception", description: "No reply. Follow-ups stop at the limit and the owner gets a call task.", inputs: { days_since_issued: 1, quote_version: VERSION_OPTIONS[0], planned_reply: "No reply" } },
    { id: "expired", label: "Expired quote", kind: "exception", description: "The quote is 34 days old. Nothing is sent until the owner reissues or closes it.", inputs: { days_since_issued: 34, quote_version: VERSION_OPTIONS[0], planned_reply: "Accept" } },
  ],

  start(inputs, scenarioId) {
    const sim = Sim.begin<State>("quote-follow-up", scenarioId, inputs, {
      step: "await_due",
      day: 0,
      versionNo: 1,
      versions: [],
      versionIssuedDay: 0,
      sent: 0,
      fu: FOLLOW_UP_DAYS.map(() => "Scheduled"),
      lastKey: null,
      superseded: [],
      pendingExtra: null,
    });
    const s = sim.s;
    const vIdx = Math.max(0, VERSION_OPTIONS.indexOf(sim.str("quote_version")));
    s.versions = VERSIONS.slice(0, vIdx + 1).map((v) => ({ ...v }));
    s.versionNo = vIdx + 1;
    s.superseded = Array.from({ length: vIdx }, (_, i) => i + 1);
    s.day = Math.max(0, Math.min(365, Math.round(sim.num("days_since_issued"))));
    s.versionIssuedDay = 0;
    s.sent = FOLLOW_UP_DAYS.filter((d) => d < s.day).length;
    s.fu = FOLLOW_UP_DAYS.map((d) => (d < s.day ? "Sent before this demo" : "Scheduled"));

    sim.say("system", `${BUSINESS} (sample business) issued quote ${QUOTE_NO} v${s.versionNo} to ${CUSTOMER.name} ${s.day} day${s.day === 1 ? "" : "s"} ago.`);
    sim.emit("due", "started", `Quote ${QUOTE_NO} v${s.versionNo} open — day ${s.day}`, `${aud(cur(s).price)} · ${cur(s).scope}`);
    quoteRecord(sim, "Open — awaiting customer");
    followUpRecord(sim);
    if (!versionCheck(sim)) return sim.done();
    if (s.sent >= MAX_FOLLOW_UPS) return noReplyLimit(sim, true).done();
    const due = nextDue(s)!;
    if (due === s.day) {
      sim.emit("due", "passed", `Follow-up ${s.sent + 1} due today`);
      sendFollowUp(sim);
      return waitReply(sim, { oldLink: true }).done();
    }
    sim.emit("due", "waiting", `Next follow-up due on day ${due}`);
    return waitDue(sim).done();
  },

  act(run, actionId, payload) {
    const sim = Sim.from(run);
    const s = sim.s;

    switch (actionId) {
      case "advance": {
        const due = nextDue(s);
        if (due === null) {
          sim.advance(3 * DAY);
          s.day += 3;
          sim.emit("noreply", "info", "No reply after the final follow-up");
          return noReplyLimit(sim, false).done();
        }
        const gap = Math.max(0, due - s.day);
        sim.advance(gap * DAY);
        s.day = due;
        if (s.step === "await_reply") sim.emit("noreply", "info", `No reply by day ${due}`, "Bounded retry: next follow-up.");
        sim.emit("due", "passed", `Follow-up ${s.sent + 1} due (day ${due})`);
        if (!versionCheck(sim)) return sim.done();
        sendFollowUp(sim);
        return waitReply(sim, { oldLink: true }).done();
      }

      case "retry_send": {
        sim.advance(5);
        sim.emit("send", "info", "Messaging provider retry received");
        sim.claim(s.lastKey ?? "none", "send", "follow-up");
        return waitReply(sim, { oldLink: true }).done();
      }

      case "reply_accept":
        sim.advance(2 * HOUR);
        sim.say("customer", "Yes, let's go ahead.");
        return accept(sim).done();

      case "reply_question":
        sim.advance(2 * HOUR);
        sim.say("customer", "Does that include taking the clippings away?");
        return answerWaste(sim).done();

      case "reply_extra": {
        sim.advance(2 * HOUR);
        const ask = EXTRA_REQUEST[Math.min(s.versionNo - 1, EXTRA_REQUEST.length - 1)].ask;
        sim.say("customer", ask);
        return scopeRequest(sim, ask).done();
      }

      case "reply_decline":
        sim.advance(2 * HOUR);
        sim.say("customer", "Thanks, but we won't go ahead.");
        return decline(sim, "Customer declined").done();

      case "accept_old": {
        const old = s.superseded[s.superseded.length - 1];
        sim.say("customer", `(clicks Accept on the v${old} link)`);
        sim.emit("check_quote", "blocked", `v${old} superseded by v${s.versionNo} — acceptance refused`, "Only the current version can be accepted.");
        sim.say("assistant", `That link is for an older version. The current quote is v${s.versionNo} at ${aud(cur(s).price)} — reply yes to accept it.`);
        return waitReply(sim, { oldLink: true }).done();
      }

      case "approve_scope": {
        const ex = s.pendingExtra ?? { task: "extra task", extra: 0 };
        const prev = cur(s);
        const fixture = VERSIONS[s.versionNo];
        const v: Version = fixture && fixture.price === prev.price + ex.extra
          ? { ...fixture }
          : { price: prev.price + ex.extra, scope: `${prev.scope}; plus ${ex.task}`, wasteRemoval: prev.wasteRemoval, note: `Owner-approved revision: ${ex.task} +${aud(ex.extra)}` };
        sim.say("staff", `Ben: Happy to add ${ex.task} for ${aud(ex.extra)}.`);
        sim.emit("check_scope", "passed", "Owner approved scope and price", `${ex.task} +${aud(ex.extra)}.`);
        sim.emit("approve", "confirmed", `Owner approved v${s.versionNo + 1}`);
        sim.patch("owner", { status: `Approved — ${ex.task} +${aud(ex.extra)}`, tone: "ok", fields: [{ label: "Approved by", value: OWNER }] });
        cancelRemaining(sim, `replaced by v${s.versionNo + 1}`);
        issueVersion(sim, v, `Owner added ${ex.task}. The new version restarts the bounded follow-up schedule.`);
        return waitReply(sim, { oldLink: true }).done();
      }

      case "keep_scope":
      case "keep_price": {
        sim.say("staff", `Ben: I'll keep the quote as it is at ${aud(cur(s).price)}.`);
        sim.emit("check_scope", "passed", "Owner decision recorded — no change");
        sim.emit("approve", "passed", `Owner kept v${s.versionNo} unchanged`);
        sim.patch("owner", { status: "Decided — quote unchanged", tone: "default", fields: [{ label: "Decided by", value: OWNER }] });
        s.pendingExtra = null;
        sim.say("assistant", `Ben has confirmed the quote stays at ${aud(cur(s).price)} for ${cur(s).scope.toLowerCase()}. Would you like to go ahead?`);
        quoteRecord(sim, "Open — awaiting customer");
        return waitReply(sim, { oldLink: true }).done();
      }

      case "owner_call": {
        sim.say("staff", "Ben: I'll give Hannah a call myself.");
        const n = cancelRemaining(sim, "owner took over");
        sim.emit("approve", "stopped", "Human takeover — automation paused");
        sim.emit("check_contact", "stopped", "Automated follow-up stopped on human takeover", `${n} scheduled follow-up${n === 1 ? "" : "s"} cancelled.`);
        sim.patch("owner", { status: "Owner handling by phone", tone: "default" });
        quoteRecord(sim, "Open — owner handling", "warn");
        s.step = "done";
        return sim.finish("stopped", { kind: "stopped", summary: "The owner took the conversation over, so automated follow-ups stopped. The quote stays open under the owner's control." }).done();
      }

      case "reissue": {
        sim.say("staff", `Ben: Reissue it at the same price.`);
        sim.emit("approve", "confirmed", `Owner approved reissue as v${s.versionNo + 1}`);
        sim.record({ id: "owner", title: "Owner decision", status: "Approved — reissue at same price", tone: "ok", fields: [{ label: "Reason", value: `v${s.versionNo} expired on day ${expiresDay(s)}` }] });
        issueVersion(sim, { ...cur(s), note: `Reissued after v${s.versionNo} expired` }, "Expired version replaced; validity restarts today.");
        return waitReply(sim, { oldLink: true }).done();
      }

      case "close_expired": {
        sim.say("staff", "Ben: Close it.");
        sim.emit("approve", "passed", "Owner closed the expired quote");
        quoteRecord(sim, "Closed — expired", "bad");
        cancelRemaining(sim, "expired");
        sim.emit("record", "stopped", "Quote closed — expired");
        s.step = "done";
        return sim.finish("completed", { kind: "exception", summary: `Quote v${s.versionNo} had expired, so nothing was sent. The owner closed it.` }).done();
      }

      case "free":
        sim.advance(2 * HOUR);
        return handleFree(sim, payload ?? "").done();
    }
    return sim.done();
  },
};

function answerWaste(sim: Sim<State>) {
  const s = sim.s;
  const v = cur(s);
  sim.emit("classify", "passed", "Classified: question");
  sim.emit("check_quote", "passed", `Answer taken from quote v${s.versionNo}`);
  sim.say(
    "assistant",
    v.wasteRemoval
      ? `Yes — quote v${s.versionNo} includes green waste removal: ${v.scope.toLowerCase()}.`
      : `Quote v${s.versionNo} covers: ${v.scope.toLowerCase()}. Removal isn't included; if you'd like it added, Ben would need to approve the change.`,
  );
  return waitReply(sim, { oldLink: true });
}

function handleFree(sim: Sim<State>, raw: string) {
  const s = sim.s;
  const text = raw.trim().toLowerCase();
  sim.say("customer", raw.trim() || "…");
  if (/\b(stop|unsubscribe|don't contact|do not contact)\b/.test(text)) return decline(sim, "Customer asked to stop", true);
  if (/(no thanks|not go ahead|won't go ahead|decline|not interested|someone else|went with)/.test(text)) return decline(sim, "Customer declined");
  if (/(cheaper|discount|lower|less|too expensive|\$\d+|price)/.test(text)) return priceRequest(sim, raw.trim());
  if (/\b(also|add|extra|as well|lawn|topiary)\b/.test(text)) return scopeRequest(sim, raw.trim());
  if (/\b(yes|accept|go ahead|let's do it|sounds good|book (it|us) in)\b/.test(text)) return accept(sim);
  if (/(clipping|waste|rubbish|take away|remove|removal|include)/.test(text)) return answerWaste(sim);
  if (/(when|start|date|day)/.test(text)) {
    sim.emit("classify", "passed", "Classified: question");
    sim.say("assistant", "Once you accept, you'll get a booking link to choose a day from Ben's calendar.");
    return waitReply(sim, { oldLink: true });
  }
  if (/\?/.test(text)) {
    sim.emit("classify", "info", "Question not covered by the quote — forwarded to owner");
    const key = `${QUOTE_NO}:question:${sim.run.seq}`;
    if (sim.claim(key, "classify", "owner question")) sim.send({ channel: "task", to: OWNER, summary: `Customer question: “${raw.trim()}”`, status: "simulated", opKey: key });
    sim.say("assistant", "I don't want to guess on that — I've passed your question to Ben.");
    return waitReply(sim, { oldLink: true });
  }
  sim.emit("classify", "info", "Reply not classified — clarifying");
  sim.say("assistant", "Sorry, I'm not sure what you'd like. Would you like to go ahead, ask a question, or change something in the quote?");
  return waitReply(sim, { oldLink: true });
}

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const quoteFollowUp: Product = {
  id: "quote-follow-up",
  no: 4,
  slug: "quote-follow-up",
  name: "Quote Follow-up",
  outcome: "Keep every outstanding quote moving.",
  sectorLabel: "Home services and custom orders",
  sectors: ["Home services", "Local orders"],
  outcomes: ["Convert sales"],
  definition:
    "Follows up quotes you have already issued on a limited schedule, answers questions from the quote itself and helps the customer accept or ask for a change. You keep control of price and scope: any change becomes a new quote version only after you approve it.",
  situation:
    "A gardener sent a A$420 hedge-trimming quote last week and has heard nothing. Chasing it means remembering which quotes are still open, what each one said and whether the customer already asked for something different.",
  endState:
    "Every open quote gets a few well-timed, relevant follow-ups and then stops. Accepted quotes turn into booking invitations, change requests reach the owner as a clear decision, and declined or expired quotes are closed with a reason.",
  handles: [
    "Sends up to three follow-ups on a fixed schedule and stops at the limit",
    "Answers questions from the current quote version only",
    "Routes extra tasks and price requests to the owner for a decision",
    "Issues the owner-approved revision as a new version that supersedes the old one",
    "Stops reminders on acceptance, decline, stop request or owner takeover",
  ],
  boundaries: [
    "Never changes price or scope without owner approval",
    "Never follows up or accepts an expired or superseded quote",
    "Does not send the same follow-up twice, even when a message is retried",
    "The public demo sends no messages and changes no quote",
  ],
  delivered: [
    { title: "Booking invitation", body: "After acceptance, a link to choose a date for the accepted version, with reminders already cancelled." },
    { title: "Owner decision request", body: "The customer's exact request, the current version and price, and approve or keep options — never an automatic price change." },
    { title: "Quote record", body: "Current version, price, scope, validity, superseded versions, follow-up history and final status: accepted, declined, expired or open." },
  ],
  deployment: {
    rules: [
      "Follow-up timing, number of reminders and quiet hours",
      "Quote validity period and what happens on expiry",
      "Which changes need owner approval and who approves them",
      "Message wording for each follow-up and version",
    ],
    systems: ["Quoting tool", "CRM", "Eligible SMS or email channel", "Calendar for booking invitations"],
  },
  measures: ["Accepted quote value", "Completed jobs and margin", "Accepted value compared with baseline follow-up performance"],
  reliability: [
    "Follow-ups sent twice from retries (target: zero)",
    "Messages sent after acceptance, decline or stop (target: zero)",
    "Price or scope changes without owner approval (target: zero)",
  ],
  harness: {
    systems:
      "Production uses the quoting tool, CRM, an eligible messaging channel and a calendar. The demo uses three versioned sample quotes, a simulation clock and an outbox that holds every message.",
    controls: [
      "Check quote expiry and current version before every message or acceptance",
      "Bound reminders to three per version",
      "Stop immediately on acceptance, decline, stop request or owner takeover",
      "Require owner approval for changed scope or price",
      "Use a persistent message key so retries never resend",
    ],
  },
  ctaLine: "Want this following up your own open quotes?",
  graph: {
    nodes: [
      { id: "due", kind: "action", row: 0, title: "Open quote reaches due date", input: "Open quote and schedule", rule: `Follow-ups due on days ${FOLLOW_UP_DAYS.join(", ")} after issue`, output: "Due follow-up", failure: "—", system: "Scheduler (demo: simulation clock)" },
      { id: "version", kind: "action", row: 1, title: "Check quote version and status", input: "Quote record", rule: `Current version only; valid ${VALID_DAYS} days`, output: "Current, valid quote", failure: "Expired → owner reissues or closes", system: "Quoting tool (demo: three sample versions)" },
      { id: "send", kind: "action", row: 2, title: "Send relevant follow-up", input: "Current quote, follow-up number", rule: "Message key per quote version and follow-up", output: "Message in outbox", failure: "Retry → deduplicated", system: "SMS (demo: held outbox)" },
      { id: "classify", kind: "action", row: 3, title: "Classify customer response", input: "Customer reply", rule: "Accept, question, change, price, decline, stop", output: "Classified reply", failure: "Unclear → clarifying question", system: "Session state" },
      { id: "approve", kind: "action", row: 4, title: "Approve next step", input: "Classified reply", rule: "Acceptance at approved price proceeds; changes need owner", output: "Owner decision or go-ahead", failure: "Owner takes over → automation stops", system: "Owner task (demo: staff buttons)" },
      { id: "record", kind: "action", row: 5, title: "Record accepted or closed quote", input: "Final decision", rule: "One acceptance per version; cancel remaining reminders", output: "Accepted + booking invitation, or closed with reason", failure: "—", system: "Quoting tool + CRM (demo: simulated write)" },
      { id: "noreply", kind: "branch", row: 0.8, title: "No reply", input: "No response by next due date", rule: `Next follow-up, max ${MAX_FOLLOW_UPS}; then owner call task`, output: "Next follow-up or stop", failure: "—" },
      { id: "scope", kind: "branch", row: 2.6, title: "Scope change requested", input: "Extra task or price request", rule: "Never change automatically; ask owner", output: "Owner decision task", failure: "—" },
      { id: "revised", kind: "branch", row: 4.4, title: "Revised quote", input: "Owner-approved change", rule: "New version supersedes old; schedule restarts", output: "Quote v(n+1)", failure: "—" },
      { id: "check_quote", kind: "check", row: 0.9, title: "Current approved quote", input: "Version and issue date", rule: "Current version, not expired, not superseded", output: "Pass / blocked", failure: "Expired or old link → blocked" },
      { id: "check_contact", kind: "check", row: 2.2, title: "Contact limit", input: "Follow-ups sent, stop signals", rule: `Max ${MAX_FOLLOW_UPS} per version; stop on decision or takeover`, output: "Allow / stop", failure: "Limit reached → owner call task" },
      { id: "check_scope", kind: "check", row: 4, title: "Scope and price approval", input: "Requested change", rule: "Owner approves any scope or price change", output: "Approved change or unchanged quote", failure: "No approval → no change" },
    ],
    edges: [
      { from: "due", to: "version", kind: "flow" },
      { from: "version", to: "send", kind: "flow" },
      { from: "send", to: "classify", kind: "flow" },
      { from: "classify", to: "approve", kind: "flow" },
      { from: "approve", to: "record", kind: "flow" },
      { from: "classify", to: "noreply", kind: "return" },
      { from: "noreply", to: "version", kind: "return", label: "bounded retry" },
      { from: "classify", to: "scope", kind: "return" },
      { from: "scope", to: "approve", kind: "return", label: "owner decision" },
      { from: "approve", to: "revised", kind: "return" },
      { from: "revised", to: "version", kind: "return", label: "new version" },
      { from: "check_quote", to: "version", kind: "check" },
      { from: "check_contact", to: "send", kind: "check" },
      { from: "check_scope", to: "approve", kind: "check" },
    ],
  },
  demo,
};
