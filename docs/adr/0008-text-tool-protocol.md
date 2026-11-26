# 0008. A text protocol for tool calls

**Status:** accepted

## Context

Agents need tools: web search, GitHub, MCP servers and asking other teams for help. Three requirements shaped how they are called:

1. **Every provider.** Agents run on Claude, GPT, Gemini, local models and the demo model. Native tool calling differs between providers, and some local models have none.
2. **Durable pauses.** A tool set to "ask first" must wait for a person. `request_help` must wait for another team. These waits can last hours and must survive restarts, so the conversation so far has to be stored and resumed exactly.
3. **One permission check.** Allow, ask and deny must be enforced in one place, whatever the provider.

## Decision

- Tools are described in the system prompt. A call is plain text: `<tool name="x">{json}</tool>`. The result goes back as a user turn: `<result name="x">…</result>` (`@squadai/providers/protocol`).
- The engine runs the loop. It parses the call, checks the agent's policy, then runs the tool, pauses or refuses. The conversation is stored as plain `{role, content}` turns in `step.checkpoint`.
- The loop is capped at 4 tool calls and 8 model calls per step.
- Web search is a tool like any other. It calls Claude's server-side `web_search_20260209`, so every agent can search the web, whatever model the agent runs on.

## Consequences

- One code path for every provider, and the demo model can show the full flow without a key.
- Pauses are just data, so any worker can resume a step after a restart.
- We give up provider features of native tool use, such as strict schemas and parallel calls. Strong models follow the text format reliably. If a call cannot be parsed, its input is recorded as `_invalid`, the tool fails gracefully and the agent continues.
- Moving to native tool calling later only changes the step loop. The tool definitions, policies and checkpoints stay the same.
- The tags and input keys are protocol tokens: they stay the same in every language, and only the instructions around them are translated ([ADR-0009](0009-internationalization.md)).

## Addendum: English tokens

The first builds used Portuguese tokens (`<ferramenta nome>`, `<resultado>`, `pedir_ajuda`, `---NOTAS---`, plan keys `tarefas`/`agente`/`tarefa`, input keys `consulta`/`pergunta`/`time`/`comentario`). Before the first public release they were renamed to English, so the protocol reads naturally to contributors and models alike.

- The parser still accepts the old tags, tool name, plan keys, input keys and review marker, so a run paused before the rename resumes unchanged. Tests cover both forms.
- Migration `0003_english_protocol_tokens` renames what was stored outside checkpoints: tool policies, catalog template references, team slugs and cost-row labels.
