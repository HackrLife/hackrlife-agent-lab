"use client";

import { useState } from "react";
import type { DemoEvent, Inputs, Run } from "@/lib/catalogue/types";
import { getProduct } from "@/lib/catalogue";
import { DemoPanel } from "./DemoPanel";
import { WorkflowGraph } from "./WorkflowGraph";
import { Eyebrow } from "@/components/Section";

/**
 * ProductExperience — sections 4 (interactive demo) and 5 (workflow and
 * harness) share run state so the schematic highlights real demo events.
 * The product is looked up by slug on the client because demo definitions
 * contain functions, which cannot cross the server/client boundary.
 */
export function ProductExperience({ slug }: { slug: string }) {
  const product = getProduct(slug)!;
  const first = product.demo.scenarios[0];
  const [scenarioId, setScenarioId] = useState(first.id);
  const [inputs, setInputs] = useState<Inputs>({ ...first.inputs });
  const [run, setRun] = useState<Run | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [focused, setFocused] = useState<DemoEvent | null>(null);

  function reset() {
    setRun(null);
    setSelectedNode(null);
    setFocused(null);
  }

  return (
    <>
      <section id="demo" className="scroll-mt-24">
        <Eyebrow>Interactive demo</Eyebrow>
        <h2 className="font-display text-3xl font-semibold text-ink-900 dark:text-paper">Try it with sample data</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-paper/70">
          No sign-up needed. Pick a scenario, change the inputs, then play the customer and the owner. The right-hand panel only shows what the workflow actually recorded.
        </p>
        <div className="mt-6">
          <DemoPanel
            product={product}
            scenarioId={scenarioId}
            inputs={inputs}
            run={run}
            onScenario={(id) => {
              const sc = product.demo.scenarios.find((s) => s.id === id)!;
              setScenarioId(id);
              setInputs({ ...sc.inputs });
              reset();
            }}
            onInput={(name, value) => setInputs((s) => ({ ...s, [name]: value }))}
            onRun={() => {
              setSelectedNode(null);
              setFocused(null);
              setRun(product.demo.start(inputs, scenarioId));
            }}
            onAct={(id, payload) => {
              if (!run) return;
              setRun(product.demo.act(run, id, payload));
            }}
            onReset={() => {
              const sc = product.demo.scenarios.find((s) => s.id === scenarioId)!;
              setInputs({ ...sc.inputs });
              reset();
            }}
            onEventFocus={(ev) => {
              setFocused(ev);
              setSelectedNode(ev ? ev.node : null);
            }}
            focusedEvent={focused?.id ?? null}
          />
        </div>
      </section>

      <section id="workflow" className="scroll-mt-24">
        <Eyebrow>Workflow and harness</Eyebrow>
        <h2 className="font-display text-3xl font-semibold text-ink-900 dark:text-paper">How {product.name} runs</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-paper/70">
          Reference schematic for the proposed workflow. Blue steps do the work, purple paths handle exceptions and returns, and amber checks are the harness controls that a step cannot pass without.
          {run ? " Highlighted nodes are the ones this run actually reached." : ""}
        </p>
        <div className="mt-6">
          <WorkflowGraph graph={product.graph} events={run?.events ?? []} selectedNode={selectedNode} onSelectNode={setSelectedNode} focusEventNode={focused?.node ?? null} />
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <div className="card p-6">
            <h3 className="font-display text-lg font-semibold text-ink-900 dark:text-paper">Harness controls</h3>
            <ul className="mt-4 space-y-2.5">
              {product.harness.controls.map((c, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-700 dark:text-paper/75">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="card space-y-4 p-6 text-sm leading-relaxed text-ink-700 dark:text-paper/75">
            <div>
              <h3 className="font-display text-lg font-semibold text-ink-900 dark:text-paper">Systems and data</h3>
              <p className="mt-2">{product.harness.systems}</p>
            </div>
            <div>
              <h4 className="font-semibold text-ink-900 dark:text-paper">Demo boundary</h4>
              <p className="mt-1">
                External calls, customer messages, payments and business writes use synthetic fixtures and an on-screen outbox. The demo shows only verified demo state. Custom production connections are a paid implementation deliverable.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
