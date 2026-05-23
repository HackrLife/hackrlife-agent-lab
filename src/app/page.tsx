import Link from "next/link";
import { agents, featuredCategories, liveAgents } from "@/lib/agents";
import { Hero } from "@/components/Hero";
import { ResearchNote } from "@/components/ResearchNote";
import { SectionHeading } from "@/components/Section";
import { AgentGrid } from "@/components/AgentGrid";
import { CTASection } from "@/components/CTASection";
import { AgentCard } from "@/components/AgentCard";

export default function HomePage() {
  return (
    <>
      <Hero />

      {/* Research note */}
      <section className="container-lab -mt-4">
        <ResearchNote>
          This lab supports my PhD research into how small businesses, creators, freelancers, and
          marketers use AI agents: where they help, where they fail, and what workflows are worth
          building.
        </ResearchNote>
      </section>

      {/* Featured live demos */}
      <section className="container-lab mt-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading
            eyebrow="Start here"
            title="Five live demos you can test now"
            intro="These run end to end against a private n8n backend. Test the use case — nothing is published, scheduled, or stored."
          />
          <Link href="/agents" className="btn-ghost">
            See all 30 agents →
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {liveAgents.map((agent) => (
            <AgentCard key={agent.slug} agent={agent} />
          ))}
        </div>
      </section>

      {/* Featured category band */}
      <section className="container-lab mt-20">
        <SectionHeading
          eyebrow="By use case"
          title="Built around the work you actually do"
          intro="Every agent maps to a real job — marketing, content, research, freelancing, or running a small business."
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {featuredCategories.map((f, i) => (
            <Link
              key={f.category}
              href={`/agents?category=${encodeURIComponent(f.category)}`}
              className="card card-hover animate-fade-up group flex flex-col justify-between p-5"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div>
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-500 dark:text-paper/50">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 font-display text-lg font-semibold text-ink-900 dark:text-paper">
                  {f.category} agents
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600 dark:text-paper/70">{f.blurb}</p>
              </div>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-signal">
                Explore
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Full 30-agent gallery */}
      <section className="container-lab mt-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading
            eyebrow="The gallery"
            title="Thirty agents, seven categories"
            intro="A mix of live demos and use-case previews. Try the live ones, preview the rest, and book a consult to adapt any of them to your stack."
          />
          <Link href="/agents" className="btn-ghost">
            Filter & search →
          </Link>
        </div>
        <div className="mt-8">
          <AgentGrid agents={agents} />
        </div>
      </section>

      <CTASection />
    </>
  );
}
