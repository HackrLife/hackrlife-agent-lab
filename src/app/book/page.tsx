import type { Metadata } from "next";
import { BookingForm } from "@/components/BookingForm";
import { Eyebrow } from "@/components/Section";
import { products } from "@/lib/catalogue";

export const metadata: Metadata = {
  title: "Book a demo for my business",
  description: "Book a conversation about connecting one of the HackrLife solutions to your own business systems.",
};

export default function BookPage({ searchParams }: { searchParams: { product?: string; scenario?: string } }) {
  const product = products.find((p) => p.slug === searchParams.product);
  const scenario = product?.demo.scenarios.find((s) => s.id === searchParams.scenario);

  return (
    <div className="container-lab py-16 sm:py-20">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.25fr]">
        <div>
          <Eyebrow>Book a demo</Eyebrow>
          <h1 className="font-display text-4xl font-semibold text-ink-900 dark:text-paper sm:text-5xl">
            {product ? `Book a demo of ${product.name} for your business` : "Book a demo for my business"}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-ink-600 dark:text-paper/70">
            {product
              ? `${product.ctaLine} Tell us a little about your business and we’ll use the call to map your current process and whether ${product.name} fits it.`
              : "Tell us a little about your business and the problem you want solved. The call is a discovery conversation, not a sales script."}
          </p>

          <div className="mt-8 space-y-4 text-sm text-ink-700 dark:text-paper/75">
            <Point title="Discovery first">We look at enquiry volume, what a completed job is worth, spare capacity and the systems you already use.</Point>
            <Point title="Scoped before priced">The proposal defines integrations, approvals, exceptions and acceptance tests. Pricing follows scope.</Point>
            <Point title="Your data stays yours">Only what you type here is sent. Your demo conversation is not included.</Point>
          </div>
        </div>

        <BookingForm
          initialProduct={product?.slug ?? ""}
          scenarioId={scenario?.id ?? ""}
          scenarioLabel={scenario ? `${scenario.label} (${scenario.kind})` : ""}
        />
      </div>
    </div>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-signal text-[11px] text-white">✓</span>
      <p>
        <span className="font-semibold text-ink-900 dark:text-paper">{title}.</span> {children}
      </p>
    </div>
  );
}
