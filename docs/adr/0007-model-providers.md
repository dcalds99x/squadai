# 0007. Anthropic SDK for Claude, AI SDK for everything else, and a demo model

**Status:** accepted

## Context

Agents must run on whatever models a deployment has: Claude, GPT, Gemini, OpenRouter, or local models through Ollama. One generic layer is convenient, but it lags behind provider-specific features. On current Claude models those features matter: `effort` instead of sampling parameters, refusal handling and server-side fallbacks.

People evaluating squadai, and CI, also need to run the whole flow without an API key.

## Decision

- A small `ChatModel` interface (`generate(request) → { text, tokens }`) in `@squadai/providers`. The engine only sees this interface.
- **Anthropic:** implemented with the official `@anthropic-ai/sdk`, using `output_config.effort`. Refusals raise `ModelRefusalError`. Opus 5.5 and Sonnet 5.5 use `fallbacks: "default"`.
- **Every other provider:** implemented with the Vercel AI SDK (`@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`).
- **Demo model:** a deterministic, templated model, turned on per workspace. Its answers are clearly marked as demo output.
- **Plan B:** `generateWithFallback` tries the primary model, then the fallback, and records which one answered.
- **Checking a connection** lists the provider's models instead of generating text. It costs nothing and returns the model names for the UI.

## Consequences

- Claude gets first-class behavior, and other providers keep working through one well-maintained adapter.
- Adding a provider means adding one adapter and, optionally, its prices.
- Integration tests exercise the real engine and database with the demo model, at no cost. Real-provider calls are not covered by CI.
