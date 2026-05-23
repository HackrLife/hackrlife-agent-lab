import type { BandTone, Channel } from "@/lib/leadQualifierData";

/** Tailwind classes for band chips/bars, keyed by tone. */
export const bandClasses: Record<BandTone, { chip: string; bar: string }> = {
  emerald: {
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    bar: "bg-emerald-500",
  },
  sky: {
    chip: "bg-sky-50 text-sky-700 ring-sky-600/20",
    bar: "bg-sky-500",
  },
  amber: {
    chip: "bg-amber-50 text-amber-700 ring-amber-600/20",
    bar: "bg-amber-500",
  },
  slate: {
    chip: "bg-slate-100 text-slate-600 ring-slate-500/20",
    bar: "bg-slate-400",
  },
};

/** Channel chip + icon dot classes for the cadence timeline. */
export const channelClasses: Record<
  Channel,
  { chip: string; dot: string; text: string }
> = {
  email: { chip: "bg-sky-50", dot: "bg-sky-100 text-sky-700", text: "text-sky-700" },
  call: {
    chip: "bg-emerald-50",
    dot: "bg-emerald-100 text-emerald-700",
    text: "text-emerald-700",
  },
  sms: {
    chip: "bg-amber-50",
    dot: "bg-amber-100 text-amber-700",
    text: "text-amber-700",
  },
  dm: { chip: "bg-pink-50", dot: "bg-pink-100 text-pink-700", text: "text-pink-700" },
};

/** Weight chip styling: positive (green), zero (slate), negative (amber). */
export function weightClasses(weight: number): string {
  if (weight > 0) return "bg-emerald-50 text-emerald-700";
  if (weight < 0) return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export function formatWeight(weight: number): string {
  return `${weight > 0 ? "+" : ""}${weight}`;
}
