import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, hasApi, InMemoryModelsStore, type Model } from "@earendil-works/pi-ai";
import { createLightningProvider, MODELS } from "../extensions/lightning-ai.ts";
import { configuredModel, payload } from "./helpers.ts";

function legacyModel(id: string): Model<"openai-completions"> {
  return {
    ...configuredModel(id),
    api: "openai-completions",
    thinkingLevelMap: undefined,
    compat: {
      supportsStore: false, supportsDeveloperRole: false,
      supportsReasoningEffort: true, supportsUsageInStreaming: true,
      supportsStrictMode: false, maxTokensField: "max_completion_tokens", thinkingFormat: "openai",
    },
  };
}

test("offline upgrade migrates cached API policy without losing catalog metadata", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Network must not be used"); });
  const store = new InMemoryModelsStore();
  const oldGPT = { ...legacyModel("openai/gpt-5.6-sol"), contextWindow: 987_654, maxTokens: 12_345,
    cost: { input: 9, output: 18, cacheRead: 0, cacheWrite: 0 } };
  const oldQwen = legacyModel("lightning-ai/Qwen3.8-27B");
  const oldGPT52 = legacyModel("openai/gpt-5.2-2025-12-11");
  const oldStore = { models: [oldGPT, oldQwen, oldGPT52], checkedAt: 123, lastModified: 100, etag: "old-etag" };
  await store.write("lai", oldStore);
  await store.write("other-provider", { models: [], checkedAt: 456 });
  const registry = createModels({ modelsStore: store });
  registry.setProvider(createLightningProvider());
  const result = await registry.refresh({ providers: ["lai"], allowNetwork: false });
  assert.equal(result.errors.size, 0);
  const gpt = registry.getModel("lai", oldGPT.id)!;
  assert.equal(gpt.api, "openai-responses");
  assert.deepEqual(gpt.compat, configuredModel(oldGPT.id).compat);
  assert.deepEqual(gpt.thinkingLevelMap, { xhigh: "xhigh" });
  assert.equal(gpt.contextWindow, oldGPT.contextWindow);
  assert.equal(gpt.maxTokens, oldGPT.maxTokens);
  assert.deepEqual(gpt.cost, oldGPT.cost);
  assert.equal(registry.getModel("lai", oldQwen.id)?.api, "openai-completions");
  assert.equal(registry.getModel("lai", oldGPT52.id)?.api, "openai-completions");
  const saved = (await store.read("lai"))!;
  assert.equal(saved.models.find((m) => m.id === oldGPT.id)?.api, "openai-responses");
  assert.equal(saved.checkedAt, 123, "Migration is not a fresh remote catalog check");
  assert.equal(saved.lastModified, 100);
  assert.equal(saved.etag, "old-etag");
  assert.deepEqual(await store.read("other-provider"), { models: [], checkedAt: 456 });
  assert.equal(oldStore.models[0].api, "openai-completions", "Stored input snapshots are not mutated");
  assert.equal(fetch.mock.calls.length, 0);
  const writes = t.mock.method(store, "write");
  await registry.refresh({ providers: ["lai"], allowNetwork: false });
  assert.equal(writes.mock.calls.length, 0, "Migration must be idempotent");
  if (!hasApi(gpt, "openai-responses")) throw new Error("Expected Responses");
  assert.equal((await payload(gpt)).reasoning.effort, "low");
});

test("migration covers cached-only GPT variants, not just fallback IDs", async () => {
  const store = new InMemoryModelsStore();
  const cached = ["openai/gpt-5.4-nano-2026-03-17", "openai/gpt-6.1-sol"].map(legacyModel);
  await store.write("lai", { models: cached });
  const registry = createModels({ modelsStore: store });
  registry.setProvider(createLightningProvider());
  const result = await registry.refresh({ allowNetwork: false });
  assert.equal(result.errors.size, 0);
  for (const model of cached) assert.equal(registry.getModel("lai", model.id)?.api, "openai-responses");
});

test("rejected migration publication cannot update the provider in memory", async () => {
  const provider = createLightningProvider();
  const before = provider.getModels();
  let publications = 0;
  await provider.refreshModels!({
    stored: { models: [{ ...legacyModel("openai/gpt-5.6-sol"), maxTokens: 99 }] },
    allowNetwork: false, signal: AbortSignal.timeout(1000),
    publish: async (publication) => {
      publications++;
      assert.equal(publication.persist?.models[0].api, "openai-responses");
      return false;
    },
  });
  assert.equal(publications, 1);
  assert.deepEqual(provider.getModels(), before);
  assert.deepEqual(provider.getModels(), MODELS);
});
