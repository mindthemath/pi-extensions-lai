import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

test("published tarball loads through Pi's extension loader without local dependencies", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-lai-package-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // A publish dry-run propagates npm_config_dry_run to lifecycle children.
  // This isolated smoke test still needs a real temporary tarball to inspect.
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run=false", "--ignore-scripts", "--pack-destination", directory, "--json"], {
    encoding: "utf8",
  }));
  assert.deepEqual(pack.files.map((file: { path: string }) => file.path).sort(), [
    "LICENSE", "README.md", "extensions/lightning-ai.ts", "package.json",
  ]);
  execFileSync("tar", ["-xzf", join(directory, pack.filename), "-C", directory]);
  const packageDirectory = join(directory, "package");
  const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  assert.equal(manifest.version, pack.version);
  assert.equal(manifest.dependencies, undefined, "Host-provided Pi packages must not be bundled");
  // No network or credentials; force the static fallback for an isolated load.
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Offline package test"); });
  const loaded = await discoverAndLoadExtensions([packageDirectory], directory, join(directory, "agent"));
  assert.deepEqual(loaded.errors, [], "Packed extension must resolve host imports via Pi's loader");
  assert.equal(loaded.extensions.length, 1);
  const registrations = loaded.runtime.pendingNativeProviderRegistrations;
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].provider.id, "lai");
  const models = registrations[0].provider.getModels();
  assert.equal(models.length, 7);
  assert.equal(models.find((model) => model.id === "openai/gpt-5.6-sol")?.api, "openai-responses");
  assert.equal(models.find((model) => model.id === "lightning-ai/Qwen3.8-27B")?.api, "openai-completions");
});
