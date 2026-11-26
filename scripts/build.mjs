import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const entry = path.join(rootDir, "src", "cli.ts");
const outputs = [
  path.join(rootDir, "dist", "sibyl.mjs"),
  path.join(rootDir, "skills", "sibyl", "scripts", "sibyl.mjs"),
];

for (const outFile of outputs) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
}

await build({
  entryPoints: [entry],
  outfile: outputs[0],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  keepNames: true,
  sourcemap: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});

fs.copyFileSync(outputs[0], outputs[1]);

if (process.platform !== "win32") {
  for (const outFile of outputs) {
    fs.chmodSync(outFile, 0o755);
  }
}

console.log(`Built Sibyl single-file bundles:\n- ${outputs[0]}\n- ${outputs[1]}`);
