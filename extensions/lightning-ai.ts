import {
  createProvider,
  envApiKeyAuth,
  type Model,
  type OpenAICompletionsCompat,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "lai";
const BASE_URL = "https://lightning.ai/api/v1";
const MODELS_URL = `${BASE_URL}/models`;
const OFFICIAL_NAMESPACES = new Map([
  ["Anthropic", "anthropic/"],
  ["Google", "google/"],
  ["OpenAI", "openai/"],
  ["lightning-ai", "lightning-ai/"],
]);

const commonCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  supportsUsageInStreaming: true,
  supportsStrictMode: false,
  maxTokensField: "max_tokens" as const,
  thinkingFormat: "openai" as const,
};

export type LightningModel = Model<"openai-completions"> | Model<"openai-responses">;
type ModelSpec = Omit<LightningModel, "api" | "provider" | "baseUrl" | "compat">;

type CatalogEntry = {
  id: string;
  name?: string;
  context_length?: number;
  max_tokens?: number;
  pricing?: {
    input_cost_per_token?: number;
    output_cost_per_token?: number;
  };
  provider?: { name?: string };
  architecture?: { input_modalities?: string[] };
};

// The gateway rejects function tools + reasoning on Chat Completions for
// GPT-5.4 and newer. Responses preserves both tools and reasoning.
export function usesResponses(id: string): boolean {
  const version = /^openai\/gpt-(\d+)(?:\.(\d+))?(?:-|$)/.exec(id);
  if (!version) return false;
  const major = Number(version[1]);
  return major >= 6 || (major === 5 && Number(version[2] ?? 0) >= 4);
}

function model(
  spec: ModelSpec,
  compat: Partial<OpenAICompletionsCompat> = {},
): LightningModel {
  if (usesResponses(spec.id)) {
    return {
      ...spec,
      api: "openai-responses",
      provider: PROVIDER_ID,
      baseUrl: BASE_URL,
      compat: {
        supportsDeveloperRole: false,
        supportsStrictMode: false,
        supportsLongCacheRetention: false,
      },
    };
  }
  return {
    ...spec,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl: BASE_URL,
    compat: { ...commonCompat, ...compat },
  };
}

const knownOutputLimits: Record<string, number> = {
  "lightning-ai/Qwen3.8-27B": 131_072,
  "lightning-ai/gemma-4-31B-it": 32_768,
  "lightning-ai/deepseek-v4-pro": 128_000,
  "anthropic/claude-opus-4-8": 128_000,
  "anthropic/claude-sonnet-5": 128_000,
  "openai/gpt-5.6-sol": 128_000,
  "openai/gpt-5.5-2026-04-23": 128_000,
};

function isReasoningModel(id: string): boolean {
  return (
    id.startsWith("anthropic/") ||
    id.startsWith("google/gemini-2.5") ||
    id.startsWith("google/gemini-3") ||
    id.startsWith("openai/gpt-5") ||
    id.startsWith("openai/gpt-6") ||
    id.startsWith("openai/o3") ||
    id.startsWith("lightning-ai/")
  );
}

function usesMaxCompletionTokens(id: string): boolean {
  return (
    id.startsWith("openai/gpt-5") ||
    id.startsWith("openai/gpt-6") ||
    id.startsWith("openai/o3")
  );
}

export function fromCatalog(entry: CatalogEntry): LightningModel | undefined {
  const namespace = OFFICIAL_NAMESPACES.get(entry.provider?.name ?? "");
  if (!namespace || !entry.id?.startsWith(namespace)) return undefined;

  const contextWindow = entry.context_length && entry.context_length > 0
    ? entry.context_length
    : 128_000;
  const publishedMax = entry.max_tokens && entry.max_tokens > 0
    ? entry.max_tokens
    : undefined;
  const maxTokens = publishedMax
    ?? knownOutputLimits[entry.id]
    ?? Math.min(16_384, Math.max(1_024, Math.floor(contextWindow / 4)));
  const inputRate = entry.pricing?.input_cost_per_token;
  const outputRate = entry.pricing?.output_cost_per_token;
  if (typeof inputRate !== "number" || typeof outputRate !== "number") return undefined;

  const reasoning = isReasoningModel(entry.id);
  const input = entry.architecture?.input_modalities?.includes("image")
    ? (["text", "image"] as const)
    : (["text"] as const);

  return model(
    {
      id: entry.id,
      name: `LAI: ${entry.name || entry.id}`,
      reasoning,
      // Discovery must not erase thinking levels present in the offline model.
      thinkingLevelMap: MODELS.find((model) => model.id === entry.id)?.thinkingLevelMap,
      input: [...input],
      cost: {
        input: Number((inputRate * 1_000_000).toPrecision(12)),
        output: Number((outputRate * 1_000_000).toPrecision(12)),
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow,
      maxTokens,
    },
    {
      supportsReasoningEffort: reasoning,
      maxTokensField: usesMaxCompletionTokens(entry.id)
        ? "max_completion_tokens"
        : "max_tokens",
    },
  );
}

export async function fetchModels(signal: AbortSignal): Promise<LightningModel[]> {
  const response = await fetch(MODELS_URL, { signal });
  if (!response.ok) {
    throw new Error(`Lightning AI model discovery failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data?: CatalogEntry[] };
  if (!Array.isArray(payload.data)) {
    throw new Error("Lightning AI model discovery returned an invalid catalog");
  }

  const discovered = payload.data
    .map(fromCatalog)
    .filter((entry): entry is LightningModel => entry !== undefined);
  const models = [...new Map(discovered.map((entry) => [entry.id, entry])).values()];
  if (models.length === 0) {
    throw new Error("Lightning AI model discovery found no official models");
  }
  return models;
}

// Static fallback for offline startup and for the initially requested models.
// Dynamic discovery replaces matching entries with current metadata and adds
// the rest of Lightning AI's official catalog.
export const MODELS: LightningModel[] = [
  model({
    id: "lightning-ai/Qwen3.8-27B",
    name: "LAI: Qwen3.8 27B",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.4, output: 3, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262_144,
    maxTokens: 131_072,
  }),
  model({
    id: "lightning-ai/gemma-4-31B-it",
    name: "LAI: Gemma 4 31B IT",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.14, output: 0.4, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: 32_768,
  }),
  model({
    id: "lightning-ai/deepseek-v4-pro",
    name: "LAI: DeepSeek V4 Pro",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.89, output: 3, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 128_000,
  }),
  model({
    id: "anthropic/claude-opus-4-8",
    name: "LAI: Claude Opus 4.8",
    reasoning: true,
    thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  }),
  model({
    id: "anthropic/claude-sonnet-5",
    name: "LAI: Claude Sonnet 5",
    reasoning: true,
    thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    input: ["text", "image"],
    cost: { input: 2, output: 15, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 128_000,
  }),
  model(
    {
      id: "openai/gpt-5.6-sol",
      name: "LAI: GPT-5.6 Sol",
      reasoning: true,
      thinkingLevelMap: { xhigh: "xhigh" },
      input: ["text", "image"],
      cost: { input: 5, output: 30, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_050_000,
      maxTokens: 128_000,
    },
    { maxTokensField: "max_completion_tokens" },
  ),
  model(
    {
      id: "openai/gpt-5.5-2026-04-23",
      name: "LAI: GPT-5.5 (2026-04-23)",
      reasoning: true,
      thinkingLevelMap: { xhigh: "xhigh" },
      input: ["text", "image"],
      cost: { input: 5, output: 30, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_050_000,
      maxTokens: 128_000,
    },
    { maxTokensField: "max_completion_tokens" },
  ),
];

export function createLightningProvider(models: LightningModel[] = MODELS) {
  return createProvider({
    id: PROVIDER_ID,
    name: "Lightning AI",
    baseUrl: BASE_URL,
    auth: {
      apiKey: envApiKeyAuth("Lightning AI API key", ["LIGHTNING_API_KEY"]),
    },
    models,
    fetchModels: ({ signal }) => fetchModels(signal),
    api: {
      "openai-completions": openAICompletionsApi(),
      "openai-responses": openAIResponsesApi(),
    },
  });
}

export default async function (pi: ExtensionAPI) {
  let models = MODELS;
  try {
    models = await fetchModels(AbortSignal.timeout(10_000));
  } catch {
    // Keep the static fallback when offline or when discovery is unavailable.
  }

  pi.registerProvider(createLightningProvider(models));
}
