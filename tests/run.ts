import { products } from "../src/lib/catalogue";
import { checkProductShape, fuzz, runCases, type PathCase } from "./harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const only = process.argv[2];
let failures = 0;
const caseFiles = new Set(readdirSync(join(__dirname)).filter((f) => f.endsWith(".cases.ts")).map((f) => f.replace(".cases.ts", "")));

(async () => {
  for (const p of products) {
    if (only && p.id !== only) continue;
    try {
      checkProductShape(p);
      if (!caseFiles.has(p.id)) throw new Error(`no tests/${p.id}.cases.ts`);
      const { cases } = (await import(`./${p.id}.cases`)) as { cases: PathCase[] };
      if (cases.length < 3) throw new Error("need at least 3 path cases");
      runCases(p, cases);
      fuzz(p);
      console.log(`✓ ${String(p.no).padStart(2, "0")} ${p.name} — ${cases.length} cases + fuzz`);
    } catch (e: any) {
      failures++;
      console.log(`✗ ${String(p.no).padStart(2, "0")} ${p.name}\n    ${e.message.split("\n").join("\n    ")}`);
    }
  }
  console.log(failures ? `\n${failures} product(s) failing` : `\nAll products pass`);
  process.exit(failures ? 1 : 0);
})();
