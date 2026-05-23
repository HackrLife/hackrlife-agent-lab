/**
 * src/lib/webhook.ts
 * ------------------------------------------------------------------
 * Configuration for the n8n backend.
 *
 *  >>> THIS IS WHERE WEBHOOK URLS ARE CONFIGURED. <<<
 *
 * Every Live agent posts its demo form as JSON to:
 *     {N8N_WEBHOOK_BASE}/{agent-slug}
 *
 * e.g. the Voice-Match Tweet Agent (slug: "voice-match-tweet-agent")
 * posts to:
 *     https://n8n.hackrlife.com/webhook/voice-match-tweet-agent
 *
 * The n8n instance is PRIVATE. It is never linked in the public UI.
 * All AI / API logic lives inside n8n — never in this frontend.
 *
 * To point demos at a different n8n instance without editing code,
 * set the environment variable NEXT_PUBLIC_N8N_WEBHOOK_BASE in Vercel
 * (Project → Settings → Environment Variables). The fallback below is
 * used when that variable is absent.
 * ------------------------------------------------------------------
 */

export const N8N_WEBHOOK_BASE =
  process.env.NEXT_PUBLIC_N8N_WEBHOOK_BASE?.replace(/\/$/, "") ||
  "https://n8n.hackrlife.com/webhook";

/** Build the full webhook URL for a given agent slug. */
export function webhookUrl(slug: string): string {
  return `${N8N_WEBHOOK_BASE}/${slug}`;
}
