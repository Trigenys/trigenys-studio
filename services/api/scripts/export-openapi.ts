// Exports the OpenAPI 3.1 document to packages/contracts/openapi.json.
// `--check` fails when the committed contract drifts from the code.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp, openApiInfo } from "../src/app.ts";

const target = resolve(import.meta.dirname, "../../../packages/contracts/openapi.json");
const next = JSON.stringify(createApp().getOpenAPI31Document(openApiInfo), null, 2) + "\n";

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // Missing contract counts as drift.
  }
  if (current !== next) {
    console.error(`OpenAPI drift: run "npm run openapi:export -w services/api" and commit ${target}`);
    process.exit(1);
  }
  console.log("OpenAPI contract is up to date.");
} else {
  writeFileSync(target, next);
  console.log(`Wrote ${target}`);
}
