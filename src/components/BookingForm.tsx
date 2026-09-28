"use client";

import { useEffect, useRef, useState } from "react";
import { products } from "@/lib/catalogue";
import { consultMailto, site } from "@/lib/site";
import { webhookUrl } from "@/lib/webhook";

/**
 * BookingForm — product-aware sales request.
 *
 * Sends a sales request (with a stable request_id so retries don't
 * duplicate) to the private n8n webhook `book-demo`. A call is shown as
 * confirmed ONLY if the scheduler responds with booking_status "confirmed".
 * Otherwise the enquiry is kept and the visitor is told it is not yet a
 * booked appointment; if the service is unreachable, an email fallback
 * is offered with everything they typed.
 */

const BUSINESS_TYPES = ["Home services / trade", "Automotive / garage", "Salon, groomer or appointments", "Accommodation", "Florist, bakery or caterer", "Other", "Not sure"];
const VOLUMES = ["Under 10 a week", "10–30 a week", "30–100 a week", "Over 100 a week", "Not sure"];
const TIMES = ["Weekday morning", "Weekday midday", "Weekday afternoon", "Any time"];

type Phase = "form" | "sending" | "received" | "confirmed" | "failed";

export function BookingForm({ initialProduct, scenarioId, scenarioLabel }: { initialProduct: string; scenarioId: string; scenarioLabel: string }) {
  const requestId = useRef<string>("");
  const [tz, setTz] = useState("your local time");
  const [phase, setPhase] = useState<Phase>("form");
  const [confirmedTime, setConfirmedTime] = useState("");
  const [v, setV] = useState({
    product: initialProduct,
    name: "",
    contact: "",
    business_type: BUSINESS_TYPES[0],
    website: "",
    problem: "",
    volume: VOLUMES[4],
    current_system: "",
    preferred_time: TIMES[3],
    marketing_interest: false,
    contact_permission: false,
  });

  useEffect(() => {
    requestId.current = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {}
  }, []);

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  const productName = products.find((p) => p.slug === v.product)?.name ?? "Not sure yet";

  function body() {
    return [
      `Request ID: ${requestId.current}`,
      `Product interest: ${productName}`,
      scenarioLabel ? `Demo scenario tried: ${scenarioLabel}` : "",
      `Name: ${v.name}`,
      `Contact: ${v.contact}`,
      `Business type: ${v.business_type}`,
      `Website: ${v.website || "—"}`,
      `Enquiry/order volume: ${v.volume}`,
      `Current system: ${v.current_system || "Not sure"}`,
      `Preferred call time: ${v.preferred_time} (${tz})`,
      `Interested in ongoing marketing: ${v.marketing_interest ? "Yes" : "No"}`,
      "",
      "Main problem:",
      v.problem,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phase === "sending") return;
    setPhase("sending");
    try {
      const res = await fetch(webhookUrl("book-demo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId.current,
          product_id: v.product || null,
          scenario_id: scenarioId || null,
          business_details: { name: v.name, contact: v.contact, business_type: v.business_type, website: v.website, volume: v.volume, current_system: v.current_system || "Not sure" },
          problem: v.problem,
          preferred_time: `${v.preferred_time} (${tz})`,
          marketing_interest: v.marketing_interest,
          contact_permission: v.contact_permission,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      let data: { booking_status?: string; time?: string } = {};
      try {
        data = await res.json();
      } catch {}
      if (data.booking_status === "confirmed" && data.time) {
        setConfirmedTime(data.time);
        setPhase("confirmed");
      } else {
        setPhase("received");
      }
    } catch {
      setPhase("failed");
    }
  }

  if (phase === "received" || phase === "confirmed") {
    return (
      <div className="card p-6 sm:p-8" role="status">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-paper/50">Reference {requestId.current}</p>
        <h2 className="mt-2 font-display text-2xl font-semibold text-ink-900 dark:text-paper">
          {phase === "confirmed" ? `Call booked: ${confirmedTime}` : "Request received — not yet a booked call"}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-700 dark:text-paper/75">
          {phase === "confirmed"
            ? "A calendar confirmation is on its way to the contact you gave."
            : `Your enquiry about ${productName} is saved. We’ll reply to ${v.contact} with available times (${v.preferred_time.toLowerCase()}, ${tz}). Your appointment is only booked once you receive that confirmation.`}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card p-6 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="product" className="label">Solution</label>
          <select id="product" className="field" value={v.product} onChange={set("product")}>
            <option value="">Not sure yet</option>
            {products.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name} — {p.outcome}</option>
            ))}
          </select>
          {scenarioLabel && <p className="mt-1 text-xs text-ink-500 dark:text-paper/50">You tried the “{scenarioLabel}” scenario. Only the scenario name is included, not the conversation.</p>}
        </div>
        <div>
          <label htmlFor="name" className="label">Name</label>
          <input id="name" className="field" value={v.name} onChange={set("name")} required />
        </div>
        <div>
          <label htmlFor="contact" className="label">Business email or preferred contact</label>
          <input id="contact" className="field" value={v.contact} onChange={set("contact")} required />
        </div>
        <div>
          <label htmlFor="business_type" className="label">Business type</label>
          <select id="business_type" className="field" value={v.business_type} onChange={set("business_type")}>
            {BUSINESS_TYPES.map((b) => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="website" className="label">Website (if you have one)</label>
          <input id="website" className="field" value={v.website} onChange={set("website")} placeholder="https://" />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="problem" className="label">Main problem you want solved</label>
        <textarea id="problem" rows={3} className="field scroll-thin" value={v.problem} onChange={set("problem")} required placeholder="e.g. we miss calls while on jobs and quotes go quiet" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="volume" className="label">Approximate enquiries or orders</label>
          <select id="volume" className="field" value={v.volume} onChange={set("volume")}>
            {VOLUMES.map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="current_system" className="label">Current booking or job system</label>
          <input id="current_system" className="field" value={v.current_system} onChange={set("current_system")} placeholder="e.g. Jobber, Fresha, Cloudbeds — or “not sure”" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="preferred_time" className="label">Preferred call time <span className="font-normal text-ink-500 dark:text-paper/50">({tz})</span></label>
          <select id="preferred_time" className="field" value={v.preferred_time} onChange={set("preferred_time")}>
            {TIMES.map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-5 space-y-2.5 text-sm text-ink-700 dark:text-paper/75">
        <label className="flex cursor-pointer items-start gap-2">
          <input type="checkbox" checked={v.contact_permission} onChange={set("contact_permission")} required className="mt-0.5 h-4 w-4 rounded border-ink-600/30 text-signal focus:ring-signal" />
          You can contact me about this request.
        </label>
        <label className="flex cursor-pointer items-start gap-2">
          <input type="checkbox" checked={v.marketing_interest} onChange={set("marketing_interest")} className="mt-0.5 h-4 w-4 rounded border-ink-600/30 text-signal focus:ring-signal" />
          I’m also interested in ongoing marketing support (optional, asked separately).
        </label>
      </div>

      <button type="submit" disabled={phase === "sending"} className="btn-primary mt-6 w-full disabled:opacity-60">
        {phase === "sending" ? "Sending…" : "Book a demo for my business"}
      </button>

      {phase === "failed" && (
        <div className="mt-4 rounded-xl border border-signal/40 bg-signal/10 p-4 text-sm text-ink-800 dark:text-paper/90" role="alert">
          Your call is <strong>not booked yet</strong> — the booking service didn’t respond. Your details are still in the form. You can try again, or{" "}
          <a className="font-medium underline" href={consultMailto(`Demo request — ${productName}`, body())}>send them by email to {site.consultEmail}</a>{" "}
          and we’ll call you back.
        </div>
      )}
    </form>
  );
}
