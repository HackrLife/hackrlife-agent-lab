"use client";

import Link from "next/link";
import { useState } from "react";
import { nav, site } from "@/lib/site";
import { ThemeToggle } from "@/components/ThemeToggle";

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-ink-600/10 bg-paper/80 backdrop-blur-md dark:border-paper/10 dark:bg-ink-900/80">
      <div className="container-lab flex h-16 items-center justify-between gap-4">
        <Link href="/" className="group flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <LabMark />
          <span className="flex flex-col leading-none">
            <span className="font-display text-[15px] font-semibold tracking-tight text-ink-900 dark:text-paper">
              {site.shortName}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-500 dark:text-paper/50">
              HackrLife
            </span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 lg:flex">
          {nav.map((item) => (
            <NavLink key={item.label} {...item} />
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <ThemeToggle />
          <Link href="/consult" className="btn-signal">
            Book a consult
          </Link>
        </div>

        {/* Mobile toggle */}
        <div className="flex items-center gap-2 lg:hidden">
          <ThemeToggle />
          <button
            className="btn-ghost px-3 py-2"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="font-mono text-xs">{open ? "CLOSE" : "MENU"}</span>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="border-t border-ink-600/10 bg-paper dark:border-paper/10 dark:bg-ink-900 lg:hidden">
          <nav className="container-lab flex flex-col py-3">
            {nav.map((item) => (
              <NavLink key={item.label} {...item} block onClick={() => setOpen(false)} />
            ))}
            <Link href="/consult" className="btn-signal mt-3" onClick={() => setOpen(false)}>
              Book a consult
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

function NavLink({
  label,
  href,
  external,
  block,
  onClick,
}: {
  label: string;
  href: string;
  external?: boolean;
  block?: boolean;
  onClick?: () => void;
}) {
  const cls = block
    ? "rounded-lg px-3 py-2.5 text-sm text-ink-700 hover:bg-ink-900/5 hover:text-ink-900 dark:text-paper/70 dark:hover:bg-paper/10 dark:hover:text-paper"
    : "rounded-lg px-3 py-2 text-sm text-ink-700 transition hover:text-ink-900 dark:text-paper/70 dark:hover:text-paper";

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} onClick={onClick}>
        {label}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} onClick={onClick}>
      {label}
    </Link>
  );
}

/** Small geometric "lab" mark — nodes + connection, hints at agent workflows. */
function LabMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <rect width="30" height="30" rx="8" className="fill-signal" />
      <circle cx="9" cy="9" r="2.4" className="fill-white" />
      <circle cx="21" cy="9" r="2.4" className="fill-white/70" />
      <circle cx="15" cy="21" r="2.4" className="fill-data" />
      <path d="M9 9 L21 9 M9 9 L15 21 M21 9 L15 21" className="stroke-white/50" strokeWidth="1.2" />
    </svg>
  );
}
