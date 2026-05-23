import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow } from "@/components/Section";
import { links } from "@/lib/site";

export const metadata: Metadata = {
  title: "Resources",
  description: "Links to the GitHub repo, CV, and newsletter behind HackrLife Agent Lab.",
};

const resources = [
  {
    label: "GitHub",
    desc: "The source for this lab. Built with Next.js, TypeScript, and Tailwind; deployed on Vercel.",
    href: links.github,
    cta: "View the repo",
  },
  {
    label: "CV / personal site",
    desc: "More about my background, research, and consulting work.",
    href: links.cv,
    cta: "Visit dev-das.com",
  },
  {
    label: "Newsletter",
    desc: "Practical notes on AI workflows for small operators — research-backed, no hype.",
    href: links.newsletter,
    cta: "Read on hackrlife.com",
  },
];

export default function ResourcesPage() {
  return (
    <div className="container-lab py-16 sm:py-20">
      <Eyebrow>Resources</Eyebrow>
      <h1 className="max-w-3xl font-display text-4xl font-semibold text-ink-900 dark:text-paper sm:text-5xl">
        Where to go next
      </h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-600 dark:text-paper/70">
        The code, the writing, and the person behind the lab. The agent backend itself runs
        privately and isn’t linked here.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {resources.map((r) => (
          <a
            key={r.label}
            href={r.href}
            target="_blank"
            rel="noopener noreferrer"
            className="card card-hover group flex flex-col p-6"
          >
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-paper">{r.label}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600 dark:text-paper/70">{r.desc}</p>
            <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-ink-900 dark:text-paper">
              {r.cta}
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </span>
          </a>
        ))}
      </div>

      <div className="mt-10 rounded-2xl border border-ink-600/15 dark:border-paper/15 bg-white/60 dark:bg-ink-800/60 p-6 text-sm text-ink-600 dark:text-paper/70">
        <p>
          <span className="font-semibold text-ink-900 dark:text-paper">A note on the backend.</span> The demos run on
          a private n8n instance. All AI and API logic lives there, not in this frontend, and the
          backend is intentionally not linked publicly.
        </p>
      </div>

      <div className="mt-10">
        <Link href="/consult" className="btn-signal">Book a consult</Link>
      </div>
    </div>
  );
}
