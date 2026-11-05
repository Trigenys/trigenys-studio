// Generates src/schema.d.ts from openapi.json. `--check` fails on drift
// instead of writing, so CI proves the committed client matches the contract.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const root = resolve(import.meta.dirname, "..");
const target = join(root, "src/schema.d.ts");
const generated = astToString(await openapiTS(pathToFileURL(join(root, "openapi.json"))));

const normalise = (s: string) => s.replace(/\r\n/g, "\n");

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(target, "utf8");
  } catch {
    // Missing file counts as drift.
  }
  if (normalise(generated) !== normalise(committed)) {
    console.error('Generated client drift: run "npm run generate -w packages/contracts" and commit src/schema.d.ts');
    process.exit(1);
  }
  console.log("Generated client is up to date.");
} else {
  writeFileSync(target, generated);
  console.log(`Wrote ${target}`);
}
