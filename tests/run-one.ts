/**
 * Test a single product file before it is registered in the catalogue:
 *   npx tsx tests/run-one.ts voice-receptionist
 */
import { checkProductShape, fuzz, runCases, type PathCase } from "./harness";
import type { Product } from "../src/lib/catalogue/types";

(async () => {
  const slug = process.argv[2];
  if (!slug) throw new Error("usage: tsx tests/run-one.ts <slug>");
  const mod = (await import(`../src/lib/catalogue/products/${slug}`)) as Record<string, unknown>;
  const product = Object.values(mod).find((v): v is Product => !!v && typeof v === "object" && "demo" in (v as object));
  if (!product) throw new Error(`no Product export in products/${slug}.ts`);
  if (product.slug !== slug || product.id !== slug) throw new Error(`id and slug must both be "${slug}"`);
  checkProductShape(product);
  const { cases } = (await import(`./${slug}.cases`)) as { cases: PathCase[] };
  if (cases.length < 3) throw new Error("need at least 3 path cases");
  runCases(product, cases);
  fuzz(product);
  console.log(`✓ ${product.name}: shape ok, ${cases.length} path cases pass, fuzz ok`);
})().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
