import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import lightningExtension, { MODELS, fromCatalog, usesResponses, fetchModels } from "../extensions/lightning-ai.ts";
import { catalog, configuredModel, context, payload } from "./helpers.ts";

test("Responses routing is scoped to GPT-5.4+ and GPT-6+, including dated/tier IDs", () => {
  for (const id of ["openai/gpt-5.4-2026-03-05", "openai/gpt-5.4-nano-2026-03-17", "openai/gpt-5.5-2026-04-23", "openai/gpt-5.6-sol", "openai/gpt-6-astra", "openai/gpt-6.1-sol"]) {
    assert.equal(usesResponses(id), true, id);
    assert.equal(fromCatalog(catalog(id))?.api, "openai-responses", id);
  }
  for (const id of ["openai/gpt-4.1", "openai/gpt-5-mini", "openai/gpt-5.2-2025-12-11", "openai/o3", "lightning-ai/Qwen3.8-27B", "anthropic/claude-sonnet-5", "google/gemini-3-pro"]) {
    assert.equal(usesResponses(id), false, id);
  }
});

test("discovery and fallback retain the same API, compat and thinking levels", () => {
  for (const fallback of MODELS) {
    const live = fromCatalog(catalog(fallback.id))!;
    assert.equal(live.api, fallback.api);
    assert.deepEqual(live.compat, fallback.compat);
    assert.deepEqual(live.thinkingLevelMap, fallback.thinkingLevelMap);
  }
});

test("compatibility is derived per API without Chat Completions fields leaking into Responses", async () => {
  for (const [id, reasoning, maxTokensField] of [
    ["openai/gpt-4.1", false, "max_tokens"],
    ["openai/gpt-5.2-2025-12-11", true, "max_completion_tokens"],
    ["openai/o3", true, "max_completion_tokens"],
    ["lightning-ai/Qwen3.8-27B", true, "max_tokens"],
  ] as const) {
    const model = fromCatalog(catalog(id))!;
    assert.equal(model.api, "openai-completions");
    if (model.api !== "openai-completions") throw new Error("Expected Chat Completions");
    assert.equal(model.compat?.supportsReasoningEffort, reasoning, id);
    assert.equal(model.compat?.maxTokensField, maxTokensField, id);
  }
  const nonReasoning = fromCatalog(catalog("openai/gpt-4.1"))!;
  assert.equal((await payload(nonReasoning)).reasoning_effort, undefined);
  for (const model of [configuredModel("openai/gpt-5.6-sol"), fromCatalog(catalog("openai/gpt-5.6-sol"))!]) {
    assert.equal(model.api, "openai-responses");
    assert.ok(model.compat);
    assert.equal("supportsReasoningEffort" in model.compat, false);
    assert.equal("maxTokensField" in model.compat, false);
    assert.equal("thinkingFormat" in model.compat, false);
  }
});

test("catalog validates official namespaces and imports metadata", () => {
  assert.equal(fromCatalog({ ...catalog("openai/gpt-5.6-sol"), provider: {} }), undefined);
  assert.equal(fromCatalog({ ...catalog("openai/gpt-5.6-sol"), provider: { name: "Google" } }), undefined);
  assert.equal(fromCatalog({ ...catalog("openai/gpt-5.6-sol"), pricing: {} }), undefined);
  const model = fromCatalog({ ...catalog("openai/gpt-5.6-sol"), max_tokens: 32_000,
    architecture: { input_modalities: ["text", "image"] } })!;
  assert.equal(model.contextWindow, 400_000);
  assert.equal(model.maxTokens, 32_000);
  assert.deepEqual(model.cost, { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(model.input, ["text", "image"]);
});

test("discovery removes agent records and duplicate IDs", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ data: [
    { ...catalog("openai/gpt-5.6-sol"), provider: {}, name: "User agent" },
    catalog("openai/gpt-5.6-sol"), catalog("openai/gpt-5.6-sol"),
    catalog("lightning-ai/Qwen3.8-27B"),
  ] })));
  const models = await fetchModels(AbortSignal.timeout(1000));
  assert.deepEqual(models.map((m) => m.id), ["openai/gpt-5.6-sol", "lightning-ai/Qwen3.8-27B"]);
});

test("offline startup registers the mixed-API fallback provider", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Offline"); });
  let registered: Provider | undefined;
  await lightningExtension({ registerProvider(provider: Provider) { registered = provider; } } as ExtensionAPI);
  assert.ok(registered);
  assert.equal(registered.id, "lai");
  assert.deepEqual(registered.getModels().map((m) => [m.id, m.api]), MODELS.map((m) => [m.id, m.api]));
});

test("invalid and empty catalogs cannot silently replace fallback models", async (t) => {
  for (const body of [{}, { data: [] }, { data: [{ ...catalog("openai/gpt-5.6-sol"), provider: {} }] }]) {
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body)));
    await assert.rejects(fetchModels(AbortSignal.timeout(1000)), /invalid catalog|no official models/);
    t.mock.restoreAll();
  }
});

for (const id of ["lightning-ai/Qwen3.8-27B", "openai/gpt-5.2-2025-12-11", "openai/gpt-5.4-nano-2026-03-17", "openai/gpt-5.5-2026-04-23", "openai/gpt-5.6-sol", "openai/gpt-6.1-sol"]) {
  test(`${id}: real provider tool serialization and result replay`, async () => {
    const model = configuredModel(id);
    const body = await payload(model);
    assert.equal(body.model, id);
    assert.equal(body.stream, true);
    assert.equal(body.tools[0].type, "function");
    if (usesResponses(id)) {
      assert.equal(body.tools[0].name, "lookup_marker");
      assert.equal(body.tools[0].function, undefined);
      assert.equal(body.reasoning.effort, "low");
      assert.equal(body.max_output_tokens, 512);
      assert.equal(body.store, false);
      assert.equal(body.messages, undefined);
      assert.equal(body.reasoning_effort, undefined);
      assert.equal(body.max_completion_tokens, undefined);
      assert.equal((await payload(model, context(), "off")).reasoning.effort, "none");
    } else {
      assert.equal(body.tools[0].function.name, "lookup_marker");
      assert.equal(body.reasoning_effort, "low");
      assert.equal(body[id.startsWith("openai/") ? "max_completion_tokens" : "max_tokens"], 512);
      assert.equal(body.input, undefined);
    }
    const input = context();
    const assistant: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: id, timestamp: 1,
      content: [{ type: "toolCall", id: "call_test", name: "lookup_marker", arguments: { key: "alpha" } }],
      stopReason: "toolUse", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    input.messages.push(assistant, { role: "toolResult", toolCallId: "call_test", toolName: "lookup_marker",
      content: [{ type: "text", text: "violet-731" }], isError: false, timestamp: 2 });
    const replay = await payload(model, input);
    if (usesResponses(id)) {
      const call = replay.input.find((item: any) => item.type === "function_call");
      const result = replay.input.find((item: any) => item.type === "function_call_output");
      assert.equal(call.name, "lookup_marker");
      assert.equal(result.call_id, call.call_id);
      assert.match(JSON.stringify(result.output), /violet-731/);
    } else {
      const call = replay.messages.find((item: any) => item.tool_calls)?.tool_calls[0];
      const result = replay.messages.find((item: any) => item.role === "tool");
      assert.equal(result.tool_call_id, call.id);
      assert.match(JSON.stringify(result.content), /violet-731/);
    }
  });
}

test("discovered GPT-5.5 retains xhigh in the outgoing request", async () => {
  const model = fromCatalog(catalog("openai/gpt-5.5-2026-04-23"))!;
  assert.equal((await payload(model, context(), "xhigh")).reasoning.effort, "xhigh");
});
