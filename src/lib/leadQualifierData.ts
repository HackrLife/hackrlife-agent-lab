/**
 * Lead Qualification Agent — data layer
 * ------------------------------------------------------------------
 * Single source of truth for the page. Everything downstream (cards,
 * gallery, markdown export) is driven from here, so adding or editing a
 * source means editing this file only.
 *
 * MODEL (locked v3):
 * - Shared 100-point scoring model across all sources.
 * - Each source carries a SOURCE WEIGHT (the intent baseline of that
 *   action). Final score = base score + source weight, capped 0–100.
 * - Routing actions, the outreach cadence, and the automation path are
 *   UNIQUE per source. The scoring formula, bands, implementation guide,
 *   and deployment checklist are shared.
 */

/* ------------------------------------------------------------------ */
/* Scoring model (shared)                                              */
/* ------------------------------------------------------------------ */

export interface ScoreComponent {
  label: string;
  points: number;
  description: string;
}

export const SCORE_COMPONENTS: ScoreComponent[] = [
  {
    label: "Buying intent",
    points: 25,
    description:
      "Explicit signals the lead wants to purchase soon — language, actions taken, specificity of the request.",
  },
  {
    label: "Fit with offer",
    points: 20,
    description:
      "How closely the lead's needs map to what you actually sell. Misfit leads waste sales cycles.",
  },
  {
    label: "Urgency / timeline",
    points: 20,
    description:
      "Stated or implied timeframe to act. A live deadline outranks a vague 'someday'.",
  },
  {
    label: "Budget or ability to pay",
    points: 15,
    description:
      "Evidence the lead can afford the offer — budget stated, company size, or spend signals.",
  },
  {
    label: "Decision-maker signal",
    points: 10,
    description:
      "Whether the contact can approve a purchase or is a gatekeeper / researcher.",
  },
  {
    label: "Contact quality",
    points: 10,
    description:
      "Completeness and reachability of contact details — valid email, phone, business domain.",
  },
];

export const BASE_POINTS = SCORE_COMPONENTS.reduce((s, c) => s + c.points, 0); // 100

export type BandTone = "emerald" | "sky" | "amber" | "slate";

export interface ScoreBand {
  range: string;
  label: string;
  tone: BandTone;
}

export const SCORE_BANDS: ScoreBand[] = [
  { range: "80–100", label: "Sales-ready", tone: "emerald" },
  { range: "60–79", label: "Strong prospect", tone: "sky" },
  { range: "40–59", label: "Nurture", tone: "amber" },
  { range: "0–39", label: "Low fit", tone: "slate" },
];

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

export type IconKey =
  | "receipt"
  | "headset"
  | "store"
  | "affiliate"
  | "users"
  | "phone"
  | "play"
  | "chat"
  | "social"
  | "form";

export type Channel = "email" | "call" | "sms" | "dm";

export interface CadenceStep {
  day: number;
  channel: Channel;
  /** Short intent shown in the timeline. */
  intent: string;
  /** Full draft copy for the downloadable artifact. */
  copy: string;
}

export interface RoutingRule {
  /** Band range this rule applies to. */
  band: string;
  tone: BandTone;
  action: string;
}

export interface Source {
  slug: string;
  title: string;
  icon: IconKey;
  /** Source weight: intent baseline added to the base score (capped 0–100). */
  weight: number;
  /** One-line routing posture shown on the card. */
  posture: string;
  /** Card description. */
  description: string;
  /** Short cadence descriptor, e.g. "Short · high-touch". */
  cadenceIntensity: string;
  /** Final delivery node label in the automation diagram. */
  deliverLabel: string;
  /** The full agent prompt for this source. */
  prompt: string;
  routing: RoutingRule[];
  cadence: CadenceStep[];
}

function band(tone: BandTone, range: string, action: string): RoutingRule {
  return { band: range, tone, action };
}

export const SOURCES: Source[] = [
  {
    slug: "request-quote",
    title: "Request a Quote",
    icon: "receipt",
    weight: 15,
    posture: "Fast-track to sales",
    description:
      "A pricing request — the strongest buying signal there is.",
    cadenceIntensity: "Short · high-touch",
    deliverLabel: "Enrol in cadence + CRM",
    prompt: `You are a Lead Qualification Agent for quote / pricing requests.

INPUT: A quote-request record with contact details, requested product or service, quantity / scope, desired timeline, and any budget indication.

TASK:
1. Extract scope, quantities, specs, and constraints.
2. Score the lead out of 100 on the standard model. A clear scope + timeline is strong buying intent and urgency.
3. Add the source weight (+15) and cap the final score at 100.
4. Detect price-shoppers vs serious buyers (vague scope, no timeline, free email = caution).
5. Assign a band and recommend: quote now, ask 1–2 qualifying questions, or decline.

OUTPUT (JSON): { "scope_summary": "", "is_serious_buyer": true, "base_score": 0, "final_score": 0, "band": "", "components": { }, "recommended_path": "", "reason": "" }`,
    routing: [
      band("emerald", "80–100", "Call within 1 hour"),
      band("sky", "60–79", "Rep same day"),
      band("amber", "40–59", "Rep + qualify"),
      band("slate", "0–39", "Email quote, then nurture"),
    ],
    cadence: [
      {
        day: 1,
        channel: "email",
        intent: "Quote + next step",
        copy: "Subject: Your quote from [Company]\n\nHi [First name], thanks for requesting a quote on [product/service]. Based on what you shared, here's an outline and pricing: [summary]. The quickest way to finalise is a 15-minute call — does [day/time] work? — [Rep]",
      },
      {
        day: 1,
        channel: "call",
        intent: "Same-day call attempt",
        copy: "Call goal: confirm scope, answer pricing questions, and book a decision call. If no answer, leave a voicemail referencing the emailed quote.",
      },
      {
        day: 2,
        channel: "email",
        intent: "Answer objections, confirm scope",
        copy: "Subject: Anything I can clarify on the quote?\n\nHi [First name], following up on the quote I sent. Happy to adjust scope or walk through the line items. What would make this an easy yes? — [Rep]",
      },
      {
        day: 4,
        channel: "call",
        intent: "Second call + voicemail",
        copy: "Call goal: reach a decision-maker, surface blockers. Voicemail: 'Still holding your pricing — wanted to make sure you have what you need to move forward.'",
      },
      {
        day: 6,
        channel: "email",
        intent: "Break-up: still interested?",
        copy: "Subject: Should I close this out?\n\nHi [First name], I don't want to crowd your inbox. If now isn't the right time, just say the word and I'll check back later. If you're ready, here's the link to proceed: [link]. — [Rep]",
      },
    ],
  },
  {
    slug: "contact-sales",
    title: "Contact Sales",
    icon: "headset",
    weight: 13,
    posture: "Fast-track to sales",
    description: "An explicit hand-raise to talk to a human.",
    cadenceIntensity: "Short · high-touch",
    deliverLabel: "Enrol in cadence + CRM",
    prompt: `You are a Lead Qualification Agent for "Contact Sales" / "Talk to an expert" requests.

INPUT: A sales-contact record with name, work email, company, company size (if provided), use case / message, and any UTM data.

TASK:
1. Confirm this is a genuine sales inquiry (not support or partnership).
2. Score out of 100; weight buying intent and fit heavily — this audience self-selected.
3. Add the source weight (+13) and cap at 100.
4. Estimate a deal tier (SMB / Mid-market / Enterprise) from company signals.
5. Assign a band and recommend rep assignment + SLA.

OUTPUT (JSON): { "is_sales_inquiry": true, "deal_tier": "", "base_score": 0, "final_score": 0, "band": "", "components": { }, "rep_action": "", "sla": "", "reason": "" }`,
    routing: [
      band("emerald", "80–100", "Call within 1 hour"),
      band("sky", "60–79", "Rep same day"),
      band("amber", "40–59", "Rep + qualify"),
      band("slate", "0–39", "Email + booking link, then nurture"),
    ],
    cadence: [
      {
        day: 1,
        channel: "call",
        intent: "First call within the hour",
        copy: "Call goal: respond fast while intent is hot. Confirm the use case, qualify lightly, and book a working session.",
      },
      {
        day: 1,
        channel: "email",
        intent: "Recap + booking link",
        copy: "Subject: Great to connect — next step\n\nHi [First name], thanks for reaching out. Here's a link to grab a time that suits: [link]. In the meantime, here's a quick overview relevant to [use case]. — [Rep]",
      },
      {
        day: 3,
        channel: "call",
        intent: "Second call attempt",
        copy: "Call goal: reach the contact, identify the decision process and timeline.",
      },
      {
        day: 5,
        channel: "email",
        intent: "Value nudge + case study",
        copy: "Subject: How [similar company] solved [problem]\n\nHi [First name], thought this might be useful while you evaluate — a short story from a company like yours. Worth a quick call this week? — [Rep]",
      },
      {
        day: 7,
        channel: "email",
        intent: "Break-up email",
        copy: "Subject: Closing the loop\n\nHi [First name], I'll stop reaching out for now — but if priorities shift, here's my direct line: [contact]. — [Rep]",
      },
    ],
  },
  {
    slug: "event",
    title: "Event Lead",
    icon: "store",
    weight: 12,
    posture: "Route to sales",
    description: "Met and qualified in person at an event or booth.",
    cadenceIntensity: "Warm · context-led",
    deliverLabel: "Enrol in cadence + CRM",
    prompt: `You are a Lead Qualification Agent for event / in-person leads (trade shows, booths, badge scans).

INPUT: A digitised lead record — often sparse — with name, company, role, where/when captured, and rep notes from the interaction.

TASK:
1. Reconstruct intent from rep notes and capture context ("asked for pricing at booth" = high intent).
2. Score out of 100; be conservative where data is missing, reward strong notes and clear roles.
3. Add the source weight (+12) and cap at 100.
4. Assign a band and recommend a same-week follow-up cadence — in-person leads decay fast.

OUTPUT (JSON): { "capture_context": "", "intent_from_notes": "", "base_score": 0, "final_score": 0, "band": "", "components": { }, "follow_up_cadence": "", "reason": "" }`,
    routing: [
      band("emerald", "80–100", "Call within 1 hour"),
      band("sky", "60–79", "Rep same day"),
      band("amber", "40–59", "Route to sales (source lifts it)"),
      band("slate", "0–39", "Personal follow-up email"),
    ],
    cadence: [
      {
        day: 1,
        channel: "email",
        intent: '"Great to meet you at [event]"',
        copy: "Subject: Great meeting you at [event]\n\nHi [First name], really enjoyed our chat at [event] about [topic]. As promised, here's [resource]. Would love to continue the conversation — are you free for a quick call this week? — [Rep]",
      },
      {
        day: 2,
        channel: "call",
        intent: "Call referencing the chat",
        copy: "Call goal: build on the in-person rapport, confirm the need discussed at the event, and book a follow-up.",
      },
      {
        day: 4,
        channel: "email",
        intent: "Send promised resource",
        copy: "Subject: The [resource] I mentioned\n\nHi [First name], here's the [demo/guide/pricing] we talked about at the booth. Let me know what questions come up. — [Rep]",
      },
      {
        day: 7,
        channel: "call",
        intent: "Follow-up call",
        copy: "Call goal: re-engage while the event is still fresh; identify next steps and timeline.",
      },
      {
        day: 10,
        channel: "email",
        intent: "Soft re-engage",
        copy: "Subject: Still thinking about [topic]?\n\nHi [First name], no rush at all — just keeping the door open after [event]. Here's something new that might be relevant: [link]. — [Rep]",
      },
    ],
  },
  {
    slug: "partner-referral",
    title: "Partner / Reseller",
    icon: "affiliate",
    weight: 12,
    posture: "Sales + attribution",
    description: "Driven to you by a channel partner or reseller.",
    cadenceIntensity: "Warm · partner-led",
    deliverLabel: "Deliver + partner attribution",
    prompt: `You are a Lead Qualification Agent for partner / reseller referrals.

INPUT: A referral record with the referred contact's details, the partner's identity, any deal-registration info, and a note explaining the introduction.

TASK:
1. Capture the partner relationship and any deal-reg; treat it as a strong (but not blank-cheque) trust signal.
2. Score out of 100; fit and budget must still be assessed.
3. Add the source weight (+12) and cap at 100.
4. Assign a band and recommend rep action WITH mandatory partner attribution.

OUTPUT (JSON): { "partner": "", "deal_reg": "", "base_score": 0, "final_score": 0, "band": "", "components": { }, "rep_action": "", "attribution_note": "", "reason": "" }`,
    routing: [
      band("emerald", "80–100", "Rep + tag partner"),
      band("sky", "60–79", "Rep + tag partner"),
      band("amber", "40–59", "Rep + notify partner"),
      band("slate", "0–39", "Acknowledge partner, nurture"),
    ],
    cadence: [
      {
        day: 1,
        channel: "email",
        intent: '"[Partner] introduced us"',
        copy: "Subject: Introduced by [Partner]\n\nHi [First name], [Partner] suggested we connect regarding [need]. Given their recommendation, I'd love to find the fastest path to help. Do you have 15 minutes this week? — [Rep]",
      },
      {
        day: 1,
        channel: "call",
        intent: "Intro call + confirm fit",
        copy: "Call goal: validate the fit [Partner] flagged, confirm scope, and set expectations on next steps.",
      },
      {
        day: 3,
        channel: "email",
        intent: "Tailored proposal path",
        copy: "Subject: A path tailored to your setup\n\nHi [First name], based on what [Partner] shared and our chat, here's how we'd approach [need]: [outline]. — [Rep]",
      },
      {
        day: 5,
        channel: "call",
        intent: "Progress call",
        copy: "Call goal: move the deal forward, identify any approvals needed.",
      },
      {
        day: 8,
        channel: "email",
        intent: "Loop partner in on status",
        copy: "Subject: Quick status update\n\nHi [First name], checking in on next steps. (Keeping [Partner] in the loop as agreed.) Anything I can unblock? — [Rep]",
      },
    ],
  },
  {
    slug: "human-referral",
    title: "Human Referral",
    icon: "users",
    weight: 10,
    posture: "Sales + credit referrer",
    description: "Introduced by a customer, friend, or colleague.",
    cadenceIntensity: "Warm · personal",
    deliverLabel: "Deliver + credit referrer",
    prompt: `You are a Lead Qualification Agent for human referrals (introduced by a customer, friend, or colleague).

INPUT: A referral record with the referred contact's details, the referrer's identity, and any note explaining the introduction.

TASK:
1. Capture the referrer relationship; weight it as a trust signal, not a free pass — the referred person may not yet know they're being referred.
2. Score out of 100; fit and budget still need assessing.
3. Add the source weight (+10) and cap at 100.
4. Assign a band and recommend a personalised, referrer-aware outreach. Always credit the referrer.

OUTPUT (JSON): { "referrer": "", "referrer_strength": "weak|moderate|strong", "base_score": 0, "final_score": 0, "band": "", "components": { }, "recommended_outreach": "", "reason": "" }`,
    routing: [
      band("emerald", "80–100", "Rep + thank referrer"),
      band("sky", "60–79", "Rep + thank referrer"),
      band("amber", "40–59", "Personal outreach, credit referrer"),
      band("slate", "0–39", "Warm nurture, credit referrer"),
    ],
    cadence: [
      {
        day: 1,
        channel: "email",
        intent: '"[Name] suggested I reach out"',
        copy: "Subject: [Name] suggested we connect\n\nHi [First name], [Name] mentioned you might be looking into [need] and thought we'd be worth a conversation. No pressure at all — happy to share what we've done for others in a similar spot. Open to a quick chat? — [Rep]",
      },
      {
        day: 2,
        channel: "call",
        intent: "Friendly intro call",
        copy: "Call goal: keep it warm and low-pressure; understand the need [Name] flagged and whether there's a fit.",
      },
      {
        day: 4,
        channel: "email",
        intent: "Personalised value note",
        copy: "Subject: Thought this might help\n\nHi [First name], based on what [Name] shared, here's something relevant: [resource]. Let me know if it's useful. — [Rep]",
      },
      {
        day: 7,
        channel: "email",
        intent: "Gentle check-in",
        copy: "Subject: Checking in\n\nHi [First name], just following up — is [need] still on your radar? Happy to help whenever the timing's right. — [Rep]",
      },
      {
        day: 11,
        channel: "email",
        intent: "Last soft touch",
        copy: "Subject: Keeping the door open\n\nHi [First name], I'll leave it here for now, but feel free to reach out anytime. (And thanks again to [Name] for the intro.) — [Rep]",
      },
    ],
  },
  {
    slug: "phone-missed",
    title: "Phone Call (missed)",
    icon: "phone",
    weight: 8,
    posture: "Call back same day",
    description: "Tried to reach a human and didn't get through.",
    cadenceIntensity: "Urgent · call-first",
    deliverLabel: "Enrol in cadence + CRM",
    prompt: `You are a Lead Qualification Agent for missed inbound phone calls.

INPUT: A call record with caller number, time, duration (if any), voicemail transcript (if left), and any matched CRM contact.

TASK:
1. Treat a missed inbound call as real intent that is decaying fast.
2. Score out of 100 using any available signals (voicemail content, matched company, time of day).
3. Add the source weight (+8) and cap at 100.
4. Assign a band and recommend an urgent, call-first follow-up.

OUTPUT (JSON): { "voicemail_summary": "", "matched_contact": "", "base_score": 0, "final_score": 0, "band": "", "components": { }, "callback_priority": "", "reason": "" }`,
    routing: [
      band("emerald", "80–100", "Call back within 1 hour"),
      band("sky", "60–79", "Call back same day"),
      band("amber", "40–59", "Call back + voicemail + email"),
      band("slate", "0–39", "Email, then nurture"),
    ],
    cadence: [
      {
        day: 1,
        channel: "call",
        intent: "Call back within the hour",
        copy: "Call goal: return the missed call fast. 'Hi, returning your call — how can I help?' If no answer, leave a warm voicemail and send the day-1 email.",
      },
      {
        day: 1,
        channel: "email",
        intent: '"Sorry we missed you" + booking link',
        copy: "Subject: Sorry we missed your call\n\nHi there, we saw you called and weren't able to connect. The easiest way to reach me is here: [phone] or grab a time directly: [link]. — [Rep]",
      },
      {
        day: 1,
        channel: "sms",
        intent: "Text: best time to call?",
        copy: "Hi, this is [Rep] at [Company] — sorry we missed your call. What's a good time to reach you today?",
      },
      {
        day: 3,
        channel: "call",
        intent: "Second call attempt",
        copy: "Call goal: try a different time of day; leave a final voicemail if no answer.",
      },
      {
        day: 5,
        channel: "email",
        intent: "Final follow-up",
        copy: "Subject: Still happy to help\n\nHi there, following up one last time after your call. If it's easier, just reply here and I'll sort it out. — [Rep]",
      },
    ],
  },
  {
    slug: "watch-demo",
    title: "Watch Demo",
    icon: "play",
    weight: 4,
    posture: "Alert + light nurture",
    description: "Actively evaluating, but passively — no message.",
    cadenceIntensity: "Medium · value-led",
    deliverLabel: "Enrol in cadence + CRM",
    prompt: `You are a Lead Qualification Agent for "watch demo" / video-engagement leads.

INPUT: A behavioural record — email (if captured), demo/video watched, watch depth (% completed), recency, and return visits.

TASK:
1. Infer intent from behaviour rather than a written request: watch depth and recency are the primary signals.
2. Score out of 100; a near-complete, recent watch is a stronger intent signal than a brief view.
3. Add the source weight (+4) and cap at 100.
4. Assign a band and recommend a value-led nurture with a light sales alert on strong engagement.

OUTPUT (JSON): { "watch_depth": "", "recency": "", "base_score": 0, "final_score": 0, "band": "", "components": { }, "recommended_path": "", "reason": "" }`,
    routing: [
      band("emerald", "80–100", "Sales alert + call"),
      band("sky", "60–79", "Sales alert + sequence"),
      band("amber", "40–59", "Light nurture + watch signals"),
      band("slate", "0–39", "Standard nurture"),
    ],
    cadence: [
      {
        day: 1,
        channel: "email",
        intent: '"Saw you watched the demo"',
        copy: "Subject: Questions after the demo?\n\nHi [First name], noticed you checked out our demo of [product]. What stood out? Happy to answer anything or show the parts most relevant to [use case]. — [Rep]",
      },
      {
        day: 3,
        channel: "email",
        intent: "Relevant use-case / case study",
        copy: "Subject: How teams like yours use [product]\n\nHi [First name], here's a short example of [outcome] that the demo touched on. Worth a closer look? — [Rep]",
      },
      {
        day: 6,
        channel: "call",
        intent: "Light call attempt",
        copy: "Call goal: low-pressure check-in for engaged viewers; offer a tailored walkthrough.",
      },
      {
        day: 10,
        channel: "email",
        intent: "Offer a live walkthrough",
        copy: "Subject: Want a live walkthrough?\n\nHi [First name], the recorded demo only covers so much — happy to do a 20-min live session focused on your goals. Here's my calendar: [link]. — [Rep]",
      },
      {
        day: 15,
        channel: "email",
        intent: "Re-engage with new angle",
        copy: "Subject: One more idea for [goal]\n\nHi [First name], a different angle that might be useful: [insight]. If it resonates, I'm one reply away. — [Rep]",
      },
    ],
  },
  {
    slug: "live-chat",
    title: "Live Chat",
    icon: "chat",
    weight: 0,
    posture: "Qualify, then route",
    description: "Mixed intent — depends entirely on what was asked.",
    cadenceIntensity: "Medium · qualify-first",
    deliverLabel: "Enrol in cadence + CRM",
    prompt: `You are a Lead Qualification Agent for live-chat and chatbot transcripts.

INPUT: A full chat transcript plus any captured visitor metadata (page, email if provided, returning-visitor flag).

TASK:
1. Summarise the conversation and extract the visitor's core need.
2. Score out of 100; infer buying intent from the questions asked (pricing, demo, comparison = high).
3. Add the source weight (0 — neutral baseline) and cap at 100.
4. Detect support-only chats and route them away from sales.
5. Assign a band and recommend the next touch.

OUTPUT (JSON): { "conversation_summary": "", "is_sales_relevant": true, "base_score": 0, "final_score": 0, "band": "", "components": { }, "next_touch": "", "reason": "" }`,
    routing: [
      band("emerald", "80–100", "Rep same day"),
      band("sky", "60–79", "Qualify, then rep"),
      band("amber", "40–59", "Nurture + capture email"),
      band("slate", "0–39", "Send resource, no rep"),
    ],
    cadence: [
      {
        day: 1,
        channel: "email",
        intent: "Recap of chat + answer",
        copy: "Subject: Following up on your chat\n\nHi [First name], thanks for chatting with us about [topic]. Here's the answer to your question, plus a next step if you'd like to go further: [link]. — [Rep]",
      },
      {
        day: 2,
        channel: "email",
        intent: "Helpful resource",
        copy: "Subject: This might help with [topic]\n\nHi [First name], thought this would be useful based on what you asked in chat: [resource]. — [Rep]",
      },
      {
        day: 5,
        channel: "call",
        intent: "Call if engaged",
        copy: "Call goal: only for visitors who showed buying signals in chat; confirm the need and qualify.",
      },
      {
        day: 9,
        channel: "email",
        intent: "Check if still relevant",
        copy: "Subject: Still looking into [topic]?\n\nHi [First name], checking whether this is still on your radar. Happy to help either way. — [Rep]",
      },
      {
        day: 14,
        channel: "email",
        intent: "Nurture handoff",
        copy: "Subject: Useful reads for [topic]\n\nHi [First name], I'll add you to our occasional tips on [topic] — unsubscribe anytime. Reach out whenever you're ready. — [Rep]",
      },
    ],
  },
  {
    slug: "social-dm",
    title: "Social Media DM",
    icon: "social",
    weight: -5,
    posture: "Qualify hard first",
    description: "Noisy channel, often low or unclear intent.",
    cadenceIntensity: "Light · low-pressure",
    deliverLabel: "Enrol in cadence + CRM",
    prompt: `You are a Lead Qualification Agent for inbound social media DMs and comment threads.

INPUT: A DM/thread record with platform, handle, message text, follower count (if available), and profile bio.

TASK:
1. Classify the message (genuine inquiry, collaboration pitch, spam, support, fan/no-intent).
2. Score out of 100; casual tone is normal here — weight the substance of the ask, not formality.
3. Add the source weight (−5 — noisy baseline) and cap at 0–100.
4. Use profile signals (bio, company, followers) to inform fit and decision-maker scoring.
5. Assign a band and recommend a reply approach (move to email, send link, qualify further, ignore).

OUTPUT (JSON): { "platform": "", "message_class": "", "base_score": 0, "final_score": 0, "band": "", "components": { }, "reply_approach": "", "reason": "" }`,
    routing: [
      band("emerald", "80–100", "Move to email, then rep"),
      band("sky", "60–79", "Qualify further"),
      band("amber", "40–59", "Light nurture"),
      band("slate", "0–39", "Ignore / no rep time"),
    ],
    cadence: [
      {
        day: 1,
        channel: "dm",
        intent: "Reply + move to email",
        copy: "DM: Thanks for reaching out! Happy to help with [topic]. Mind sharing your email so I can send the details properly?",
      },
      {
        day: 2,
        channel: "email",
        intent: "If email captured: intro",
        copy: "Subject: Following up from [platform]\n\nHi [First name], great to connect on [platform]. Here's the info you asked about: [link]. Let me know if you'd like to go deeper. — [Rep]",
      },
      {
        day: 6,
        channel: "email",
        intent: "Soft value content",
        copy: "Subject: Thought you'd find this useful\n\nHi [First name], a quick resource on [topic] that tends to help. No pressure — just sharing. — [Rep]",
      },
      {
        day: 12,
        channel: "email",
        intent: "Light check-in",
        copy: "Subject: Still curious about [topic]?\n\nHi [First name], checking in — happy to answer anything whenever it's useful. — [Rep]",
      },
      {
        day: 20,
        channel: "email",
        intent: "Nurture sequence entry",
        copy: "Subject: Occasional tips on [topic]\n\nHi [First name], I'll add you to our low-volume tips list — opt out anytime. — [Rep]",
      },
    ],
  },
  {
    slug: "website-form",
    title: "Website Contact Form",
    icon: "form",
    weight: -8,
    posture: "Nurture unless strong",
    description: "Generic 'contact us' — intent unknown until read.",
    cadenceIntensity: "Long · mostly automated",
    deliverLabel: "Enrol in cadence + CRM",
    prompt: `You are a Lead Qualification Agent for generic website contact-form submissions.

INPUT: A contact-form record with name, email, company (optional), message, and captured metadata (page URL, UTM source, timestamp).

TASK:
1. Read the message and infer the true objective (sales, support, partnership, job-seeker, spam).
2. Score out of 100; when a signal is absent, score it low rather than guessing.
3. Add the source weight (−8 — generic baseline) and cap at 0–100.
4. Assign a band and recommend the next action with a one-line reason.

OUTPUT (JSON): { "intent": "", "base_score": 0, "final_score": 0, "band": "", "components": { }, "next_action": "", "reason": "" }`,
    routing: [
      band("emerald", "80–100", "Route to sales same day"),
      band("sky", "60–79", "Light nurture + sales alert"),
      band("amber", "40–59", "Standard nurture"),
      band("slate", "0–39", "Auto-archive"),
    ],
    cadence: [
      {
        day: 1,
        channel: "email",
        intent: "Auto-acknowledge + clarify need",
        copy: "Subject: Thanks for getting in touch\n\nHi [First name], thanks for reaching out to [Company]. So we can point you to the right place — what are you hoping to achieve with [topic]? Just reply here. — [Team]",
      },
      {
        day: 3,
        channel: "email",
        intent: "Educational content",
        copy: "Subject: A useful starting point\n\nHi [First name], while you consider your options, here's a primer on [topic] that most people find helpful. — [Team]",
      },
      {
        day: 7,
        channel: "email",
        intent: "Case study + soft CTA",
        copy: "Subject: How [customer] approached this\n\nHi [First name], a short story on [outcome] in case it's relevant. If you'd like to talk specifics, here's a link: [link]. — [Team]",
      },
      {
        day: 14,
        channel: "email",
        intent: "Human break-in if engaged",
        copy: "Subject: Want me to take a look?\n\nHi [First name], if [topic] is still on your mind, I'm happy to review your situation personally. Reply and I'll take it from there. — [Rep]",
      },
      {
        day: 21,
        channel: "email",
        intent: "Re-engagement / archive",
        copy: "Subject: Last note for now\n\nHi [First name], I'll pause here so I'm not cluttering your inbox. Whenever the timing's right, just reply. — [Team]",
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Shared gallery content (lightly templated by source)               */
/* ------------------------------------------------------------------ */

export interface WorkflowStep {
  title: string;
  /** Visual lane for colouring. */
  lane: "ingest" | "weight" | "agent" | "human" | "deliver";
}

export function buildWorkflow(source: Source): WorkflowStep[] {
  return [
    { title: "Capture", lane: "ingest" },
    { title: "Enrich", lane: "ingest" },
    {
      title: `Apply source weight (${source.weight > 0 ? "+" : ""}${source.weight})`,
      lane: "weight",
    },
    { title: "Score", lane: "agent" },
    { title: "Branch by band", lane: "agent" },
    { title: "Human review", lane: "human" },
    { title: source.deliverLabel, lane: "deliver" },
  ];
}

export interface GuidePart {
  n: number;
  title: string;
  bullets: string[];
}

export function buildGuide(source: Source): GuidePart[] {
  const s = source.title;
  return [
    {
      n: 1,
      title: "The Problem",
      bullets: [
        `${s} leads arrive faster than the team can triage them.`,
        "High-fit buyers wait while low-intent noise gets attention.",
        "No consistent definition of what 'qualified' means.",
      ],
    },
    {
      n: 2,
      title: "The Cost",
      bullets: [
        "Slow first-response loses winnable deals.",
        "Rep hours burned on leads that will never buy.",
        "Forecasting built on gut feel, not a score.",
      ],
    },
    {
      n: 3,
      title: "The Solution",
      bullets: [
        "An agent scores every lead on a 100-point model in seconds.",
        `The ${s} source weight nudges routing toward the right action.`,
        "A human approves the high-value calls — judgement stays in the loop.",
      ],
    },
    {
      n: 4,
      title: "How It Works",
      bullets: [
        "Capture → enrich → weight → score → branch → review → deliver.",
        "Each band maps to a defined action and an outreach cadence.",
        "Plugs into your existing CRM and outreach tools.",
      ],
    },
    {
      n: 5,
      title: "The Outcome",
      bullets: [
        "Faster response on the leads that matter.",
        "Reps focused only on sales-ready and strong prospects.",
        "A measurable, repeatable definition of pipeline quality.",
      ],
    },
  ];
}

export interface ChecklistDay {
  day: number;
  title: string;
  task: string;
}

export function buildChecklist(source: Source): ChecklistDay[] {
  const s = source.title;
  return [
    {
      day: 1,
      title: "Define qualified for this source",
      task: `Agree what a great ${s} lead looks like and confirm the six scoring components fit your offer.`,
    },
    {
      day: 2,
      title: "Connect the source feed",
      task: `Wire up the ${s} feed so new leads land in one place automatically.`,
    },
    {
      day: 3,
      title: "Calibrate score + source weight",
      task: `Run historical leads through the model and confirm the ${s} weight (${source.weight > 0 ? "+" : ""}${source.weight}) lands the bands correctly.`,
    },
    {
      day: 4,
      title: "Set routing & action rules",
      task: "Map each band to an owner, an SLA, and a destination.",
    },
    {
      day: 5,
      title: "Load the outreach cadence",
      task: `Import the ${source.cadence.length}-step ${s} cadence into your outreach tool and personalise the merge fields.`,
    },
    {
      day: 6,
      title: "Add the human review step",
      task: "Configure the approval point so a person reviews high-value recommendations before they fire.",
    },
    {
      day: 7,
      title: "Pilot, then go live & measure",
      task: "Run live in shadow mode for a day, compare to rep judgement, then switch on routing and track response time.",
    },
  ];
}

export const channelLabel: Record<Channel, string> = {
  email: "Email",
  call: "Call",
  sms: "SMS",
  dm: "DM",
};
