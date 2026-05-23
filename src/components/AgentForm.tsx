"use client";

import { useState } from "react";
import type { Agent, FormField } from "@/lib/agents";
import { webhookUrl } from "@/lib/webhook";
import { OutputPanel, type OutputState } from "@/components/OutputPanel";

/**
 * AgentForm — renders a Live agent's demo form and handles submission.
 *
 * Behaviour required by the spec:
 *  - POST JSON to https://n8n.hackrlife.com/webhook/{slug}
 *  - show a loading state
 *  - show an output panel
 *  - show an error message if the webhook fails
 *  - show a post-output CTA to book a consult (handled in OutputPanel)
 *
 * No data is stored anywhere by this frontend. The only network call
 * is the single POST to the configured n8n webhook on submit.
 */
export function AgentForm({ agent }: { agent: Agent }) {
  const form = agent.form;
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<OutputState>({ phase: "idle" });

  if (!form) return null;

  const setField = (name: string, value: string) =>
    setValues((v) => ({ ...v, [name]: value }));

  const validate = (): string | null => {
    for (const f of form.fields) {
      if (f.required && !values[f.name]?.trim()) {
        return `Please fill in “${f.label}”.`;
      }
      if ("maxLength" in f && f.maxLength && (values[f.name]?.length ?? 0) > f.maxLength) {
        return `“${f.label}” is over the ${f.maxLength}-character limit.`;
      }
    }
    return null;
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setState({ phase: "error", message: validationError });
      return;
    }

    setState({ phase: "loading" });

    try {
      // -------------------------------------------------------------
      // The single outbound call. All AI/API logic lives in n8n.
      // URL: {N8N_WEBHOOK_BASE}/{agent.slug}  (see src/lib/webhook.ts)
      // -------------------------------------------------------------
      const res = await fetch(webhookUrl(agent.slug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: agent.slug,
          submitted_at: new Date().toISOString(),
          ...values,
        }),
      });

      if (!res.ok) {
        throw new Error(`The workflow responded with status ${res.status}.`);
      }

      const text = await normaliseResponse(res);
      setState({ phase: "success", text });
    } catch (err) {
      setState({
        phase: "error",
        message:
          err instanceof Error
            ? err.message
            : "Something went wrong reaching the demo workflow.",
      });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={handleSubmit} className="card p-6">
        <div className="space-y-4">
          {form.fields.map((field) => (
            <Field
              key={field.name}
              field={field}
              value={values[field.name] ?? ""}
              onChange={(val) => setField(field.name, val)}
            />
          ))}
        </div>

        <button
          type="submit"
          disabled={state.phase === "loading"}
          className="btn-primary mt-6 w-full disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.phase === "loading" ? "Running…" : form.submitLabel}
        </button>

        <p className="mt-3 text-center text-xs text-ink-500 dark:text-paper/50">
          This is a limited demo. Nothing is published, scheduled, or stored.
        </p>
      </form>

      <OutputPanel state={state} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Field renderer                                                     */
/* ------------------------------------------------------------------ */

function Field({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: string;
  onChange: (v: string) => void;
}) {
  const counter =
    "maxLength" in field && field.maxLength ? (
      <span className="float-right font-mono text-[11px] text-ink-500 dark:text-paper/50">
        {value.length}/{field.maxLength}
      </span>
    ) : null;

  return (
    <div>
      <label htmlFor={field.name} className="label">
        {field.label}
        {field.required && <span className="text-ember"> *</span>}
        {counter}
      </label>

      {field.kind === "input" && (
        <input
          id={field.name}
          type="text"
          className="field"
          placeholder={field.placeholder}
          value={value}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.kind === "textarea" && (
        <textarea
          id={field.name}
          className="field scroll-thin resize-y"
          placeholder={field.placeholder}
          rows={field.rows ?? 5}
          value={value}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.kind === "select" && (
        <select
          id={field.name}
          className="field"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>
            Choose…
          </option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {field.helper && <p className="mt-1 text-xs text-ink-500 dark:text-paper/50">{field.helper}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Response normalisation                                             */
/* ------------------------------------------------------------------ */

/**
 * n8n can return JSON or plain text. We try to surface the most useful
 * human-readable representation regardless of the exact shape.
 */
async function normaliseResponse(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const data = await res.json();
    return normaliseJson(data);
  }

  const text = await res.text();
  return text.trim() || "The workflow completed but returned no content.";
}

function normaliseJson(data: unknown): string {
  if (typeof data === "string") return data;

  if (Array.isArray(data)) {
    return data.map((item) => normaliseJson(item)).join("\n\n");
  }

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // Common single-field result shapes from n8n flows.
    for (const key of ["output", "result", "text", "message", "content", "response", "data"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
      if (obj[key] && typeof obj[key] === "object") return normaliseJson(obj[key]);
    }
    // Fallback: pretty-print the JSON.
    return JSON.stringify(obj, null, 2);
  }

  return String(data);
}
