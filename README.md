# Lightning AI provider for pi

A [pi](https://github.com/earendil-works/pi) extension that exposes Lightning
AI's OpenAI-compatible model gateway as the `lai` provider.

## Features

- Discovers Lightning AI's official model catalog at startup.
- Filters user-created agent records and duplicate IDs from the public catalog.
- Imports current context windows, modalities, output limits, and pricing.
- Reports token usage and calculates request costs in pi.
- Supports pi's `/login` credential flow and `LIGHTNING_API_KEY`.
- Keeps a static seven-model fallback for offline startup.
- Does not replace or interfere with pi's official providers.

## Install

Once the npm package is published:

```bash
pi install npm:pi-lightning-ai-provider
```

Until then, install directly from GitHub:

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

Check exactly what npm would publish:

```bash
npm pack --dry-run
```

See [RELEASING.md](RELEASING.md) for the npm release process.

## License

MIT
