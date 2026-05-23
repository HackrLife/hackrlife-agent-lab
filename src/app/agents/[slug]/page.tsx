import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { agents, getAgentBySlug } from "@/lib/agents";
import { CategoryBadge, StatusBadge } from "@/components/Badge";
import { FeatureList } from "@/components/FeatureList";
import { WorkflowDiagram } from "@/components/WorkflowDiagram";
import { AgentForm } from "@/components/AgentForm";
import { PreviewPanel } from "@/components/PreviewPanel";
import { Eyebrow } from "@/components/Section";

/** Pre-render every agent page at build time. */
export function generateStaticParams() {
  return agents.map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const agent = getAgentBySlug(params.slug);
  if (!agent) return { title: "Agent not found" };
  return {
    title: agent.name,
    description: `${agent.short} ${agent.status === "live" ? "Live demo." : "Use-case preview."}`,
    openGraph: { title: `${agent.name} · HackrLife Agent Lab`, description: agent.short },
  };
}

export default function AgentPage({ params }: { params: { slug: string } }) {
  const agent = getAgentBySlug(params.slug);
  if (!agent) notFound();

  const isLive = agent.status === "live";

  return (
    <article>
      {/* 1. Hero */}
      <section className="relative overflow-hidden border-b border-ink-600/10 dark:border-paper/10">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-40" />
        <div className="container-lab relative py-14 sm:py-20">
          <div className="mb-5 flex items-center gap-2">
            <Link href="/agents" className="font-mono text-xs text-ink-500 dark:text-paper/50 hover:text-ink-900">
              ← All agents
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={agent.category} />
            <StatusBadge status={agent.status} />
            <span className="pill border border-ink-600/15 dark:border-paper/15 bg-white/60 dark:bg-ink-800/60 text-ink-600 dark:text-paper/70">
              {agent.valueEstimate}
            </span>
          </div>
          <h1 className="mt-5 max-w-3xl font-display text-4xl font-semibold leading-tight text-ink-900 dark:text-paper sm:text-5xl">
            {agent.name}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-600 dark:text-paper/70">{agent.tagline}</p>
        </div>
      </section>

      <div className="container-lab space-y-16 py-16">
        {/* 2 + 3. What this helps with / Who it is for */}
        <section className="grid gap-6 md:grid-cols-2">
          <FeatureList title="What this agent helps with" items={agent.helpsWith} tone="signal" />
          <FeatureList title="Who it is for" items={agent.whoFor} tone="default" />
        </section>

        {/* 4. Try the lightweight demo (live) OR preview */}
        <section id="demo">
          <Eyebrow>{isLive ? "Try the lightweight demo" : "Use-case preview"}</Eyebrow>
          <h2 className="font-display text-3xl font-semibold text-ink-900 dark:text-paper">
            {isLive ? "Test the use case" : "Explore this workflow"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-paper/70">
            {isLive
              ? "Fill in the fields and run it. The request is sent to a private n8n workflow and the output appears on the right. Nothing is published, scheduled, or stored."
              : "This agent is a preview of a workflow that can be built for you. Here is what it would do and how it would run."}
          </p>
          <div className="mt-6">
            {isLive ? <AgentForm agent={agent} /> : <PreviewPanel agent={agent} />}
          </div>
        </section>

        {/* 5 + 6. Demo limitations / Full deployment */}
        <section className="grid gap-6 md:grid-cols-2">
          <FeatureList title="Demo limitations" items={agent.limitations} tone="muted" />
          <FeatureList title="What a full deployment would include" items={agent.fullDeployment} tone="signal" />
        </section>

        {/* 7. Workflow diagram */}
        <section>
          <Eyebrow>How it runs</Eyebrow>
          <h2 className="font-display text-3xl font-semibold text-ink-900 dark:text-paper">Workflow diagram</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-paper/70">
            Every request follows the same shape: your input goes to a private n8n workflow, the
            agent reasons over it, and a structured output comes back for your review.
          </p>
          <div className="mt-6">
            <WorkflowDiagram steps={agent.workflow} />
          </div>
        </section>

        {/* 9. CTA after output */}
        <section className="relative overflow-hidden rounded-2xl border border-ink-600/15 dark:border-paper/15 bg-ink-900 px-7 py-12 text-paper sm:px-12">
          <div className="pointer-events-none absolute -right-10 top-0 h-40 w-40 rounded-full bg-signal/20 blur-3xl" />
          <div className="relative max-w-2xl">
            <h2 className="font-display text-3xl font-semibold">
              Want this adapted to your workflow?
            </h2>
            <p className="mt-3 text-base leading-relaxed text-paper/70">
              Book a consult and I will adapt this agent inside your own tools — scoped for your
              stack, with the right guardrails, and nothing running without your say-so.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/consult" className="btn-signal">Book a consult</Link>
              <Link
                href="/agents"
                className="btn-ghost border-paper/20 bg-transparent text-paper hover:border-paper/50 hover:bg-paper/5"
              >
                Explore more agents
              </Link>
            </div>
          </div>
        </section>
      </div>
    </article>
  );
}
