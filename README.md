# HackrLife Agent Lab

A public demo gallery for practical AI agents — built with **Next.js 14 (App Router)**, **TypeScript**, and **Tailwind CSS**, and deployable to **Vercel** in minutes.

The site showcases 30 AI-agent use cases. Five are **live, interactive demos**: a visitor fills in a short form, the frontend POSTs JSON to a private [n8n](https://n8n.io) backend, and the workflow's response is rendered inline. The other 25 are **previews** — they explain the use case, who it's for, and the underlying workflow, with a consult call-to-action.

> **Important:** This frontend contains **no AI logic, no API keys, no database, and no auth.** All intelligence lives in the private n8n instance. The n8n URLs are never linked anywhere in the public UI.

---

## Quick start

```bash
# 1. Install dependencies (Node 18.17+ recommended)
npm install

# 2. Run the dev server
npm run dev
# → http://localhost:3000

# 3. Production build / preview
npm run build
npm run start
```

Other scripts: `npm run lint` (ESLint) and `npm run typecheck` (`tsc --noEmit`).

---

## Deploying to Vercel

1. Push this repo to GitHub (see below).
2. In Vercel, **Add New → Project** and import the repo.
3. Framework preset auto-detects as **Next.js** — no build settings to change.
4. (Optional) Add the environment variable `NEXT_PUBLIC_N8N_WEBHOOK_BASE` (see [Configuration](#configuration)).
5. **Deploy.**

### Pushing to GitHub

```bash
git init
git add .
git commit -m "HackrLife Agent Lab"
git branch -M main
git remote add origin https://github.com/HackrLife/agent-lab.git   # adjust to your repo
git push -u origin main
```

---

## Configuration

### Webhook base URL

Live demos POST to `{N8N_WEBHOOK_BASE}/{agent-slug}`. The base is defined in **`src/lib/webhook.ts`**:

```ts
export const N8N_WEBHOOK_BASE =
  process.env.NEXT_PUBLIC_N8N_WEBHOOK_BASE?.replace(/\/$/, "") ||
  "https://n8n.hackrlife.com/webhook";
```

- To point the demos at a **different n8n instance without editing code**, set
  `NEXT_PUBLIC_N8N_WEBHOOK_BASE` in Vercel → *Project → Settings → Environment Variables*
  (e.g. `https://n8n.example.com/webhook`). Trailing slashes are stripped automatically.
- If the variable is unset, the fallback above is used.

> Because the variable is prefixed `NEXT_PUBLIC_`, it is exposed to the browser **by design** — the demo POST happens client-side. Only put the *webhook base* here. Never put secrets, API keys, or admin URLs in a `NEXT_PUBLIC_` variable.

### Site constants

Brand name, consult email, canonical URL, and external links (newsletter, CV, GitHub) live in **`src/lib/site.ts`**. Update the `url` field if you deploy under a different domain so SEO metadata stays correct.

---

## Project structure

```
src/
├── app/                      # App Router pages & routes
│   ├── layout.tsx            # Fonts, SEO metadata, header/footer
│   ├── page.tsx              # Home: hero, live demos, gallery
│   ├── agents/
│   │   ├── page.tsx          # Full gallery (search + category filter)
│   │   └── [slug]/page.tsx   # Per-agent detail (demo or preview)
│   ├── about|research|consult|resources/page.tsx
│   ├── not-found.tsx         # Custom 404
│   ├── robots.ts             # robots.txt
│   └── sitemap.ts            # sitemap.xml
├── components/               # 18 presentational + interactive components
├── lib/
│   ├── agents.ts             # ← SINGLE SOURCE OF TRUTH for all 30 agents
│   ├── webhook.ts            # ← Webhook base + URL builder
│   └── site.ts               # Brand, nav, external links
└── styles/globals.css        # Tailwind layers + component classes
```

---

## How the live demos work

1. A live agent (defined in `src/lib/agents.ts` with `status: "live"` and a `form`) renders an `AgentForm`.
2. On submit, the form POSTs its fields as JSON to `webhookUrl(slug)`.
3. The n8n workflow processes the request and returns JSON. `AgentForm` normalises common n8n response shapes (`{ output }`, `{ data }`, arrays, raw strings) and displays the result in `OutputPanel`.
4. **Nothing publishes, schedules, or stores automatically.** The output is shown to the visitor only — keeping a human in the loop.

The five live agents are: `landing-page-critic`, `campaign-angle-generator`, `voice-match-tweet-agent`, `newsletter-draft-agent`, and `custom-agent-recommender`. Each must have a corresponding workflow in n8n listening at `/{slug}`.

---

## Adding or editing an agent

Everything is data-driven from **`src/lib/agents.ts`** — you usually don't touch any component.

1. Add a new object to the `agents` array. Required fields: `slug` (unique, URL-safe), `name`, `category`, `status`, `short`, `valueEstimate`, `tagline`, `helpsWith[]`, `whoFor[]`, `limitations[]`, `fullDeployment[]`, and a 5-step `workflow[]`.
2. **For a preview agent:** set `status: "preview"`. Done — it appears in the gallery with a "Preview Use Case" CTA.
3. **For a live agent:** set `status: "live"` and add a `form` object describing the fields (`input`, `textarea`, or `select`). Then create the matching n8n workflow at `https://<your-n8n>/webhook/<slug>`.
4. The agent automatically appears on the home page, in the gallery, in its category filter, in `generateStaticParams`, and in the sitemap. No other edits needed.

`category` must be one of the values in the `categories` array (Marketing, Content, Research, Operations, Creator, Freelancer, Small Business).

---

## Tech notes

- **Dark & light mode.** The site defaults to **dark**, with a sun/moon toggle in the header (`src/components/ThemeToggle.tsx`). It uses Tailwind's class-based dark mode (`darkMode: "class"`); a tiny inline script in `layout.tsx` applies the saved choice before first paint to avoid a flash. The brand accent is **blaugrana claret** (`#a50044`), defined once in `tailwind.config.ts` as both `signal` (the existing accent name) and `brand` (with a `brand-light` `#ff5c93` for legible accents on dark surfaces).
- **Next.js 14 App Router**, fully static-friendly: agent detail pages use `generateStaticParams` + `generateMetadata`.
- **Tailwind** theme tokens (colors, fonts, animations, shadows) are in `tailwind.config.ts`; reusable component classes (`.btn`, `.card`, `.field`, etc.) are in `src/styles/globals.css`.
- **No client secrets.** The only browser-exposed config is the public webhook base.
- TypeScript runs in `strict` mode.

---

Built by **Dev Das** · [hackrlife.com](https://hackrlife.com) · consult: `dev@hackrlife.com`
