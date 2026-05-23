import type { Metadata } from "next";
import { agents, categories, liveAgents } from "@/lib/agents";
import type { Category } from "@/lib/agents";
import { AgentGallery } from "@/components/AgentGallery";
import { Eyebrow } from "@/components/Section";
import type { CategoryValue } from "@/components/CategoryFilter";

export const metadata: Metadata = {
  title: "Agents",
  description:
    "Browse all 30 AI agent demos across marketing, content, research, operations, and small-business use cases. Filter, search, and test the live demos.",
};

function resolveInitialCategory(value?: string | string[]): CategoryValue {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "All";
  const match = categories.find((c) => c.toLowerCase() === raw.toLowerCase());
  return (match as Category) ?? "All";
}

export default function AgentsPage({
  searchParams,
}: {
  searchParams: { category?: string | string[] };
}) {
  const initialCategory = resolveInitialCategory(searchParams.category);

  return (
    <div className="container-lab py-16 sm:py-20">
      <Eyebrow>The gallery</Eyebrow>
      <h1 className="max-w-3xl font-display text-4xl font-semibold text-ink-900 dark:text-paper sm:text-5xl">
        Explore the agent lab
      </h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-600 dark:text-paper/70">
        Thirty research-backed workflow experiments. {liveAgents.length} are live demos you can test
        right now; the rest are use-case previews. Filter by category or search to find the workflow
        closest to your own.
      </p>

      <div className="mt-10">
        <AgentGallery agents={agents} initialCategory={initialCategory} />
      </div>
    </div>
  );
}
