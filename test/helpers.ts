import { createModels, type Context } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createLightningProvider, MODELS, fromCatalog, type LightningModel } from "../extensions/lightning-ai.ts";

export const tools = [{
  name: "lookup_marker",
  description: "Look up the secret marker for a key.",
  parameters: Type.Object({ key: Type.String() }),
}];

export function context(): Context {
  return {
    systemPrompt: "Follow the user's instructions. Use lookup_marker to retrieve unknown markers.",
    tools,
    messages: [{ role: "user", content: "Call lookup_marker with key alpha, then report its result.", timestamp: 0 }],
  };
}

export function catalog(id: string) {
  const provider = id.startsWith("openai/") ? "OpenAI"
    : id.startsWith("anthropic/") ? "Anthropic" : "lightning-ai";
  return { id, provider: { name: provider }, context_length: 400_000,
    pricing: { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 } };
}

export function configuredModel(id: string): LightningModel {
  const result = MODELS.find((model) => model.id === id) ?? fromCatalog(catalog(id));
  if (!result) throw new Error(`Missing model: ${id}`);
  return result;
}

export function runtime(models = MODELS) {
  const registry = createModels();
  registry.setProvider(createLightningProvider(models));
  return registry;
}

// Exercise the real provider dispatch and Pi serializers, but stop before HTTP.
export async function payload(model: LightningModel, input = context(), reasoning: "off" | "low" | "xhigh" = "low") {
  let captured: any;
  const result = await runtime([model]).completeSimple(model, input, {
    apiKey: "offline-test-key", reasoning: reasoning === "off" ? undefined : reasoning, maxTokens: 512,
    onPayload(body) { captured = body; throw new Error("Captured before HTTP"); },
  });
  if (!captured) throw new Error(result.errorMessage ?? "Payload hook was not called");
  return captured;
}
