import assert from "node:assert/strict";
import type { PathCase } from "./harness";

export const cases: PathCase[] = [
  {
    name: "brake noise → inspection booked tomorrow after calendar write",
    scenario: "brake_noise",
    steps: ["pick_0"],
    expect: {
      status: "completed",
      outcome: "success",
      events: ["Vehicle V-3310 verified", "No diagnosis or repair price generated", "Workshop calendar write confirmed", "confirmed with intake note"],
      records: { booking: "Confirmed", vehicle: "Verified", symptoms: "not a diagnosis", briefing: "Ready" },
      check: (r) => {
        const b = r.records.find((x) => x.id === "briefing")!;
        assert.match(b.fields.find((f) => f.label === "Diagnosis")!.value, /None made/);
        assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 1);
        assert.ok(r.records.find((x) => x.id === "booking")!.fields.some((f) => f.value.includes("tomorrow")));
      },
    },
  },
  {
    name: "ambiguous vehicle match requires confirmation before anything else",
    scenario: "two_vehicles",
    steps: [],
    expect: { status: "waiting_customer", events: ["confirmation required"], noEvents: ["verified", "calendar write"], records: { vehicle: "Awaiting customer confirmation" } },
  },
  {
    name: "confirmed vehicle (typed reply) then booked",
    scenario: "two_vehicles",
    steps: ["free:It's the RAV4", "pick_1"],
    expect: { outcome: "success", events: ["Customer confirmed 2021 Toyota RAV4", "Vehicle V-3318 verified"], check: (r) => assert.ok(r.records.find((x) => x.id === "booking")!.fields.some((f) => f.value.includes("DFL-07M"))) },
  },
  {
    name: "unclear vehicle reply gets a clarifying question, not a guess",
    scenario: "two_vehicles",
    steps: ["free:the grey one"],
    expect: { status: "waiting_customer", events: ["not understood"], noEvents: ["verified"] },
  },
  {
    name: "safety concern follows staff handoff, no automated booking",
    scenario: "safety",
    steps: ["adviser_take"],
    expect: { status: "completed", outcome: "exception", events: ["Safety concern — configured staff handoff", "Adviser took over"], noEvents: ["calendar write"], check: (r) => { assert.equal(r.outbox.filter((o) => o.channel === "calendar").length, 0); assert.equal(r.outbox.filter((o) => o.channel === "voice").length, 1); } },
  },
  {
    name: "unanswered safety handoff leaves a pending callback, not a booking",
    scenario: "safety",
    steps: ["adviser_no_answer"],
    expect: { status: "stopped", events: ["did not answer"], check: (r) => assert.ok(r.outbox.some((o) => o.channel === "task" && o.status === "pending")) },
  },
  {
    name: "safety words typed mid-booking trigger the handoff",
    scenario: "brake_noise",
    steps: ["free:actually the pedal is going to the floor"],
    expect: { status: "waiting_staff", events: ["Safety concern"] },
  },
  {
    name: "price question: technician will assess, no price given",
    scenario: "brake_noise",
    steps: ["ask_price", "free:can you do it cheaper?", "pick_0"],
    expect: {
      outcome: "success",
      events: ["Repair price request not answered"],
      check: (r) => {
        assert.ok(!r.messages.filter((m) => m.from === "assistant").some((m) => /A\$/.test(m.text)), "assistant must not quote a price");
        assert.match(r.records.find((x) => x.id === "briefing")!.fields.find((f) => f.label === "Price given")!.value, /technician will assess/);
      },
    },
  },
  {
    name: "new caller with missing details → collected before booking",
    scenario: "new_missing",
    steps: ["give_details", "pick_0"],
    expect: { outcome: "success", events: ["Missing vehicle details", "Missing details collected"], records: { customer: "New customer", vehicle: "Verified" }, check: (r) => assert.ok(r.records.find((x) => x.id === "vehicle")!.fields.some((f) => f.value === "EMZ-31B")) },
  },
  {
    name: "no bay on Thursday → alternative day offered (Friday for a 3-hour service)",
    scenario: "no_bay",
    steps: ["pick_0"],
    expect: { outcome: "success", events: ["No suitable bay on Thursday", "Standard logbook service · 180 min"], check: (r) => assert.ok(r.records.find((x) => x.id === "booking")!.fields.some((f) => f.value.startsWith("Friday"))) },
  },
  {
    name: "logbook service price question: approved list price, no brake-noise copy",
    scenario: "no_bay",
    steps: ["ask_price", "pick_0"],
    expect: {
      outcome: "success",
      events: ["Standard service price quoted from the approved list: A$329"],
      noEvents: ["technician will assess"],
      check: (r) => {
        const a = r.messages.filter((m) => m.from === "assistant").map((m) => m.text).join(" ");
        assert.doesNotMatch(a, /brake/i);
        assert.ok(r.messages.some((m) => m.from === "customer" && m.text === "How much is the service?"));
      },
    },
  },
  {
    name: "safety copy follows the symptom input (warning light, not brakes)",
    scenario: "safety",
    steps: [],
    expect: {
      status: "waiting_staff",
      check: (r) => {
        const { demo } = require("../src/lib/catalogue/products/garage-receptionist").garageReceptionist;
        const run = demo.start({ ...r.inputs, symptom: "Dashboard warning light" }, "safety");
        const said = run.messages.filter((m: any) => m.from === "customer").map((m: any) => m.text).join(" ");
        assert.doesNotMatch(said, /pedal|brake/i);
        assert.match(said, /flashing/);
        const transfer = run.outbox.find((o: any) => o.channel === "voice");
        assert.match(transfer.summary, /engine warning light/);
        assert.doesNotMatch(transfer.summary, /brakes/);
        assert.equal(run.status, "waiting_staff");
      },
    },
  },
  {
    name: "free text “no worries, the morning one” books rather than cancelling",
    scenario: "brake_noise",
    steps: ["free:No worries, the morning one please"],
    expect: { outcome: "success", noEvents: ["ended the enquiry"] },
  },
];
