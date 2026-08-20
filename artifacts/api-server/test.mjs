import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(artifactDir, ".test-dist");
const testEntry = path.join(artifactDir, "src/tests/business-regressions.test.ts");
const output = path.join(outDir, "business-regressions.test.mjs");

await rm(outDir, { recursive: true, force: true });
await build({
  entryPoints: [testEntry],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: output,
  sourcemap: "inline",
  logLevel: "warning",
});

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["--test", output], {
    cwd: artifactDir,
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});

await rm(outDir, { recursive: true, force: true });
process.exit(exitCode);