# Model Pricing Audit

Research performed on: `2026-02-10`

## Dropdown Source-of-Truth Logic

Reviewed files:
- `/Users/tomleger/repo/chat-support/lib/model-catalog.ts`
- `/Users/tomleger/repo/chat-support/lib/server-models.ts`
- `/Users/tomleger/repo/chat-support/lib/models.ts`
- `/Users/tomleger/repo/chat-support/app/api/stats/route.ts`

How the app builds dropdown models:
1. `getStatsModelCatalogForUser` first tries dynamic discovery via `getDynamicServerModelCatalog`.
2. If dynamic discovery returns any models, that catalog is used for stats and dropdown.
3. If dynamic discovery returns empty, stats fallback is user personal-provider-filtered `MODEL_SPECS`.
4. If stats fallback is also empty, dropdown fallback is full `MODEL_SPECS`.
5. Dynamic catalogs are deduped by `{provider}:{apiModel}`.

## Effective Dropdown List Snapshot (This Workspace Run)

Exact runtime behavior for this audit run:
- `ALLOW_CLIENT_API_KEY_OVERRIDE` was unset (`false` behavior).
- Server API keys were configured for OpenAI, Anthropic, and Gemini.
- Dynamic provider model-list HTTP requests were attempted by code path.
- In this environment, provider API DNS resolution failed, so dynamic discovery fell back to static provider presets.
- Because only OpenAI has static presets in `MODEL_SPECS`, the effective deduped dropdown list in this run was:

1. `openai:gpt-5.2-pro`
2. `openai:gpt-5.2`
3. `openai:gpt-5.1`
4. `openai:gpt-5`
5. `openai:gpt-5-mini`
6. `openai:gpt-5-nano`

## Pricing Coverage Used By Code

All rows below are represented by pricing resolver logic in `/Users/tomleger/repo/chat-support/lib/models.ts`.

### OpenAI

| Model ID | Provider | Input $/1M | Output $/1M | Long-context pricing | As-of | Source | Notes |
|---|---|---:|---:|---|---|---|---|
| `gpt-5.2-pro` | openai | 21.00 | 168.00 | N/A | 2026-02-10 | [OpenAI pricing](https://platform.openai.com/docs/pricing) |  |
| `gpt-5.2` | openai | 1.75 | 14.00 | N/A | 2026-02-10 | [OpenAI pricing](https://platform.openai.com/docs/pricing) |  |
| `gpt-5.1` | openai | 1.25 | 10.00 | N/A | 2026-02-10 | [OpenAI pricing](https://platform.openai.com/docs/pricing) |  |
| `gpt-5` | openai | 1.25 | 10.00 | N/A | 2026-02-10 | [OpenAI pricing](https://platform.openai.com/docs/pricing) |  |
| `gpt-5-mini` | openai | 0.25 | 2.00 | N/A | 2026-02-10 | [OpenAI pricing](https://platform.openai.com/docs/pricing) |  |
| `gpt-5-nano` | openai | 0.05 | 0.40 | N/A | 2026-02-10 | [OpenAI pricing](https://platform.openai.com/docs/pricing) |  |

### Anthropic

| Model ID | Provider | Input $/1M | Output $/1M | Long-context pricing | As-of | Source | Notes |
|---|---|---:|---:|---|---|---|---|
| `claude-opus-4-6` | anthropic | 15.00 | 75.00 | Input >200K: 30.00; output unchanged | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-opus-4-6-20260114` | anthropic | 15.00 | 75.00 | Input >200K: 30.00; output unchanged | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-sonnet-4-5` | anthropic | 3.00 | 15.00 | Input >200K: 6.00; output unchanged | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-sonnet-4-5-20250929` | anthropic | 3.00 | 15.00 | Input >200K: 6.00; output unchanged | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-haiku-4-5` | anthropic | 1.00 | 5.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-haiku-4-5-20251001` | anthropic | 1.00 | 5.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-opus-4-1` | anthropic | 15.00 | 75.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-opus-4-1-20250805` | anthropic | 15.00 | 75.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-opus-4-0` | anthropic | 15.00 | 75.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-opus-4-20250514` | anthropic | 15.00 | 75.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-sonnet-4-0` | anthropic | 3.00 | 15.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-sonnet-4-20250514` | anthropic | 3.00 | 15.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-3-7-sonnet-latest` | anthropic | 3.00 | 15.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-3-7-sonnet-20250219` | anthropic | 3.00 | 15.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-3-5-sonnet-latest` | anthropic | 3.00 | 15.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-3-5-sonnet-20241022` | anthropic | 3.00 | 15.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-3-5-sonnet-20240620` | anthropic | 3.00 | 15.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-3-5-haiku-latest` | anthropic | 0.80 | 4.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-3-5-haiku-20241022` | anthropic | 0.80 | 4.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-3-opus-20240229` | anthropic | 15.00 | 75.00 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |
| `claude-3-haiku-20240307` | anthropic | 0.25 | 1.25 | N/A | 2026-02-10 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |  |

### Gemini

| Model ID | Provider | Input $/1M | Output $/1M | Long-context pricing | As-of | Source | Notes |
|---|---|---:|---:|---|---|---|---|
| `gemini-2.5-pro` | gemini | 1.25 | 10.00 | Input >200K: 2.50; output unchanged | 2026-02-10 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Text token rates |
| `gemini-2.5-pro-preview-06-05` | gemini | 1.25 | 10.00 | Input >200K: 2.50; output unchanged | 2026-02-10 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Text token rates |
| `gemini-2.5-pro-preview-05-06` | gemini | 1.25 | 10.00 | Input >200K: 2.50; output unchanged | 2026-02-10 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Text token rates |
| `gemini-2.5-flash` | gemini | 0.30 | 2.50 | Input >200K: 0.60; output unchanged | 2026-02-10 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Text token rates |
| `gemini-2.5-flash-preview-05-20` | gemini | 0.30 | 2.50 | Input >200K: 0.60; output unchanged | 2026-02-10 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Text token rates |
| `gemini-2.5-flash-lite` | gemini | 0.10 | 0.40 | Input >200K: 0.20; output unchanged | 2026-02-10 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Text token rates |
| `gemini-2.5-flash-lite-preview-06-17` | gemini | 0.10 | 0.40 | Input >200K: 0.20; output unchanged | 2026-02-10 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Text token rates |
| `gemini-2.0-flash` | gemini | 0.10 | 0.40 | N/A | 2026-02-10 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Text token rates |
| `gemini-2.0-flash-lite` | gemini | 0.075 | 0.30 | N/A | 2026-02-10 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Text token rates |
| `gemini-2.0-flash-preview-image-generation` | gemini | unavailable | unavailable | N/A | 2026-02-10 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Unresolved: official docs do not publish a text token input/output pair for this model ID |

## Unresolved Items

1. `gemini:gemini-2.0-flash-preview-image-generation`
- Status: unresolved by design.
- Reason: official Google pricing documentation lists separate image-generation pricing behavior; no text-token input/output pair is published for this model ID.

## Source Links Used

- OpenAI pricing: <https://platform.openai.com/docs/pricing>
- OpenAI models overview: <https://platform.openai.com/docs/models>
- Anthropic all models (IDs, aliases, and baseline prices): <https://docs.anthropic.com/en/docs/about-claude/models/all-models>
- Anthropic legacy model IDs: <https://docs.anthropic.com/en/docs/about-claude/models/legacy-models>
- Anthropic pricing (including long-context rates): <https://docs.anthropic.com/en/docs/about-claude/pricing>
- Gemini models (IDs): <https://ai.google.dev/gemini-api/docs/models>
- Gemini pricing (including long-context tiers): <https://ai.google.dev/gemini-api/docs/pricing>
