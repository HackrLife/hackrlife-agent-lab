import type { MetadataRoute } from "next";
import { agents } from "@/lib/agents";
import { site } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = site.url.replace(/\/$/, "");
  const staticRoutes = ["", "/agents", "/research", "/about", "/consult", "/resources"].map(
    (path) => ({
      url: `${base}${path}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: path === "" ? 1 : 0.7,
    }),
  );

  const agentRoutes = agents.map((a) => ({
    url: `${base}/agents/${a.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: a.status === "live" ? 0.8 : 0.5,
  }));

  return [...staticRoutes, ...agentRoutes];
}
