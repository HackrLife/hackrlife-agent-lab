"use client";

import { useState } from "react";
import { consultMailto, site } from "@/lib/site";

/**
 * ConsultForm — a simple intake form.
 *
 * Per the spec, the consult flow is email-based for now: on submit we
 * compose a pre-filled mailto: to dev@hackrlife.com, which opens the
 * user's mail client (Gmail, Outlook, Apple Mail, etc.).
 *
 * No data is stored or sent anywhere by this frontend. The form only
 * builds a mailto link from what the user typed.
 */

const contactMethods = ["Email", "Video call", "Either is fine"];

export function ConsultForm() {
  const [v, setV] = useState({
    name: "",
    email: "",
    business_type: "",
    role: "",
    workflow: "",
    tools: "",
    goal: "",
    contact: contactMethods[0],
  });
  const [opened, setOpened] = useState(false);

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  function buildBody() {
    return [
      `Name: ${v.name}`,
      `Email: ${v.email}`,
      `Business type: ${v.business_type}`,
      `Role: ${v.role}`,
      `Preferred contact method: ${v.contact}`,
      "",
      "Workflow I want to improve:",
      v.workflow,
      "",
      "Tools I currently use:",
      v.tools,
      "",
      "What I want the agent to do:",
      v.goal,
    ].join("\n");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const subject = `Consult request — ${v.name || "Agent Lab"}`;
    window.location.href = consultMailto(subject, buildBody());
    setOpened(true);
  }

  return (
    <form onSubmit={handleSubmit} className="card p-6 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="label">Name</label>
          <input id="name" className="field" value={v.name} onChange={set("name")} required />
        </div>
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" className="field" value={v.email} onChange={set("email")} required />
        </div>
        <div>
          <label htmlFor="business_type" className="label">Business type</label>
          <input id="business_type" className="field" placeholder="e.g. agency, SaaS, solo consultancy" value={v.business_type} onChange={set("business_type")} />
        </div>
        <div>
          <label htmlFor="role" className="label">Your role</label>
          <input id="role" className="field" placeholder="e.g. founder, marketer, freelancer" value={v.role} onChange={set("role")} />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="workflow" className="label">Workflow you want to improve</label>
        <textarea id="workflow" className="field scroll-thin" rows={3} placeholder="What part of your work feels repetitive or slow?" value={v.workflow} onChange={set("workflow")} required />
      </div>

      <div className="mt-4">
        <label htmlFor="tools" className="label">Tools you currently use</label>
        <input id="tools" className="field" placeholder="e.g. Notion, Gmail, Slack, Sheets, HubSpot" value={v.tools} onChange={set("tools")} />
      </div>

      <div className="mt-4">
        <label htmlFor="goal" className="label">What you want the agent to do</label>
        <textarea id="goal" className="field scroll-thin" rows={3} placeholder="Describe the outcome you'd like an agent to help with." value={v.goal} onChange={set("goal")} required />
      </div>

      <div className="mt-4">
        <label htmlFor="contact" className="label">Preferred contact method</label>
        <select id="contact" className="field" value={v.contact} onChange={set("contact")}>
          {contactMethods.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <button type="submit" className="btn-primary mt-6 w-full">
        Book a consult
      </button>

      <p className="mt-3 text-center text-xs text-ink-500 dark:text-paper/50">
        This opens your email app with a pre-filled message to {site.consultEmail}. Nothing is
        stored or sent until you hit send in your mail client.
      </p>

      {opened && (
        <div className="mt-4 rounded-xl border border-signal/40 bg-signal/10 p-4 text-sm text-ink-800 dark:text-paper/90">
          Your email app should have opened with the details filled in. If it didn’t, email{" "}
          <a href={consultMailto(`Consult request — ${v.name || "Agent Lab"}`, buildBody())} className="font-medium underline">
            {site.consultEmail}
          </a>{" "}
          directly.
        </div>
      )}
    </form>
  );
}
