import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow } from "@/components/Section";
import { ResearchNote } from "@/components/ResearchNote";
import { site, links } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "About HackrLife Agent Lab — a research-backed demo lab exploring how small businesses, creators, freelancers, and marketers actually use AI agents.",
};

export default function AboutPage() {
  return (
    <div className="container-lab py-16 sm:py-20">
      <Eyebrow>About the project</Eyebrow>
      <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight text-ink-900 dark:text-paper sm:text-5xl">
        A lab for studying how AI agents actually get used.
      </h1>

      <div className="mt-8 grid gap-12 lg:grid-cols-[1.4fr_1fr]">
        <div className="prose-lab max-w-2xl space-y-5 text-[15px]">
          <p>
            I’m building this lab as part of my broader research into practical AI adoption. The
            consumer narrative around agents is loud and often hype-driven. What’s missing is a
            grounded picture of where these tools genuinely help, and where they quietly fail.
          </p>
          <p>
            I’m especially interested in how small businesses, creators, freelancers, and marketers
            actually use agentic workflows — not in a demo on a stage, but inside the messy, real
            tools they already work in every day.
          </p>
          <p>
            The focus here is not hype. The focus is execution: what saves time, what improves
            quality, what fails, and what needs human judgment. Each agent in this lab is a small,
            honest experiment toward answering those questions.
          </p>
          <p>
            I also consult on specific use cases — helping people design safe, useful workflows
            inside their own tools, with the right guardrails and a human firmly in the loop. The
            demos here are deliberately limited: you can test a use case, but deploying a real agent
            is something we scope together.
          </p>
        </div>

        <aside className="space-y-4">
          <div className="card p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-paper/50">
              Built by
            </p>
            <p className="mt-2 font-display text-xl font-semibold text-ink-900 dark:text-paper">{site.builtBy}</p>
            <p className="mt-1 text-sm text-ink-600 dark:text-paper/70">{site.tagline}.</p>
            <div className="mt-5 flex flex-col gap-2 text-sm">
              <a href={links.cv} target="_blank" rel="noopener noreferrer" className="text-ink-700 dark:text-paper/75 hover:text-ink-900">
                → CV / personal site
              </a>
              <a href={links.newsletter} target="_blank" rel="noopener noreferrer" className="text-ink-700 dark:text-paper/75 hover:text-ink-900">
                → Newsletter
              </a>
              <Link href="/research" className="text-ink-700 dark:text-paper/75 hover:text-ink-900">
                → Read the research focus
              </Link>
            </div>
          </div>
          <Link href="/consult" className="btn-signal w-full">
            Book a consult
          </Link>
        </aside>
      </div>

      <div className="mt-14">
        <ResearchNote>
          The questions guiding this lab: where do agents create real value for small operators, and
          where do they fail or need a human in the loop? Every demo is a step toward an answer.
        </ResearchNote>
      </div>
    </div>
  );
}
