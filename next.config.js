/** @type {import('next').NextConfig} */

// Retired prompt experiments → a clear archive notice on the catalogue.
// They are not silently mapped to unrelated products.
const RETIRED = [
  "landing-page-critic", "campaign-angle-generator", "cold-email-pack-agent", "competitor-positioning-agent",
  "ad-copy-generator", "launch-plan-agent", "daily-x-content-agent", "voice-match-tweet-agent",
  "newsletter-draft-agent", "linkedin-post-agent", "blog-repurposer-agent", "youtube-script-agent",
  "research-summary-agent", "ai-paper-to-content-agent", "literature-review-helper", "argument-mapper",
  "model-variance-tester", "source-to-insight-agent", "meeting-notes-to-action-agent", "weekly-planning-agent",
  "decision-memo-agent", "sop-builder-agent", "workflow-audit-agent", "custom-agent-recommender",
  "founder-bio-agent", "personal-brand-positioning-agent", "lead-magnet-idea-agent", "course-outline-agent",
  "podcast-prep-agent", "consulting-offer-builder",
];

const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      ...RETIRED.map((slug) => ({ source: `/agents/${slug}`, destination: "/agents?retired=1", permanent: true })),
      // The lead qualifier demo has a genuine successor.
      { source: "/lead-qualifier", destination: "/agents/lead-to-sale", permanent: true },
      { source: "/consult", destination: "/book", permanent: true },
    ];
  },
};

module.exports = nextConfig;
