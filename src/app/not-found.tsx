import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-lab flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="font-mono text-sm uppercase tracking-[0.3em] text-ink-500 dark:text-paper/50">404</p>
      <h1 className="mt-4 font-display text-4xl font-semibold text-ink-900 dark:text-paper sm:text-5xl">
        That page isn’t in the lab.
      </h1>
      <p className="mt-3 max-w-md text-ink-600 dark:text-paper/70">
        The agent or page you’re looking for doesn’t exist. Head back to the gallery to explore the
        thirty agents.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/agents" className="btn-primary">Explore agents</Link>
        <Link href="/" className="btn-ghost">Back home</Link>
      </div>
    </div>
  );
}
