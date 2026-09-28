/**
 * src/lib/catalogue/types.ts
 * ------------------------------------------------------------------
 * Shared contracts for the twenty-product catalogue.
 *
 * Every product is one file in ./products exporting a `Product`.
 * The product page, gallery card, schematic and demo all read from it.
 * Demos are deterministic state machines: `start` creates a run from the
 * editable inputs, `act` applies one visitor/staff/clock action and returns
 * the next run. Nothing leaves the browser.
 * ------------------------------------------------------------------
 */

export type Sector =
  | "Home services"
  | "Automotive"
  | "Appointments"
  | "Accommodation"
  | "Local orders";

export type Outcome =
  | "Capture enquiries"
  | "Convert sales"
  | "Fill capacity"
  | "Grow repeat business"
  | "Manage orders";

export const SECTORS: Sector[] = [
  "Home services",
  "Automotive",
  "Appointments",
  "Accommodation",
  "Local orders",
];

export const OUTCOMES: Outcome[] = [
  "Capture enquiries",
  "Convert sales",
  "Fill capacity",
  "Grow repeat business",
  "Manage orders",
];

/* ------------------------------ Schematic ------------------------------ */

/** action = blue business step, branch = purple exception/return, check = amber harness control. */
export type NodeKind = "action" | "branch" | "check";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  title: string;
  /**
   * Vertical slot, 0-based, matching the main column rows (0..5).
   * Branch and check nodes use the row of the action they relate to
   * (fractions allowed, e.g. 1.5).
   */
  row: number;
  /** Node inspection: what comes in. */
  input: string;
  /** The rule, tool or check applied. */
  rule: string;
  /** Record or state produced. */
  output: string;
  /** Named exception / stop condition. */
  failure: string;
  /** System touched and how it is provided in the demo. */
  system?: string;
}

export type EdgeKind = "flow" | "return" | "check";

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Branch condition or loop label, e.g. "merge", "timed retry (max 3)". */
  label?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/* -------------------------------- Demo --------------------------------- */

export type RunStatus =
  | "idle"
  | "running"
  | "waiting_customer"
  | "waiting_staff"
  | "completed"
  | "stopped"
  | "failed";

export type EventStatus =
  | "started"
  | "passed"
  | "waiting"
  | "confirmed"
  | "failed"
  | "stopped"
  | "blocked"
  | "info";

export interface DemoEvent {
  id: string;
  /** Simulation clock, minutes since run start. */
  t: number;
  /** Graph node this event belongs to (must exist in product.graph). */
  node: string;
  status: EventStatus;
  label: string;
  detail?: string;
  /** Idempotency key for side effects. */
  opKey?: string;
  /** Record reference produced, e.g. BK-4821. */
  ref?: string;
}

export type Speaker = "customer" | "assistant" | "staff" | "system";

export interface Message {
  from: Speaker;
  text: string;
  t: number;
}

export type Actor = "customer" | "staff" | "clock";

export interface DemoAction {
  id: string;
  label: string;
  actor: Actor;
  /** Optional one-line explanation under the button. */
  hint?: string;
  tone?: "primary" | "default" | "danger";
  /** When set, the button reveals a text box; its value is passed as payload. */
  freeText?: { placeholder: string };
}

export type FieldTone = "ok" | "warn" | "bad" | "muted" | "default";

export interface RecordField {
  label: string;
  value: string;
  tone?: FieldTone;
}

export interface ResultRecord {
  /** Stable key so later steps update rather than duplicate. */
  id: string;
  title: string;
  ref?: string;
  status: string;
  tone?: FieldTone;
  fields: RecordField[];
}

export interface OutboxItem {
  id: string;
  channel: "sms" | "email" | "calendar" | "crm" | "task" | "payment" | "voice" | "chat";
  to: string;
  summary: string;
  status: "held" | "simulated" | "suppressed" | "pending" | "failed";
  t: number;
  opKey?: string;
}

export interface RunOutcome {
  kind: "success" | "exception" | "stopped" | "failed";
  summary: string;
}

export type InputValue = string | number | boolean;
export type Inputs = Record<string, InputValue>;

export interface Run<S = unknown> {
  runId: string;
  productId: string;
  scenarioId: string;
  status: RunStatus;
  clock: number;
  inputs: Inputs;
  messages: Message[];
  events: DemoEvent[];
  actions: DemoAction[];
  records: ResultRecord[];
  outbox: OutboxItem[];
  opKeys: string[];
  outcome?: RunOutcome;
  /** Product-specific machine state. */
  state: S;
  /** Internal counter for deterministic references. */
  seq: number;
}

export type InputField =
  | { kind: "text"; name: string; label: string; helper?: string }
  | { kind: "number"; name: string; label: string; min?: number; max?: number; step?: number; suffix?: string; helper?: string }
  | { kind: "select"; name: string; label: string; options: string[]; helper?: string }
  | { kind: "toggle"; name: string; label: string; helper?: string };

export interface Scenario {
  id: string;
  label: string;
  kind: "success" | "exception";
  description: string;
  inputs: Inputs;
}

export interface DemoDefinition<S = any> {
  mode: "simulation" | "sandbox" | "walkthrough";
  /** Exactly what is simulated, shown above the demo. */
  boundary: string;
  /** Name shown for the assistant in the conversation. */
  assistantName: string;
  /** Customer-side panel title, e.g. "Phone call", "Website chat", "SMS thread". */
  channelLabel: string;
  fields: InputField[];
  scenarios: Scenario[];
  /** Optional: offer browser speech in/out for the conversation. */
  voice?: boolean;
  start(inputs: Inputs, scenarioId: string): Run<S>;
  act(run: Run<S>, actionId: string, payload?: string): Run<S>;
}

/* ------------------------------- Product -------------------------------- */

export interface Product {
  id: string;
  no: number;
  slug: string;
  name: string;
  /** Card and hero outcome sentence. */
  outcome: string;
  /** Uppercase sector line from the brief, e.g. "INDEPENDENT AUTOMOTIVE". */
  sectorLabel: string;
  sectors: Sector[];
  outcomes: Outcome[];
  /** Two-sentence definition. */
  definition: string;
  /** Concrete business example. */
  situation: string;
  /** The desired end state for the owner. */
  endState: string;
  /** 3–5 observable capabilities. */
  handles: string[];
  /** What it deliberately does not do. */
  boundaries: string[];
  /** Example confirmation, owner handoff, record. */
  delivered: { title: string; body: string }[];
  deployment: { rules: string[]; systems: string[] };
  measures: string[];
  reliability: string[];
  harness: {
    systems: string;
    controls: string[];
  };
  /** Completion prompt, e.g. "Want this following up your actual enquiries?" */
  ctaLine: string;
  graph: Graph;
  demo: DemoDefinition;
}
