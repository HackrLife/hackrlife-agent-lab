import type { Product } from "./types";
import { leadToSale } from "./products/lead-to-sale";

/** Canonical catalogue order (brief, “The twenty product cards”). */
export const products: Product[] = [leadToSale].sort((a, b) => a.no - b.no);

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export * from "./types";
