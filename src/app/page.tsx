import Link from "next/link";
import { products } from "@/lib/catalogue";
import { SECTORS } from "@/lib/catalogue/types";
import { Hero } from "@/components/Hero";
import { ResearchNote } from "@/components/ResearchNote";
import { SectionHeading } from "@/components/Section";
import { AgentGrid } from "@/components/AgentGrid";
import { CTASection } from "@/components/CTASection";

const FLAGSHIP = ["voice-receptionist", "website-concierge", "lead-to-sale", "quote-follow-up", "waitlist-manager"];

const SECTOR_BLURB: Record<string, string> = {
  "Home services": "Calls and quotes lost while the owner is on the tools.",
  Automotive: "Intake interruptions and unapproved or deferred repairs.",
  Appointments: "Cancelled slots and customers who don’t come back.",
  Accommodation: "Unanswered enquiries and unsold room nights.",
  "Local orders": "Incomplete custom orders and missed repeat orders.",
};

export default function HomePage() {
  const flagship = FLAGSHIP.map((s) => products.find((p) => p.slug === s)).filter((p): p is (typeof products)[number] => !!p);

  return (
    <>
      <Hero />

      <section className="container-lab -mt-4">
        <ResearchNote>
          Every demo runs on fictional sample data and shows exactly what is simulated. The paid work is connecting it to your own booking system, CRM and messaging — with your rules, approvals and tests.
        </ResearchNote>
      </section>

      {flagship.length > 0 && (
        <section className="container-lab mt-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeading
              eyebrow="Start here"
              title="Five flagship solutions"
              intro="Try each one end to end: play the customer and the owner, then see the records, exceptions and checks behind the result."
            />
            <Link href="/agents" className="btn-ghost">
              See all {products.length} solutions →
            </Link>
          </div>
          <div className="mt-8">
            <AgentGrid products={flagship} />
          </div>
        </section>
      )}

      <section className="container-lab mt-20">
        <SectionHeading
          eyebrow="By sector"
          title="Built around the problem you actually have"
          intro="Each solution starts from a measurable problem in a specific kind of small business."
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {SECTORS.map((s, i) => (
            <Link
              key={s}
              href={`/agents?sector=${encodeURIComponent(s)}`}
              className="card card-hover animate-fade-up group flex flex-col justify-between p-5"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div>
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-500 dark:text-paper/50">
                  {String(i + 1).padStart(2, "0")} · {products.filter((p) => p.sectors.includes(s)).length} solutions
                </span>
                <h3 className="mt-2 font-display text-lg font-semibold text-ink-900 dark:text-paper">{s}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600 dark:text-paper/70">{SECTOR_BLURB[s]}</p>
              </div>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-signal">
                Explore
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="container-lab mt-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading
            eyebrow="The catalogue"
            title={`${products.length} solutions, from enquiry to repeat business`}
            intro="Every card opens a product page with a real business example, an interactive demo, its own workflow schematic and a route to a sales conversation."
          />
          <Link href="/agents" className="btn-ghost">
            Filter & search →
          </Link>
        </div>
        <div className="mt-8">
          <AgentGrid products={products} />
        </div>
      </section>

      <CTASection />
    </>
  );
}
