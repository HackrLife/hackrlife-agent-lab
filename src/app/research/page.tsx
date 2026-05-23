import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow } from "@/components/Section";

export const metadata: Metadata = {
  title: "Research",
  description:
    "The research focus: how small businesses, creators, freelancers, and marketers use AI agents, where they create value, and where they fail.",
};

const questions = [
  {
    q: "Where do agents create value?",
    a: "Which tasks genuinely get faster or better — and by how much — when a small operator hands them to an agentic workflow.",
  },
  {
    q: "Where do they fail?",
    a: "The failure modes that matter in practice: brittle outputs, silent errors, over-automation, and tasks that look automatable but aren’t.",
  },
  {
    q: "What needs human judgment?",
    a: "The decisions that should stay with a person, and how to design workflows that keep a human meaningfully in the loop.",
  },
  {
    q: "What’s actually worth building?",
    a: "Separating the workflows worth investing in from the ones that are demos forever.",
  },
];

const groups = [
  { name: "Small businesses", focus: "Operational repetition, customer communication, and the cost of context-switching." },
  { name: "Creators", focus: "Voice consistency, idea generation, and repurposing across channels without losing authenticity." },
  { name: "Freelancers", focus: "Positioning, outreach, and packaging — the business work around the craft." },
  { name: "Marketers", focus: "Angle generation, critique, and testing — speed without sacrificing quality." },
];

export default function ResearchPage() {
  return (
    <div className="container-lab py-16 sm:py-20">
      <Eyebrow>Research focus</Eyebrow>
      <h1 className="max-w-4xl font-display text-4xl font-semibold leading-tight text-ink-900 dark:text-paper sm:text-5xl">
        How small businesses, creators, freelancers, and marketers use AI agents — where they create
        value, and where they fail.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-600 dark:text-paper/70">
        This lab is the practical arm of that research. Each agent is a small experiment; each demo
        is a chance to observe how a real workflow behaves when a real person tries to use it.
      </p>

      {/* Core questions */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold text-ink-900 dark:text-paper">The questions</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {questions.map((item, i) => (
            <div key={i} className="card p-6">
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-500 dark:text-paper/50">
                Q{i + 1}
              </span>
              <h3 className="mt-2 font-display text-lg font-semibold text-ink-900 dark:text-paper">{item.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-paper/70">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Who I study */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold text-ink-900 dark:text-paper">Who the lab studies</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.name} className="card flex gap-4 p-6">
              <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-signal" />
              <div>
                <h3 className="font-display text-lg font-semibold text-ink-900 dark:text-paper">{g.name}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-600 dark:text-paper/70">{g.focus}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Method note */}
      <section className="mt-14 rounded-2xl border border-ink-600/15 dark:border-paper/15 bg-white/60 dark:bg-ink-800/60 p-7 sm:p-10">
        <h2 className="font-display text-2xl font-semibold text-ink-900 dark:text-paper">How the demos fit in</h2>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-700 dark:text-paper/75">
          The live demos are deliberately limited. They let people test a use case end to end without
          deploying anything — which keeps the experience honest and the observations clean. Nothing
          publishes, schedules, or stores data automatically. When someone wants to take a workflow
          further, that happens through a consult, where a real deployment is scoped for their own
          tools.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/agents" className="btn-primary">Explore the agents</Link>
          <Link href="/consult" className="btn-ghost">Book a consult</Link>
        </div>
      </section>
    </div>
  );
}
