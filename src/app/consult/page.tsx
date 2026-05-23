import type { Metadata } from "next";
import { ConsultForm } from "@/components/ConsultForm";
import { Eyebrow } from "@/components/Section";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Book a consult",
  description:
    "Book a consult to discuss your workflow and adapt an agent demo inside your own tools. Practical, scoped, research-backed.",
};

export default function ConsultPage() {
  return (
    <div className="container-lab py-16 sm:py-20">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <Eyebrow>Consult</Eyebrow>
          <h1 className="font-display text-4xl font-semibold text-ink-900 dark:text-paper sm:text-5xl">
            Book a consult to discuss your workflow.
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-ink-600 dark:text-paper/70">
            If a demo fits your use case, the next step is adapting it inside your own tools. Tell me
            a bit about your work and what you’d like an agent to do, and we’ll scope something
            practical and safe.
          </p>

          <div className="mt-8 space-y-4 text-sm text-ink-700 dark:text-paper/75">
            <Point title="No hype, just execution">
              We focus on what saves time, what improves quality, and what genuinely needs human
              judgment.
            </Point>
            <Point title="Built inside your own tools">
              Agents run on your stack — not a platform you have to migrate to.
            </Point>
            <Point title="You stay in control">
              Nothing publishes or runs automatically without your explicit say-so.
            </Point>
          </div>

          <p className="mt-8 font-mono text-xs uppercase tracking-wide text-ink-500 dark:text-paper/50">
            Prefer email? Write to {site.consultEmail}
          </p>
        </div>

        <ConsultForm />
      </div>
    </div>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-signal text-[11px] text-white">✓</span>
      <p>
        <span className="font-semibold text-ink-900 dark:text-paper">{title}.</span> {children}
      </p>
    </div>
  );
}
