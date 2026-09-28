import type { Metadata } from "next";
import { OUTCOMES, SECTORS, type Outcome, type Sector } from "@/lib/catalogue/types";
import { AgentGallery } from "@/components/AgentGallery";
import { Eyebrow } from "@/components/Section";

export const metadata: Metadata = {
  title: "Solutions",
  description:
    "Twenty practical automations for small businesses: answer enquiries, book customers, follow up quotes, fill cancelled slots and grow repeat business. Try each one with sample data.",
};

function pick<T extends string>(list: readonly T[], value?: string | string[]): T | "All" {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "All";
  return list.find((c) => c.toLowerCase() === raw.toLowerCase()) ?? "All";
}

export default function AgentsPage({
  searchParams,
}: {
  searchParams: { sector?: string | string[]; outcome?: string | string[]; retired?: string };
}) {
  return (
    <div className="container-lab py-16 sm:py-20">
      {searchParams.retired && (
        <div className="mb-8 rounded-xl border border-signal/40 bg-signal/10 p-4 text-sm text-ink-800 dark:text-paper/85">
          The page you followed was one of the earlier prompt experiments, which have been retired. The catalogue below replaces them with business solutions you can try end to end.
        </div>
      )}
      <Eyebrow>The catalogue</Eyebrow>
      <h1 className="max-w-3xl font-display text-4xl font-semibold text-ink-900 dark:text-paper sm:text-5xl">
        Automations that answer enquiries, book customers and keep business moving
      </h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-600 dark:text-paper/70">
        Explore practical solutions for small businesses. Try a sample workflow, see what happens behind the scenes and book a conversation about connecting it to your own business.
      </p>

      <div className="mt-10">
        <AgentGallery initialSector={pick<Sector>(SECTORS, searchParams.sector)} initialOutcome={pick<Outcome>(OUTCOMES, searchParams.outcome)} />
      </div>
    </div>
  );
}
