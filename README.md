# Lightning AI provider for pi

A [pi](https://github.com/earendil-works/pi) extension that exposes Lightning
AI's OpenAI-compatible model gateway as the `lai` provider.

## Features

- Discovers Lightning AI's official model catalog at startup.
- Filters user-created agent records and duplicate IDs from the public catalog.
- Imports current context windows, modalities, output limits, and pricing.
- Uses the Responses API for GPT-5.4+ and GPT-6 tool calls with reasoning.
- Reports token usage and calculates request costs in pi.
- Supports pi's `/login` credential flow and `LIGHTNING_API_KEY`.
- Keeps a static seven-model fallback for offline startup.
- Does not replace or interfere with pi's official providers.

## Install

Requires Pi 0.99.2 or newer and Node.js 22.19 or newer.

From npm:

```bash
pi install npm:pi-lightning-ai-provider
```

Or directly from GitHub:

```bash
pi install git:github.com/mindthemath/pi-extensions-lai
```

Review extensions before installing them: pi extensions execute with your full
user permissions.

## Authenticate

Start pi, run `/login`, choose **Lightning AI**, and paste your API key. Pi
stores it in its normal credential store.

Alternatively, set the environment variable before starting pi:

```bash
export LIGHTNING_API_KEY='...'
pi
```

The extension never reads project `.env` files and contains no API keys.

## Select models

Run `/model` and filter by provider `lai` or by the `LAI:` display-name prefix.
The model IDs remain Lightning AI's exact IDs, while the separate provider ID
prevents collisions with direct OpenAI, Anthropic, or Google models.

The extension currently recognizes official catalog records whose server-side
provider and ID namespace agree:

- `lightning-ai` → `lightning-ai/*`
- `Anthropic` → `anthropic/*`
- `Google` → `google/*`
- `OpenAI` → `openai/*`

Catalog presence is not a health check. A listed backend can still be warming,
temporarily unavailable, or incompatible with a particular request option. The
extension does not invoke every model at startup because probes are billable.

## API compatibility

GPT-5.4 and newer GPT models use Lightning's `/responses` endpoint through
pi's built-in OpenAI Responses implementation. The gateway rejects function
tools combined with `reasoning_effort` on `/chat/completions` for these models.
Switching APIs preserves reasoning rather than silently disabling it.

Older OpenAI models, Qwen, and other gateway models keep the Chat Completions
path. The same routing policy applies to both discovered and offline models.
Discovery also preserves the fallback models' extra thinking levels.

## Pricing and usage

Lightning AI returns OpenAI-style prompt, completion, total, and reasoning token
usage. It does not return a dollar-cost field. The extension converts the live
catalog's per-token input/output prices to pi's per-million-token rates, and pi
calculates the cost locally.

Lightning AI currently publishes no cache-token prices for this endpoint, so
cache read/write rates are zero.

## Development

Try the extension without installing it:

```bash
pi -e ./extensions/lightning-ai.ts
```

Install development dependencies and run offline checks (no API calls):

```bash
npm ci --ignore-scripts
npm run check
npm test
```

Offline tests exercise pi's actual provider dispatch and request serializers,
including tool declarations, tool-result replay, reasoning settings, catalog
filtering, metadata, and fallback/discovery consistency. A package smoke test
also packs the actual npm tarball and loads it through Pi's extension loader
from an isolated temporary directory with no local dependencies or network.

Run the **billable**, opt-in live streaming tests:

```bash
LIGHTNING_API_KEY='...' npm run test:live
```

The default matrix is Qwen3.8, GPT-5.2, GPT-5.4 nano, GPT-5.5, GPT-5.6 Sol,
and GPT-6.1 Sol. Each model must call a small tool, accept its result, report
that result in its final answer, and return usage/cost data. Requests use low
reasoning, at most 1,024 output tokens per turn, and a 60-second timeout.
Live tests read only `LIGHTNING_API_KEY`, not pi's credential store or `.env`.

Override the matrix to verify other official catalog models:

```bash
LAI_TEST_MODELS='lightning-ai/gemma-4-31B-it,google/gemini-2.5-flash' npm run test:live
```

Missing catalog models fail explicitly; fallback availability is not proof
that a backend is still offered. Live tests verify low reasoning only, not
all thinking levels or multimodal capabilities.

Check exactly what npm would publish:

```bash
npm pack --dry-run
```

## Release

PR checks run the offline suite, type-checking, dependency audit, and package
check on Node.js 22 and 24. Development checks use Pi 1.1.0; packed-extension
loading has also been verified with the minimum supported Pi 0.99.2. Live tests are never run automatically in CI.

After review and merging to `main`, publish from a clean checkout:

```bash
npm ci --ignore-scripts
npm run check
npm test
npm audit --audit-level=moderate
npm run check:pack
npm publish --access public
```

`npm publish` also runs type-checking and offline tests via `prepublishOnly`.
The release version must be unused on npm; this branch prepares `0.1.1`.
Verify the published version with `npm view pi-lightning-ai-provider version`.
Publishing requires npm package-owner credentials (and possibly an OTP).

## License

MIT
