# squadai: product requirements

This is the living product document. It records what squadai is for, what it
must do, and every change to that scope, with the reason for it. Technical
detail lives in [architecture.md](architecture.md) and the [ADRs](adr).

## 1. Problem and goal

Small teams want the output of a marketing, research or engineering team
without hiring one. Today's AI tools are either a single chat box (no roles,
no review, no accountability) or a workflow builder (powerful, but you have to
design the process yourself).

squadai is a self-hosted office of **permanent, humanized AI teams**. You hire a
team from a catalog, ask it for something in plain words, watch it work in its
room, and approve what it delivers. It is also a portfolio piece for a Forward
Deployed Engineer role, so deployability, integrations, observability and docs
count as much as features.

## 2. Users

| Who            | Wants                                                                             |
| -------------- | --------------------------------------------------------------------------------- |
| Owner / admin  | Hire teams, connect providers and tools, set budgets and permissions.             |
| Member         | Ask teams for work, follow it, approve or request changes.                        |
| Deployer (FDE) | Stand the app up for a client, add a custom team and connector, prove the result. |

## 3. Core concepts

- **Office → departments → teams → agents.** Teams are permanent and keep their room and history.
- **Agent:** persona, avatar, skills, "never does", a model ("brain") with a plan B, and tool permissions (Can / Asks first / Can't).
- **Request → delivery.** People see deliveries with versions, notes and approvals, not runs.
- **Playbook (delivery type):** a known way the team works, such as "Blog post". Since v0.5 it is a _suggestion_, not a requirement (see §6).
- **Room:** the team chat. People and agents talk there, and the work is narrated there.
- **Scope:** what a team does and doesn't do. Requests outside it are redirected (see §6).

## 4. Functional requirements

### 4.1 Requests

- R1. A person can ask any team for anything in free text. A delivery type is optional.
- R2. When no type is chosen, the team lead plans the work: who takes part, in which order, and what the delivery is called.
- R3. Delivery types show as suggestions; picking one runs that known process.
- R4. A request outside the team's scope does not run. The person sees why and which team or agent fits better, with one click to send it there.

### 4.2 How teams work (flow)

- F1. Work is a flow, not a single funnel. Supported shapes:
  - **work** steps (research, draft, any task);
  - **review** with a loop back to the author, up to N rounds;
  - **discuss**: two or more agents exchange views in the room before the next step;
  - **checkpoint**: the person approves mid-run before the team continues;
  - **parallel** contributions combined by a lead (existing);
  - **coordinator**: the lead splits and combines (existing);
  - **adaptive**: the lead picks the steps for this request.
- F2. Inside any step an agent can **ask a teammate** a quick question, and **ask another team** for help (existing).
- F3. The team page shows each delivery type as a small flow diagram, including loops and checkpoints.
- F4. Every pause (approval, checkpoint, handoff) survives restarts.

### 4.3 Models

- M1. Providers: Anthropic, OpenAI, Google, OpenRouter, Ollama, any OpenAI-compatible endpoint.
- M2. After connecting a provider, its model list is saved. Picking a model is: provider → model from the list, with a "custom" escape hatch.
- M3. Each profile (economy, balanced, top quality) and each agent has a main model and a plan B.

### 4.4 Guardrails

- G1. Tool permissions per agent (existing).
- G2. Monthly budget (existing).
- G3. Team scope check before a run, and scope reminders in every agent prompt and in the room chat.
- G4. Audit log of every action (existing).

### 4.5 Non-functional

- Self-hosted with Docker; Postgres is the only dependency.
- Works offline in demo mode with a deterministic model.
- English everywhere in the code; pt-BR as a translation.
- Reliability: no lost or doubled work, traced runs, evals, E2E and load tests. See [reliability.md](reliability.md).

## 5. Roadmap

| Phase              | Scope                                                                                            | Status      |
| ------------------ | ------------------------------------------------------------------------------------------------ | ----------- |
| 0. Foundation      | Monorepo, CI, Docker, schema, auth, design system                                                | ✅          |
| 1. Core loop       | Providers, requests, live room, versioned deliveries, approvals                                  | ✅          |
| 2. Real teams      | Coordinator/parallel modes, handoffs, router, budgets, fallback models                           | ✅          |
| 3. Integrations    | Tools, MCP, GitHub, Notion, enforced permissions, audit log                                      | ✅          |
| 3.5 Feedback round | Model picker, free-form requests, scope guardrails, fluid flows                                  | ✅          |
| 4. Reliability     | Evals in CI, OpenTelemetry traces, crash-resume test, load tests, Playwright E2E, no double runs | ✅          |
| 5. Showcase        | Public demo, deployment case study, video                                                        | in progress |

## 6. Change log

Newest first. Each entry says what changed and why.

### 2026-11-27 · Readable deliveries, and taking work back

| #   | Feedback                                                          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Delivery text looks off: tables show as raw `                     | ` pipes, the serif style reads heavy.                                                                                                                                                                                                                                                                                                                                                                                           | GitHub-flavored Markdown (tables, task lists, strikethrough). Deliveries use the app's own type (Inter, Space Grotesk headings), a 72-character line, bordered tables that scroll sideways, dark code blocks, highlighted quotes. Links open in a new tab. |
| 2   | Teams can't be removed; deliveries can't be cancelled or deleted. | **Cancel** stops the team (a running worker stops at its next model call) and keeps the delivery on record. **Delete** removes the delivery, its versions, notes and conversation. **Remove team** (managers) removes the team, its people, room and work, and its department when empty. Teams waiting on removed work carry on without it. Each asks for confirmation, is in the audit log, and keeps the cost ledger intact. |

### 2026-11-27 · Second hands-on test, with a real OpenAI model

Source: the owner ran a free-form request with an OpenAI reasoning model.

| #   | Feedback                                       | Cause                                                                                                                                                                                                                                               | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Deliveries are short and low quality.          | The researcher answered "I'll check…" and stopped (no search tool with OpenAI); the writer then refused to write without research; nothing told agents to deliver complete work. OpenAI reasoning models got a temperature and no reasoning effort. | Every agent prompt now says: do the work in this reply, never defer or ask for more, assume and state assumptions, be specific and substantial, fill gaps from expertise. New research format; draft, review and result formats ask for complete, detailed work and forbid shortening. OpenAI reasoning models get `reasoningEffort` and 16k output tokens. Téo's instructions updated (template v6, migration `0006` for teams already hired). |
| 2   | Nobody answers questions in the team room.     | Agents only replied when @mentioned, and didn't know the state of the work.                                                                                                                                                                         | A message without a mention goes to the team lead. Replies see the team's last five deliveries (status, versions, errors, the latest text's opening) and can be up to six sentences.                                                                                                                                                                                                                                                            |
| 3   | The sidebar and the room scroll with the page. | The window scrolled as a whole.                                                                                                                                                                                                                     | On desktop the office is an app shell: sidebar, center and side panels scroll on their own; only the center moves. Phones keep normal page scrolling.                                                                                                                                                                                                                                                                                           |
| 4   | Messages just pop into the chat.               | No feedback between sending and the answer.                                                                                                                                                                                                         | Your message appears at once ("sending…"); whoever will answer shows as typing; agents at work show a live "working on…" line; new messages slide in; a "new messages" pill appears if you scrolled up; Enter sends, Shift+Enter adds a line. Respects reduced motion.                                                                                                                                                                          |

### 2026-11-27 · Phase 5: showcase (first part)

Why: a reviewer should be able to try squadai in one click and see how it would be deployed for a real client.

| Item                                                                                                                                                                                                                                                               | Status                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Public demo mode (`SQUADAI_PUBLIC_DEMO=1`): new offices get every team, demo mode and three sample requests; API keys, integrations, MCP servers and Notion export are refused (no stored secrets, no server-side calls to typed URLs); a banner says it is a demo | ✅                                                                                                                       |
| One-click deploy: `render.yaml` (web, worker, Postgres) and an all-in-one Docker stage for hosts that build the last stage                                                                                                                                         | ✅ built and smoke-tested locally; **not yet deployed** (needs the owner's Render account; the worker needs a paid plan) |
| Case study for a fictional client, Pedal & Co.: discovery, custom Customer support team, orders MCP connector, deployment decisions, metrics (illustrative)                                                                                                        | ✅ team and connector tested in CI                                                                                       |
| README: flow diagram, quality table, deploy button, links                                                                                                                                                                                                          | ✅                                                                                                                       |
| GIFs and a 2-minute video                                                                                                                                                                                                                                          | ⏳ the owner records them                                                                                                |

### 2026-11-27 · Phase 4: reliability

Why: an FDE hands this to a client's ops team. They need to trust that work isn't lost or doubled, see where time and money go, and catch regressions before users do. Details in [reliability.md](reliability.md).

| Item           | What shipped                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No double runs | Run lease renewed before every model call, plus a unique index allowing one unfinished run per request. Migration `0005` cleans up old duplicates first.                             |
| Crash resume   | A test kills a real worker process mid-run and checks the retry resumes at the right step without repeating finished work.                                                           |
| Tracing        | OpenTelemetry spans for runs, steps, tools and model calls (GenAI conventions, cost). OTLP to Jaeger (`--profile tracing`) or Langfuse. Prompts only with `SQUADAI_TRACE_CONTENT=1`. |
| Evals          | `packages/evals`: 11 reference requests across the 3 teams, including refusals. Rule checks on every CI build; real models and an AI judge on `main` when the key is set.            |
| E2E            | Playwright: sign-up, demo mode, refusal, free-form request, approval, checkpoint, tool permission. Runs in CI after the build.                                                       |
| Load           | `load-test` script: 120 requests with every job sent twice ran at about 470 requests/min with zero doubled runs.                                                                     |

### 2026-11-27 · Feedback round after the first hands-on test

Source: the owner tested the app in demo mode and with an OpenAI key.

| #   | Feedback                                                                                 | Decision                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Models are a free text field; you can't see what a provider offers.                      | Save the model list when a provider connects; pick provider → model, with a custom option. (M2)                                |
| 2   | Delivery types are a closed list; you should be able to ask for anything related.        | Delivery types become optional suggestions; the default is "Team decides", where the lead plans the work. (R1–R3)              |
| 3   | Teams must stay on their subject and point elsewhere for unrelated work.                 | Teams get a scope. Off-topic requests are blocked with a suggestion of the right team or agent. (R4, G3)                       |
| 4   | "How we work" is a single funnel; teams should interact in different ways, like openbot. | New step kinds: review loops, discussions, checkpoints, ask-a-teammate, and an adaptive mode. Shown as a flow diagram. (F1–F3) |

**What shipped** (all four items, same day):

- **Models.** `provider_credential.models` stores the chat models a provider lists when it connects (embeddings, speech and image models are filtered out). "Refresh models" asks again. Profiles and agents pick provider → model; "Custom…" still takes any id. A choice whose provider isn't connected stays visible as "(not connected)".
- **Free-form requests.** The form shows "Team decides" (default) plus the team's delivery types as chips. With no type, the lead plans the flow, names the delivery and posts the plan in the room. The plan is saved on the request, so a revision follows it.
- **Scope.** Teams have `scope.does` / `scope.doesNot`. A request that doesn't fit isn't created: the form says so and offers "Send to <team> · <agent>". Agents' prompts and room replies carry the scope too, and the lead can still decline mid-run.
- **Fluid flows.** Step kinds `research`, `draft`, `review` (with `rounds`), `discuss` (with `with`) and `checkpoint`, plus the `ask_teammate` tool. New playbooks: Case study (Content & SEO), Pricing study (Market research), Investigate a bug (Code review); Blog post now has a review loop. "How we work" draws each playbook as a flow, and "Waiting on you" shows checkpoints with "Go on / Stop here".
- **Compatibility.** Migration `0004` adds the columns and sets the lead of teams hired earlier. Teams hired before keep their playbooks; hire a team again to get the new ones.

**Not covered yet:** scope checks with a real model were only exercised through tests with the demo model; the user's own key test is still pending.
