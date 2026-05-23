/**
 * src/lib/site.ts
 * ------------------------------------------------------------------
 * Site-wide constants: brand, navigation, and external links.
 *
 * NOTE: The n8n backend is intentionally NOT listed here. It is
 * private and must never be linked publicly.
 * ------------------------------------------------------------------
 */

export const site = {
  name: "HackrLife Agent Lab",
  shortName: "Agent Lab",
  builtBy: "Dev Das",
  tagline: "Research-backed AI workflow demos",
  description:
    "Practical AI agent demos for creators, freelancers, marketers, and small businesses. Test the use case. Understand the workflow. Book a consult to adapt it to your own stack.",
  // Used for SEO metadata. Update if you deploy under a different domain.
  url: "https://agents.hackrlife.com",
  consultEmail: "dev@hackrlife.com",
};

export const links = {
  newsletter: "https://hackrlife.com",
  cv: "https://www.dev-das.com",
  // Footer + Resources GitHub link. Swap to your own org/user if needed.
  github: "https://github.com/HackrLife",
};

/** Primary navigation, in order. */
export const nav: { label: string; href: string; external?: boolean }[] = [
  { label: "Agent Lab", href: "/" },
  { label: "Agents", href: "/agents" },
  { label: "Research", href: "/research" },
  { label: "About", href: "/about" },
  { label: "Consult", href: "/consult" },
  { label: "Newsletter", href: links.newsletter, external: true },
  { label: "CV", href: links.cv, external: true },
  { label: "GitHub", href: links.github, external: true },
];

/** Build a mailto: link for the consult intake. */
export function consultMailto(subject?: string, body?: string): string {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const qs = params.toString();
  return `mailto:${site.consultEmail}${qs ? `?${qs}` : ""}`;
}
