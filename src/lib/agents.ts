/**
 * src/lib/agents.ts
 * ------------------------------------------------------------------
 * Central metadata for every agent in the HackrLife Agent Lab.
 *
 * This is the single source of truth. Pages, the gallery, filters,
 * search, and individual demo pages all read from here.
 *
 * To add a new agent: append an object to the `agents` array below.
 * To turn a Preview agent Live: set `status: "live"` and add a
 * matching `form` definition (and create the matching n8n webhook).
 *
 * WEBHOOK CONVENTION (see also src/lib/webhook.ts):
 *   Live agents POST JSON to:
 *     https://n8n.hackrlife.com/webhook/{slug}
 *   The {slug} is the agent's `slug` field below.
 * ------------------------------------------------------------------
 */

export type Category =
  | "Marketing"
  | "Content"
  | "Research"
  | "Operations"
  | "Creator"
  | "Freelancer"
  | "Small Business";

export type DemoStatus = "live" | "preview";

/** A single field in a Live agent's demo form. */
export type FormField =
  | {
      kind: "input";
      name: string;
      label: string;
      placeholder?: string;
      required?: boolean;
      maxLength?: number;
      helper?: string;
    }
  | {
      kind: "textarea";
      name: string;
      label: string;
      placeholder?: string;
      required?: boolean;
      maxLength?: number;
      rows?: number;
      helper?: string;
    }
  | {
      kind: "select";
      name: string;
      label: string;
      options: string[];
      required?: boolean;
      helper?: string;
    };

export interface AgentForm {
  /** Fields rendered in order. */
  fields: FormField[];
  /** Label for the submit button. */
  submitLabel: string;
}

export interface WorkflowStep {
  title: string;
  detail: string;
}

export interface Agent {
  slug: string;
  name: string;
  category: Category;
  status: DemoStatus;
  /** One-line description used on cards. */
  short: string;
  /** Estimated value / time saved, shown on cards. */
  valueEstimate: string;
  /** Longer copy for the agent page hero. */
  tagline: string;
  /** "What this agent helps with" — bullet list. */
  helpsWith: string[];
  /** "Who it is for" — bullet list. */
  whoFor: string[];
  /** Demo limitations — bullet list. */
  limitations: string[];
  /** What a full deployment would include — bullet list. */
  fullDeployment: string[];
  /** Workflow diagram steps (left-to-right). */
  workflow: WorkflowStep[];
  /** Present only for Live agents. */
  form?: AgentForm;
}

/* ------------------------------------------------------------------ */
/* Shared workflow templates (kept DRY, customised per agent below).  */
/* ------------------------------------------------------------------ */

const previewWorkflow = (input: string, work: string, output: string): WorkflowStep[] => [
  { title: "Your input", detail: input },
  { title: "n8n orchestration", detail: "Routing, prompt assembly, and guardrails run privately inside n8n." },
  { title: "Agent reasoning", detail: work },
  { title: "Structured output", detail: output },
  { title: "Human review", detail: "Nothing is published or scheduled. You review and decide." },
];

/* ------------------------------------------------------------------ */
/* The 30 agents.                                                     */
/* ------------------------------------------------------------------ */

export const agents: Agent[] = [
  /* ============================== MARKETING ============================== */
  {
    slug: "landing-page-critic",
    name: "Landing Page Critic",
    category: "Marketing",
    status: "live",
    short: "Paste landing page copy and get a structured critique against a stated goal.",
    valueEstimate: "Saves ~1–2 hrs of review",
    tagline: "A second pair of eyes on your landing page — structured, specific, and tied to your actual goal.",
    helpsWith: [
      "Spotting weak or vague value propositions",
      "Checking message-to-audience fit",
      "Finding friction in the path to your stated goal",
      "Prioritising the few changes that matter most",
    ],
    whoFor: ["Marketers", "Founders shipping a new page", "Freelancers reviewing client copy"],
    limitations: [
      "Reviews copy you paste in — it does not crawl your live URL.",
      "Returns a critique, not a redesign or new copy by default.",
      "Input is capped so the demo stays fast and focused.",
    ],
    fullDeployment: [
      "Pulls the live page directly and re-checks after every edit",
      "Scores against your brand voice and conversion benchmarks",
      "Generates rewritten sections, not just feedback",
      "Runs inside your own stack (Notion, Slack, or your CMS)",
    ],
    workflow: [
      { title: "Paste copy + goal", detail: "You provide product, audience, the copy, and what the page should achieve." },
      { title: "n8n orchestration", detail: "Routing and guardrails run privately inside n8n." },
      { title: "Structured critique", detail: "The agent evaluates clarity, fit, friction, and proof." },
      { title: "Prioritised fixes", detail: "Returns ranked, specific recommendations." },
      { title: "Human review", detail: "You decide what to change. Nothing is published." },
    ],
    form: {
      submitLabel: "Run the critique",
      fields: [
        { kind: "input", name: "product_name", label: "Product name", placeholder: "e.g. Agent Lab", required: true, maxLength: 120 },
        { kind: "input", name: "audience", label: "Audience", placeholder: "Who is this page for?", required: true, maxLength: 160 },
        {
          kind: "textarea",
          name: "landing_page_copy",
          label: "Landing page copy",
          placeholder: "Paste the headline, subhead, and key sections…",
          required: true,
          maxLength: 1500,
          rows: 8,
          helper: "Max 1500 characters.",
        },
        { kind: "input", name: "goal", label: "Primary goal", placeholder: "e.g. Get visitors to book a consult", required: true, maxLength: 160 },
        { kind: "input", name: "email", label: "Email (optional)", placeholder: "Get a copy of the critique", required: false, maxLength: 160 },
      ],
    },
  },
  {
    slug: "campaign-angle-generator",
    name: "Campaign Angle Generator",
    category: "Marketing",
    status: "live",
    short: "Turn an offer and a pain point into distinct campaign angles for a chosen channel.",
    valueEstimate: "Saves ~2 hrs of ideation",
    tagline: "Stop staring at a blank doc. Get a set of distinct, channel-aware angles to test.",
    helpsWith: [
      "Breaking past the one obvious angle",
      "Tailoring messaging to a specific channel",
      "Framing around a real customer pain point",
      "Producing variants worth A/B testing",
    ],
    whoFor: ["Marketers", "Founders running their own campaigns", "Freelance strategists"],
    limitations: [
      "Generates angles and hooks, not finished creative assets.",
      "Does not run or schedule any campaign.",
      "Quality depends on how specific your pain point is.",
    ],
    fullDeployment: [
      "Pulls past campaign performance to weight angles",
      "Generates full creative per angle (copy + brief)",
      "Feeds approved angles into your ad or email tool — on your command",
      "Tracks which angles win and learns over time",
    ],
    workflow: [
      { title: "Offer + pain + channel", detail: "You describe the offer, audience, pain point, and channel." },
      { title: "n8n orchestration", detail: "Routing and guardrails run privately inside n8n." },
      { title: "Angle generation", detail: "The agent drafts distinct angles tuned to your channel." },
      { title: "Hooks + rationale", detail: "Each angle comes with a hook and why it might land." },
      { title: "Human review", detail: "You pick what to test. Nothing is launched." },
    ],
    form: {
      submitLabel: "Generate angles",
      fields: [
        { kind: "input", name: "product_or_offer", label: "Product or offer", placeholder: "What are you promoting?", required: true, maxLength: 160 },
        { kind: "input", name: "target_audience", label: "Target audience", placeholder: "Who should this reach?", required: true, maxLength: 160 },
        { kind: "input", name: "pain_point", label: "Core pain point", placeholder: "What problem does it solve?", required: true, maxLength: 200 },
        { kind: "select", name: "channel", label: "Channel", options: ["X", "LinkedIn", "Email", "Newsletter", "Landing Page"], required: true },
        { kind: "input", name: "email", label: "Email (optional)", placeholder: "Get a copy of the angles", required: false, maxLength: 160 },
      ],
    },
  },
  {
    slug: "cold-email-pack-agent",
    name: "Cold Email Pack Agent",
    category: "Marketing",
    status: "preview",
    short: "Generate a small pack of cold email variants tuned to a niche and offer.",
    valueEstimate: "Saves ~2–3 hrs of drafting",
    tagline: "A starting pack of cold email variants you can adapt — not a spray-and-pray machine.",
    helpsWith: ["Drafting first-touch and follow-up variants", "Tailoring tone per niche", "Avoiding generic templates", "Building a testable email sequence"],
    whoFor: ["Freelancers doing outreach", "Marketers", "Founders selling early"],
    limitations: ["Drafts copy only — does not send anything.", "No list management or deliverability tooling.", "You own compliance and consent."],
    fullDeployment: ["Personalises per-prospect from your CRM", "Manages sequences and follow-ups on your command", "Respects your sending rules and consent model", "Reports replies back into your workflow"],
    workflow: previewWorkflow(
      "You describe the niche, offer, and tone.",
      "The agent drafts a small pack of variants with follow-ups.",
      "Returns editable email drafts ready for your review.",
    ),
  },
  {
    slug: "competitor-positioning-agent",
    name: "Competitor Positioning Agent",
    category: "Marketing",
    status: "preview",
    short: "Map how you differ from a competitor and surface sharper positioning angles.",
    valueEstimate: "Saves ~2 hrs of analysis",
    tagline: "Understand where you actually differ — and how to say it clearly.",
    helpsWith: ["Clarifying real differentiation", "Spotting overused category claims", "Finding underused positioning space", "Sharpening your one-liner"],
    whoFor: ["Founders", "Marketers", "Consultants positioning a service"],
    limitations: ["Works from what you provide, not live competitor scraping.", "Returns positioning angles, not a full brand strategy.", "Human judgment required on claims."],
    fullDeployment: ["Monitors competitor messaging over time", "Flags positioning drift", "Feeds angles into your content pipeline", "Runs inside your own tools"],
    workflow: previewWorkflow(
      "You describe your offer and a competitor.",
      "The agent contrasts positioning and finds open space.",
      "Returns differentiation angles and a sharper one-liner.",
    ),
  },
  {
    slug: "ad-copy-generator",
    name: "Ad Copy Generator",
    category: "Marketing",
    status: "preview",
    short: "Produce ad copy variants for a platform, audience, and angle.",
    valueEstimate: "Saves ~1–2 hrs per set",
    tagline: "Platform-aware ad variants you can take into testing.",
    helpsWith: ["Generating headline + body variants", "Matching platform constraints", "Keeping a consistent angle", "Producing testable options"],
    whoFor: ["Marketers", "Small business owners running ads", "Freelancers"],
    limitations: ["Writes copy only — never places or runs ads.", "No budget or bidding logic.", "You review for claims and compliance."],
    fullDeployment: ["Generates copy mapped to your ad account structure", "Pairs copy with creative briefs", "Pushes drafts to your ad tool on your command", "Learns from performance"],
    workflow: previewWorkflow(
      "You give platform, audience, and angle.",
      "The agent drafts compliant, on-angle variants.",
      "Returns headline and body options for review.",
    ),
  },
  {
    slug: "launch-plan-agent",
    name: "Launch Plan Agent",
    category: "Marketing",
    status: "preview",
    short: "Turn a launch goal into a phased, channel-by-channel plan outline.",
    valueEstimate: "Saves ~3 hrs of planning",
    tagline: "A structured launch outline so nothing important slips.",
    helpsWith: ["Sequencing pre-launch to post-launch", "Mapping channels to phases", "Listing assets to prepare", "Building a checklist you can edit"],
    whoFor: ["Founders", "Marketers", "Creators launching a product"],
    limitations: ["Produces a plan outline, not finished assets.", "Does not schedule or publish anything.", "You adapt dates and owners."],
    fullDeployment: ["Generates the assets each phase needs", "Syncs the plan into your project tool", "Tracks readiness across the team", "Runs inside your own stack"],
    workflow: previewWorkflow(
      "You describe the launch and its goal.",
      "The agent sequences phases and maps channels.",
      "Returns an editable, phased launch outline.",
    ),
  },

  /* =============================== CONTENT =============================== */
  {
    slug: "daily-x-content-agent",
    name: "Daily X Content Agent",
    category: "Content",
    status: "preview",
    short: "Generate a day's worth of post ideas around a theme and audience.",
    valueEstimate: "Saves ~45 min/day",
    tagline: "A daily idea bench so you are never posting from a blank page.",
    helpsWith: ["Generating themed post ideas", "Mixing formats and hooks", "Keeping a consistent point of view", "Beating the blank-page problem"],
    whoFor: ["Creators", "Founders building in public", "Marketers"],
    limitations: ["Drafts ideas only — never posts or schedules.", "No analytics in the demo.", "You curate and edit before posting."],
    fullDeployment: ["Adapts to your real engagement patterns", "Drafts in your voice from past posts", "Queues drafts for your approval", "Nothing posts without you"],
    workflow: previewWorkflow(
      "You give a theme and audience.",
      "The agent drafts a varied set of post ideas.",
      "Returns ideas with hooks for you to curate.",
    ),
  },
  {
    slug: "voice-match-tweet-agent",
    name: "Voice-Match Tweet Agent",
    category: "Content",
    status: "live",
    short: "Paste past tweets and get new ones written in your own voice on a new topic.",
    valueEstimate: "Saves ~30–45 min/day",
    tagline: "Tweets that sound like you — because they learn from your own past posts.",
    helpsWith: [
      "Writing on a new topic in your established voice",
      "Keeping tone consistent across posts",
      "Beating the blank-page problem fast",
      "Producing a few strong options to choose from",
    ],
    whoFor: ["Creators", "Founders building in public", "Marketers managing a personal brand"],
    limitations: [
      "Learns voice from the tweets you paste (up to 10) — not your full history.",
      "Drafts only — it never posts or schedules anything.",
      "You choose what, if anything, to publish.",
    ],
    fullDeployment: [
      "Learns from your full posting history, continuously",
      "Drafts daily and queues for your one-tap approval",
      "Adapts to what actually performs for you",
      "Runs inside your own tools — nothing posts without you",
    ],
    workflow: [
      { title: "Paste past tweets", detail: "You provide up to 10 tweets plus the new topic and tone." },
      { title: "n8n orchestration", detail: "Voice analysis and guardrails run privately inside n8n." },
      { title: "Voice modelling", detail: "The agent extracts your patterns, then writes on the new topic." },
      { title: "Draft tweets", detail: "Returns 3 or 5 options in your voice." },
      { title: "Human review", detail: "You pick and post yourself. Nothing is published automatically." },
    ],
    form: {
      submitLabel: "Write tweets in my voice",
      fields: [
        {
          kind: "textarea",
          name: "past_tweets",
          label: "Past tweets",
          placeholder: "Paste up to 10 of your tweets, one per line…",
          required: true,
          rows: 8,
          maxLength: 4000,
          helper: "Up to 10 tweets, one per line. More variety = better voice match.",
        },
        { kind: "input", name: "new_topic", label: "New topic", placeholder: "What should the new tweets be about?", required: true, maxLength: 200 },
        { kind: "select", name: "number_of_tweets", label: "Number of tweets", options: ["3", "5"], required: true },
        { kind: "input", name: "tone_preference", label: "Tone preference", placeholder: "e.g. punchy, dry, encouraging", required: true, maxLength: 120 },
        { kind: "input", name: "email", label: "Email (optional)", placeholder: "Get a copy of the drafts", required: false, maxLength: 160 },
      ],
    },
  },
  {
    slug: "newsletter-draft-agent",
    name: "Newsletter Draft Agent",
    category: "Content",
    status: "live",
    short: "Turn a topic and rough notes into a structured newsletter draft.",
    valueEstimate: "Saves ~1–2 hrs per issue",
    tagline: "From scattered notes to a structured first draft you can actually edit.",
    helpsWith: [
      "Shaping rough notes into a coherent issue",
      "Holding a chosen tone end to end",
      "Producing a usable structure, not a blank page",
      "Getting to a good draft faster",
    ],
    whoFor: ["Creators with a newsletter", "Founders writing to their list", "Marketers"],
    limitations: [
      "Source notes are capped at 1000 characters for the demo.",
      "Produces a draft — it does not send to any list.",
      "You edit, fact-check, and decide what ships.",
    ],
    fullDeployment: [
      "Pulls source material from your own docs and links",
      "Matches your established newsletter voice",
      "Drops the draft into your sending tool for review",
      "Nothing is sent without your approval",
    ],
    workflow: [
      { title: "Topic + notes", detail: "You give the topic, audience, notes, and tone." },
      { title: "n8n orchestration", detail: "Routing and guardrails run privately inside n8n." },
      { title: "Drafting", detail: "The agent structures an intro, body, and close in your tone." },
      { title: "Editable draft", detail: "Returns a full draft you can revise." },
      { title: "Human review", detail: "You edit and send yourself. Nothing is sent automatically." },
    ],
    form: {
      submitLabel: "Draft my newsletter",
      fields: [
        { kind: "input", name: "topic", label: "Topic", placeholder: "What is this issue about?", required: true, maxLength: 160 },
        { kind: "input", name: "audience", label: "Audience", placeholder: "Who reads your newsletter?", required: true, maxLength: 160 },
        {
          kind: "textarea",
          name: "source_notes",
          label: "Source notes",
          placeholder: "Drop your rough notes, bullet points, or links…",
          required: true,
          rows: 7,
          maxLength: 1000,
          helper: "Max 1000 characters.",
        },
        { kind: "select", name: "tone", label: "Tone", options: ["Practical", "Contrarian", "Educational", "Founder-led"], required: true },
        { kind: "input", name: "email", label: "Email (optional)", placeholder: "Get a copy of the draft", required: false, maxLength: 160 },
      ],
    },
  },
  {
    slug: "linkedin-post-agent",
    name: "LinkedIn Post Agent",
    category: "Content",
    status: "preview",
    short: "Turn an idea into a structured LinkedIn post with a strong opening line.",
    valueEstimate: "Saves ~30 min/post",
    tagline: "Professional-tone posts that open strong and stay readable.",
    helpsWith: ["Crafting a scroll-stopping first line", "Structuring for readability", "Keeping a credible, non-hype tone", "Producing options to choose from"],
    whoFor: ["Founders", "Consultants", "Marketers", "Freelancers"],
    limitations: ["Drafts only — never posts or schedules.", "No analytics in the demo.", "You edit before posting."],
    fullDeployment: ["Writes in your voice from past posts", "Queues drafts for approval", "Learns from your engagement", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You give an idea and audience.",
      "The agent structures a post with a strong hook.",
      "Returns editable post options.",
    ),
  },
  {
    slug: "blog-repurposer-agent",
    name: "Blog Repurposer Agent",
    category: "Content",
    status: "preview",
    short: "Turn one blog post into a set of derivative posts for other channels.",
    valueEstimate: "Saves ~2 hrs per post",
    tagline: "Squeeze more reach out of content you already wrote.",
    helpsWith: ["Extracting key points from long content", "Reformatting per channel", "Keeping the core message intact", "Multiplying one post into many"],
    whoFor: ["Creators", "Marketers", "Founders publishing regularly"],
    limitations: ["Works from text you provide.", "Drafts only — no auto-publishing.", "You review each derivative."],
    fullDeployment: ["Pulls posts from your CMS automatically", "Generates a full multi-channel pack", "Queues each for approval", "Runs in your own stack"],
    workflow: previewWorkflow(
      "You paste a blog post.",
      "The agent extracts and reformats per channel.",
      "Returns a pack of derivative drafts.",
    ),
  },
  {
    slug: "youtube-script-agent",
    name: "YouTube Script Agent",
    category: "Content",
    status: "preview",
    short: "Turn a video idea into a structured script outline with hook and beats.",
    valueEstimate: "Saves ~2 hrs per script",
    tagline: "A script skeleton with a strong hook so you can just hit record.",
    helpsWith: ["Writing a retention-aware hook", "Structuring beats and sections", "Keeping pacing tight", "Beating the blank-page problem"],
    whoFor: ["Creators", "Founders doing video", "Marketers"],
    limitations: ["Produces a script outline, not a finished teleprompter script.", "No editing or production tooling.", "You shape the final voice."],
    fullDeployment: ["Adapts to your channel style", "Generates full scripts plus shot notes", "Feeds into your production workflow", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You give a video idea and audience.",
      "The agent structures hook, beats, and close.",
      "Returns an editable script outline.",
    ),
  },

  /* =============================== RESEARCH ============================== */
  {
    slug: "research-summary-agent",
    name: "Research Summary Agent",
    category: "Research",
    status: "preview",
    short: "Condense a dense source into a structured, skimmable summary.",
    valueEstimate: "Saves ~1 hr per source",
    tagline: "Get the gist of dense material without losing the important nuance.",
    helpsWith: ["Condensing long text", "Surfacing key claims and caveats", "Producing a skimmable structure", "Speeding up a literature pass"],
    whoFor: ["Researchers", "Consultants", "Operators digesting reports"],
    limitations: ["Summarises text you provide.", "Not a substitute for reading critical sources.", "You verify claims."],
    fullDeployment: ["Ingests PDFs and links from your library", "Builds running summaries across sources", "Flags contradictions", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You paste a source.",
      "The agent extracts claims, evidence, and caveats.",
      "Returns a structured summary.",
    ),
  },
  {
    slug: "ai-paper-to-content-agent",
    name: "AI Paper-to-Content Agent",
    category: "Research",
    status: "preview",
    short: "Turn an AI paper's findings into an accessible post for a general audience.",
    valueEstimate: "Saves ~2 hrs per paper",
    tagline: "Translate dense research into something your audience will actually read.",
    helpsWith: ["Extracting the core finding", "Explaining without jargon", "Keeping accuracy intact", "Producing a shareable draft"],
    whoFor: ["Researchers who write", "Creators in the AI space", "Marketers in technical fields"],
    limitations: ["Works from text you provide.", "You verify the science before publishing.", "Draft only — no auto-publishing."],
    fullDeployment: ["Pulls papers from your reading list", "Generates multi-format content", "Keeps a citation trail", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You paste a paper abstract or section.",
      "The agent extracts and translates the finding.",
      "Returns an accessible content draft.",
    ),
  },
  {
    slug: "literature-review-helper",
    name: "Literature Review Helper",
    category: "Research",
    status: "preview",
    short: "Organise multiple sources into themes and gaps for a review.",
    valueEstimate: "Saves ~3 hrs of synthesis",
    tagline: "Turn a pile of sources into themes, agreements, and open gaps.",
    helpsWith: ["Clustering sources by theme", "Spotting agreement and conflict", "Surfacing research gaps", "Drafting a synthesis structure"],
    whoFor: ["Researchers", "PhD students", "Analysts"],
    limitations: ["Works from summaries you provide.", "Not a citation manager.", "You verify and cite properly."],
    fullDeployment: ["Connects to your reference manager", "Maintains a living thematic map", "Flags new sources to slot in", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You provide source summaries.",
      "The agent clusters themes and finds gaps.",
      "Returns a synthesis structure.",
    ),
  },
  {
    slug: "argument-mapper",
    name: "Argument Mapper",
    category: "Research",
    status: "preview",
    short: "Break a complex argument into claims, evidence, and assumptions.",
    valueEstimate: "Saves ~1 hr of analysis",
    tagline: "See the structure of an argument — including the unstated parts.",
    helpsWith: ["Separating claims from evidence", "Surfacing hidden assumptions", "Spotting weak links", "Strengthening your own case"],
    whoFor: ["Researchers", "Consultants", "Operators making decisions"],
    limitations: ["Maps the text you provide.", "Does not fact-check claims.", "You judge soundness."],
    fullDeployment: ["Maps long documents automatically", "Links to supporting sources", "Tracks argument changes over drafts", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You paste an argument or essay.",
      "The agent maps claims, evidence, and assumptions.",
      "Returns a structured argument map.",
    ),
  },
  {
    slug: "model-variance-tester",
    name: "Model Variance Tester",
    category: "Research",
    status: "preview",
    short: "Compare how outputs vary across prompts or runs for the same task.",
    valueEstimate: "Saves ~2 hrs of manual testing",
    tagline: "Understand where a model is stable and where it drifts.",
    helpsWith: ["Comparing outputs across runs", "Spotting instability", "Documenting variance", "Informing prompt choices"],
    whoFor: ["Researchers", "AI practitioners", "Operators evaluating tools"],
    limitations: ["Demo compares provided samples, not live model calls.", "Not a benchmark suite.", "You interpret the results."],
    fullDeployment: ["Runs controlled comparisons across models", "Logs variance over time", "Produces reproducible reports", "Runs in your own environment"],
    workflow: previewWorkflow(
      "You provide outputs to compare.",
      "The agent analyses variance and patterns.",
      "Returns a variance summary.",
    ),
  },
  {
    slug: "source-to-insight-agent",
    name: "Source-to-Insight Agent",
    category: "Research",
    status: "preview",
    short: "Turn raw source material into a few defensible insights.",
    valueEstimate: "Saves ~1–2 hrs",
    tagline: "Move from raw material to insights you can actually act on.",
    helpsWith: ["Extracting non-obvious insights", "Tying insights to evidence", "Filtering noise", "Producing decision-ready takeaways"],
    whoFor: ["Researchers", "Consultants", "Operators"],
    limitations: ["Works from what you provide.", "Insights need human validation.", "No auto-decisions."],
    fullDeployment: ["Ingests from your data sources", "Maintains an insight log", "Links insights to evidence", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You provide source material.",
      "The agent extracts evidence-backed insights.",
      "Returns decision-ready takeaways.",
    ),
  },

  /* ============================== OPERATIONS ============================= */
  {
    slug: "meeting-notes-to-action-agent",
    name: "Meeting Notes to Action Agent",
    category: "Operations",
    status: "preview",
    short: "Turn messy meeting notes into clear owners, actions, and deadlines.",
    valueEstimate: "Saves ~30 min/meeting",
    tagline: "Walk out of every meeting with a clean action list — not a wall of notes.",
    helpsWith: ["Extracting decisions and actions", "Assigning likely owners", "Flagging unclear items", "Producing a shareable summary"],
    whoFor: ["Operators", "Founders", "Consultants", "Team leads"],
    limitations: ["Works from notes you paste.", "Does not create tasks in any tool.", "You confirm owners and dates."],
    fullDeployment: ["Ingests transcripts automatically", "Creates tasks in your project tool on approval", "Tracks follow-through", "Runs in your own stack"],
    workflow: previewWorkflow(
      "You paste meeting notes.",
      "The agent extracts actions, owners, and dates.",
      "Returns a clean action list.",
    ),
  },
  {
    slug: "weekly-planning-agent",
    name: "Weekly Planning Agent",
    category: "Operations",
    status: "preview",
    short: "Turn goals and a task dump into a prioritised week.",
    valueEstimate: "Saves ~45 min/week",
    tagline: "Start the week with a plan, not a pile.",
    helpsWith: ["Prioritising against goals", "Sequencing the week", "Flagging overload", "Producing a clear plan"],
    whoFor: ["Founders", "Operators", "Freelancers", "Solo creators"],
    limitations: ["Works from what you provide.", "Does not touch your calendar.", "You adjust and commit."],
    fullDeployment: ["Reads your calendar and tasks", "Drafts a plan each week for approval", "Adapts to what slips", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You give goals and a task dump.",
      "The agent prioritises and sequences.",
      "Returns a prioritised weekly plan.",
    ),
  },
  {
    slug: "decision-memo-agent",
    name: "Decision Memo Agent",
    category: "Operations",
    status: "preview",
    short: "Turn a decision and its context into a structured one-page memo.",
    valueEstimate: "Saves ~1 hr per memo",
    tagline: "Make decisions legible — options, trade-offs, and a recommendation.",
    helpsWith: ["Framing the decision clearly", "Laying out options and trade-offs", "Stating a recommendation", "Producing a shareable memo"],
    whoFor: ["Founders", "Operators", "Consultants", "Team leads"],
    limitations: ["Works from what you provide.", "Does not make the decision for you.", "You own the call."],
    fullDeployment: ["Pulls context from your docs", "Maintains a decision log", "Routes memos for input", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You describe the decision and context.",
      "The agent structures options and trade-offs.",
      "Returns a one-page decision memo.",
    ),
  },
  {
    slug: "sop-builder-agent",
    name: "SOP Builder Agent",
    category: "Operations",
    status: "preview",
    short: "Turn a described process into a clean, repeatable SOP.",
    valueEstimate: "Saves ~1–2 hrs per SOP",
    tagline: "Document a process once, clearly enough that anyone can follow it.",
    helpsWith: ["Structuring steps in order", "Clarifying inputs and outputs", "Flagging decision points", "Producing a usable SOP"],
    whoFor: ["Operators", "Small business owners", "Founders scaling a team"],
    limitations: ["Works from your description.", "Does not run the process.", "You verify accuracy."],
    fullDeployment: ["Builds SOPs from recordings or transcripts", "Stores them in your knowledge base", "Keeps them updated", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You describe the process.",
      "The agent structures clear, ordered steps.",
      "Returns a repeatable SOP.",
    ),
  },
  {
    slug: "workflow-audit-agent",
    name: "Workflow Audit Agent",
    category: "Operations",
    status: "preview",
    short: "Examine a described workflow and flag friction, risk, and automation candidates.",
    valueEstimate: "Saves ~2 hrs of analysis",
    tagline: "Find the slow, risky, and automatable parts of how you work.",
    helpsWith: ["Spotting friction and bottlenecks", "Flagging manual risk", "Identifying automation candidates", "Prioritising fixes"],
    whoFor: ["Operators", "Small business owners", "Founders", "Consultants"],
    limitations: ["Works from your description.", "Recommends — does not change anything.", "You decide what to act on."],
    fullDeployment: ["Observes real tool usage", "Quantifies time and cost", "Proposes safe automations", "Implements inside your own tools on approval"],
    workflow: previewWorkflow(
      "You describe a workflow.",
      "The agent flags friction and automation candidates.",
      "Returns a prioritised audit.",
    ),
  },
  {
    slug: "custom-agent-recommender",
    name: "Custom Agent Recommender",
    category: "Operations",
    status: "live",
    short: "Describe your business and tasks, and get tailored agent ideas worth building.",
    valueEstimate: "Saves hours of scoping",
    tagline: "Not sure where an agent fits? Describe your work and get grounded recommendations.",
    helpsWith: [
      "Identifying where agents could actually help you",
      "Matching ideas to your current tools",
      "Prioritising by likely value and effort",
      "Giving you a sensible starting point for a consult",
    ],
    whoFor: ["Small business owners", "Founders", "Operators", "Freelancers", "Anyone unsure where to start"],
    limitations: [
      "Recommends ideas — it does not build or deploy anything.",
      "Quality depends on how clearly you describe your tasks.",
      "A real build is scoped during a consult.",
    ],
    fullDeployment: [
      "Maps recommendations onto your exact stack",
      "Scopes effort, risk, and guardrails for each",
      "Prioritises a roadmap with you",
      "Builds and runs the chosen agents inside your own tools",
    ],
    workflow: [
      { title: "Describe your work", detail: "You share business type, tools, repetitive tasks, and the outcome you want." },
      { title: "n8n orchestration", detail: "Routing and guardrails run privately inside n8n." },
      { title: "Fit analysis", detail: "The agent matches your tasks to viable agent patterns." },
      { title: "Ranked ideas", detail: "Returns tailored recommendations with rationale." },
      { title: "Human review", detail: "You decide what is worth a consult. Nothing is built automatically." },
    ],
    form: {
      submitLabel: "Recommend agents for me",
      fields: [
        { kind: "input", name: "business_type", label: "Business type", placeholder: "e.g. solo consultancy, agency, SaaS", required: true, maxLength: 160 },
        { kind: "input", name: "current_tools", label: "Current tools", placeholder: "e.g. Notion, Gmail, Slack, Sheets", required: true, maxLength: 200 },
        {
          kind: "textarea",
          name: "repetitive_tasks",
          label: "Repetitive tasks",
          placeholder: "What do you find yourself doing over and over?",
          required: true,
          rows: 5,
          maxLength: 1200,
          helper: "Be specific — the clearer the tasks, the better the recommendations.",
        },
        { kind: "input", name: "desired_outcome", label: "Desired outcome", placeholder: "What would success look like?", required: true, maxLength: 200 },
        { kind: "input", name: "email", label: "Email (optional)", placeholder: "Get a copy of the recommendations", required: false, maxLength: 160 },
      ],
    },
  },

  /* ================== CREATOR / FREELANCER / SMALL BUSINESS ============= */
  {
    slug: "founder-bio-agent",
    name: "Founder Bio Agent",
    category: "Creator",
    status: "preview",
    short: "Turn your background into clean bios in multiple lengths.",
    valueEstimate: "Saves ~45 min",
    tagline: "One clear story, sized for every place you need a bio.",
    helpsWith: ["Writing short, medium, and long bios", "Keeping a consistent narrative", "Matching tone to context", "Avoiding cliché"],
    whoFor: ["Founders", "Creators", "Consultants", "Freelancers"],
    limitations: ["Works from what you provide.", "Draft only.", "You verify facts."],
    fullDeployment: ["Maintains bios across your profiles", "Updates them as you grow", "Matches each platform's style", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You share your background.",
      "The agent drafts bios in multiple lengths.",
      "Returns short, medium, and long versions.",
    ),
  },
  {
    slug: "personal-brand-positioning-agent",
    name: "Personal Brand Positioning Agent",
    category: "Creator",
    status: "preview",
    short: "Clarify what you are known for and how to say it.",
    valueEstimate: "Saves ~2 hrs of thinking",
    tagline: "Get clear on your lane — and a one-liner that holds up.",
    helpsWith: ["Clarifying your focus", "Finding your differentiation", "Drafting a positioning statement", "Aligning your content"],
    whoFor: ["Creators", "Consultants", "Founders", "Freelancers"],
    limitations: ["Works from what you share.", "Positioning needs your judgment.", "Draft only."],
    fullDeployment: ["Aligns positioning across channels", "Feeds your content strategy", "Tracks consistency", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You describe your work and audience.",
      "The agent clarifies positioning and differentiation.",
      "Returns a positioning statement and one-liner.",
    ),
  },
  {
    slug: "lead-magnet-idea-agent",
    name: "Lead Magnet Idea Agent",
    category: "Freelancer",
    status: "preview",
    short: "Generate lead magnet ideas matched to an audience and offer.",
    valueEstimate: "Saves ~1 hr of ideation",
    tagline: "Ideas for something worth trading an email address for.",
    helpsWith: ["Generating relevant lead magnet ideas", "Matching format to audience", "Tying magnets to your offer", "Prioritising by effort"],
    whoFor: ["Freelancers", "Creators", "Small business owners", "Marketers"],
    limitations: ["Generates ideas, not finished assets.", "You build the chosen magnet.", "No delivery tooling."],
    fullDeployment: ["Generates the magnet content", "Wires up delivery and capture", "Tracks conversion", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You describe your audience and offer.",
      "The agent generates matched magnet ideas.",
      "Returns prioritised ideas.",
    ),
  },
  {
    slug: "course-outline-agent",
    name: "Course Outline Agent",
    category: "Creator",
    status: "preview",
    short: "Turn a topic and audience into a structured course outline.",
    valueEstimate: "Saves ~3 hrs of planning",
    tagline: "A module-by-module skeleton so you can start building, not staring.",
    helpsWith: ["Structuring modules and lessons", "Sequencing for learning", "Defining outcomes per module", "Beating the blank-page problem"],
    whoFor: ["Creators", "Consultants", "Educators", "Founders"],
    limitations: ["Produces an outline, not full content.", "You build the lessons.", "Draft only."],
    fullDeployment: ["Generates lesson content per module", "Builds assessments", "Drops into your course tool", "Runs in your own stack"],
    workflow: previewWorkflow(
      "You give a topic and audience.",
      "The agent structures modules and outcomes.",
      "Returns a course outline.",
    ),
  },
  {
    slug: "podcast-prep-agent",
    name: "Podcast Prep Agent",
    category: "Creator",
    status: "preview",
    short: "Turn a guest and theme into research notes and a question flow.",
    valueEstimate: "Saves ~1–2 hrs/episode",
    tagline: "Walk into the recording prepared, with a flow that goes somewhere.",
    helpsWith: ["Generating guest research angles", "Building a question flow", "Avoiding generic questions", "Preparing strong follow-ups"],
    whoFor: ["Creators", "Podcasters", "Founders doing interviews"],
    limitations: ["Works from what you provide.", "Verify facts about guests.", "Draft only."],
    fullDeployment: ["Researches guests from public sources", "Builds a full prep doc", "Adapts to your show style", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You give a guest and theme.",
      "The agent drafts research and a question flow.",
      "Returns a prep outline.",
    ),
  },
  {
    slug: "consulting-offer-builder",
    name: "Consulting Offer Builder",
    category: "Small Business",
    status: "preview",
    short: "Turn your skills into a clear, packaged consulting offer.",
    valueEstimate: "Saves ~2 hrs of positioning",
    tagline: "Package what you do into an offer people can actually say yes to.",
    helpsWith: ["Defining the outcome you sell", "Structuring scope and deliverables", "Clarifying who it is for", "Drafting offer copy"],
    whoFor: ["Consultants", "Freelancers", "Small business owners"],
    limitations: ["Works from what you share.", "You set pricing.", "Draft only."],
    fullDeployment: ["Aligns offers across your site and proposals", "Generates proposal templates", "Tracks what converts", "Runs in your own tools"],
    workflow: previewWorkflow(
      "You describe your skills and clients.",
      "The agent structures a packaged offer.",
      "Returns offer structure and copy.",
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Derived helpers.                                                   */
/* ------------------------------------------------------------------ */

export const categories: Category[] = [
  "Marketing",
  "Content",
  "Research",
  "Operations",
  "Creator",
  "Freelancer",
  "Small Business",
];

export function getAgentBySlug(slug: string): Agent | undefined {
  return agents.find((a) => a.slug === slug);
}

export function getAgentsByCategory(category: Category): Agent[] {
  return agents.filter((a) => a.category === category);
}

export const liveAgents = agents.filter((a) => a.status === "live");
export const previewAgents = agents.filter((a) => a.status === "preview");

/** Categories used in the homepage "Featured sections" band. */
export const featuredCategories: { category: Category; blurb: string }[] = [
  { category: "Marketing", blurb: "Angles, critiques, and campaign thinking." },
  { category: "Content", blurb: "Drafts in your voice across channels." },
  { category: "Research", blurb: "Summarise, map, and synthesise sources." },
  { category: "Freelancer", blurb: "Position, package, and pitch your work." },
  { category: "Small Business", blurb: "Operationalise the work you repeat." },
];
