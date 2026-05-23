import Link from "next/link";
import { links, site, nav } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-signal bg-ink-900 text-paper">
      <div className="container-lab grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-display text-xl font-semibold">{site.name}</p>
          <p className="mt-2 max-w-xs text-sm text-paper/60">
            Built by {site.builtBy}. {site.tagline}.
          </p>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-brand-light/90">
            Test the use case · Book a consult
          </p>
        </div>

        <div>
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-paper/40">
            Explore
          </p>
          <ul className="space-y-2 text-sm">
            <li><Link href="/agents" className="text-paper/75 hover:text-paper">Agents</Link></li>
            <li><Link href="/research" className="text-paper/75 hover:text-paper">Research</Link></li>
            <li><Link href="/about" className="text-paper/75 hover:text-paper">About</Link></li>
            <li><Link href="/resources" className="text-paper/75 hover:text-paper">Resources</Link></li>
            <li><Link href="/consult" className="text-brand-light hover:text-paper">Book a consult</Link></li>
          </ul>
        </div>

        <div>
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-paper/40">
            Links
          </p>
          <ul className="space-y-2 text-sm">
            <li>
              <a href={links.newsletter} target="_blank" rel="noopener noreferrer" className="text-paper/75 hover:text-paper">
                Newsletter — hackrlife.com
              </a>
            </li>
            <li>
              <a href={links.cv} target="_blank" rel="noopener noreferrer" className="text-paper/75 hover:text-paper">
                CV — dev-das.com
              </a>
            </li>
            <li>
              <a href={links.github} target="_blank" rel="noopener noreferrer" className="text-paper/75 hover:text-paper">
                GitHub
              </a>
            </li>
          </ul>
        </div>
      </div>

      {/* Bottom navigation — mirrors the top nav */}
      <nav aria-label="Footer" className="border-t border-paper/10">
        <div className="container-lab flex flex-wrap gap-x-7 gap-y-3 py-5 text-sm">
          {nav.map((item) =>
            item.external ? (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-paper/70 transition hover:text-paper"
              >
                {item.label}
              </a>
            ) : (
              <Link key={item.label} href={item.href} className="text-paper/70 transition hover:text-paper">
                {item.label}
              </Link>
            )
          )}
        </div>
      </nav>

      <div className="border-t border-paper/10">
        <div className="container-lab flex flex-col gap-2 py-5 text-xs text-paper/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {site.name}. Research-backed AI workflow demos.</p>
          <p className="font-mono">Demos run on a private n8n backend. Nothing publishes automatically.</p>
        </div>
      </div>
    </footer>
  );
}
