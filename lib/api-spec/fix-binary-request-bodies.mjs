import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../api-client-react/src/generated/api.ts");
const checkOnly = process.argv.includes("--check");
const source = readFileSync(target, "utf8");

const blobBodyNames = [
  ...source.matchAll(/\b([A-Za-z_$][\w$]*Body): Blob\b/g),
].map((match) => match[1]);

if (!blobBodyNames.includes("uploadGroupFileBody")) {
  throw new Error("Generated uploadGroupFile Blob body was not found");
}

let output = source;
let replacementCount = 0;

for (const bodyName of new Set(blobBodyNames)) {
  const escapedName = bodyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const serializedBody = new RegExp(
    `body: JSON\\.stringify\\(\\s*${escapedName},\\s*\\)`,
    "g",
  );
  const matches = output.match(serializedBody) ?? [];

  if (checkOnly) {
    const rawBody = new RegExp(`body: ${escapedName}\\b`, "g");
    const rawMatches = output.match(rawBody) ?? [];
    if (matches.length !== 0 || rawMatches.length !== 1) {
      throw new Error(
        `Generated Blob body ${bodyName} is not in the expected raw form`,
      );
    }
    replacementCount += 1;
    continue;
  }

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one generated JSON serializer for Blob body ${bodyName}; found ${matches.length}`,
    );
  }
  output = output.replace(serializedBody, `body: ${bodyName}`);
  replacementCount += 1;
}

if (!checkOnly) {
  writeFileSync(target, output);
}

console.log(
  `${checkOnly ? "Verified" : "Fixed"} ${replacementCount} generated Blob request bodies`,
);