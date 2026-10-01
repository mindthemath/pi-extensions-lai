import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchModels } from "../extensions/lightning-ai.ts";
import { context, runtime } from "./helpers.ts";

const enabled = process.env.LAI_LIVE === "1";
const ids = (process.env.LAI_TEST_MODELS ?? [
  "lightning-ai/Qwen3.8-27B",
  "openai/gpt-5.2-2025-12-11",
  "openai/gpt-5.4-nano-2026-03-17",
  "openai/gpt-5.5-2026-04-23",
  "openai/gpt-5.6-sol",
  "openai/gpt-6.1-sol",
].join(",")).split(",").map((id) => id.trim()).filter(Boolean);

// Explicitly opt-in; no credential-store reads or billable startup probes.
test("live streaming tool-call round trips", { skip: !enabled, timeout: 900_000 }, async (t) => {
  const apiKey = process.env.LIGHTNING_API_KEY;
  assert.ok(apiKey, "Set LIGHTNING_API_KEY to run billable live tests");
  const models = await fetchModels(AbortSignal.timeout(15_000));
  const registry = runtime(models);
  for (const id of ids) {
    await t.test(id, { timeout: 130_000 }, async () => {
      const model = models.find((m) => m.id === id);
      assert.ok(model, `Official catalog does not contain ${id}`);
      const input = context();
      const options = { apiKey, reasoning: "low" as const, maxTokens: 1024, cacheRetention: "none" as const };
      const first = await registry.completeSimple(model, input, { ...options, signal: AbortSignal.timeout(60_000) });
      assert.equal(first.stopReason, "toolUse", first.errorMessage ?? "Expected a tool call");
      const calls = first.content.filter((block) => block.type === "toolCall");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].name, "lookup_marker");
      assert.deepEqual(calls[0].arguments, { key: "alpha" });
      assert.ok(calls[0].id);
      const marker = `marker-${crypto.randomUUID()}`;
      input.messages.push(first, { role: "toolResult", toolCallId: calls[0].id, toolName: calls[0].name,
        content: [{ type: "text", text: marker }], isError: false, timestamp: Date.now() });
      const second = await registry.completeSimple(model, input, { ...options, signal: AbortSignal.timeout(60_000) });
      assert.equal(second.stopReason, "stop", second.errorMessage ?? "Expected a final answer");
      assert.ok(second.content.filter((b) => b.type === "text").map((b) => b.text).join("").includes(marker),
        "Final answer must contain the marker from the tool result");
      for (const message of [first, second]) {
        assert.ok(message.usage.totalTokens > 0, "Streaming usage must be reported");
        assert.ok(message.usage.cost.total > 0, "Catalog pricing must be applied");
      }
    });
  }
});
