# Reliability

How squadai keeps work safe when things go wrong, and how each claim is tested.

| Concern                                                       | How it is handled                                                  | Proof                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| A request queued twice runs twice                             | Run lease + one unfinished run per request                         | `never runs the same request twice at once` (engine tests), load test |
| The worker dies mid-run                                       | Steps are checkpointed; the lease runs out; the retry resumes      | `resumes from the right step after the worker is killed mid-run`      |
| A pause (approval, checkpoint, other team) is lost on restart | Everything a step waits for lives in `step.checkpoint`             | engine tests for tools, handoffs and checkpoints                      |
| A team's quality drifts                                       | Reference requests per team, rule checks in CI, AI judge on `main` | `pnpm evals`                                                          |
| The UI breaks the main journey                                | Playwright on the built app and a real worker                      | `pnpm e2e`                                                            |
| You can't see why a run was slow or expensive                 | OpenTelemetry traces per run, step, tool and model call            | `tracing` test; Jaeger or Langfuse                                    |

## No double runs

pg-boss delivers jobs at least once, and the same request can be queued twice (a retry, a double click, a handoff resuming a run that is already going). Two layers stop it from running twice at once:

1. **Lease.** A worker claims a run by setting `run.lease_until` (10 minutes), and renews it before every model call. Another worker that picks up the same request finds the lease alive and steps aside (`outcome: "skipped"`).
2. **One unfinished run per request.** A partial unique index (`run_one_active_per_request`) covers the race where two workers start a brand-new run at the same moment. The loser gets a unique violation and steps aside.

The lease is shorter than pg-boss's job expiry, so when a worker dies, its run is free again by the time the job is retried.

## Crash and resume

Every step is written to `step` before and after it runs, with its conversation so far in `step.checkpoint`. Each step's position comes from a counter in execution order, and every decision (review verdicts, the lead's plan, approvals) is stored in a step's output. A resumed run replays the finished steps from the database, without calling a model, and continues at the first unfinished one.

The crash test starts a real worker process, kills it with `SIGKILL` once research is done and the draft has started, and checks that the retry steps aside while the lease is alive, then finishes the run without calling the model again for research.

## Tracing

The engine emits OpenTelemetry spans: `squadai.run`, then one `squadai.step <kind>` per step, `squadai.tool <name>` per tool call, and `chat <model>` per model call with the GenAI attributes (`gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`) plus `squadai.cost_usd`. Without an endpoint, tracing is off and costs nothing.

- **Jaeger, locally:** `docker compose --profile tracing up -d`, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` for the worker, open http://localhost:16686.
- **Langfuse:** `OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel` and `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64 of public-key:secret-key>`.
- Prompts and answers stay out of traces unless `SQUADAI_TRACE_CONTENT=1`, because they may hold customer data.

## Evals

`packages/evals/cases/<team>.yaml` holds reference requests: what to ask, which delivery type (or none), and what to expect. Each team has at least one request it must refuse, with the team it should point to.

- **Rule checks** (every CI build, demo model): scope verdict, where a refusal points, outcome, phrases the delivery must mention, length, headings, review notes, checkpoints.
- **AI judge** (on `main`, when the `ANTHROPIC_API_KEY` secret is set): the run uses real Claude models and a judge scores each delivery 1–5 against the case's rubric. Below 3 fails.

```bash
pnpm evals                       # demo model, rule checks
ANTHROPIC_API_KEY=… pnpm evals   # real models + AI judge, a few cents
```

## End-to-end

`pnpm build && pnpm e2e` starts the built web app and a worker against `DATABASE_URL`, then walks the main journey in a browser: sign up, turn on demo mode, an off-topic request is refused, a free-form request is planned and delivered, the delivery is approved, a checkpoint waits for "Go on", and a tool set to "Asks first" waits for "Allow". Set `E2E_BROWSER=msedge` (or `chrome`) to use an installed browser.

## Load

`pnpm --filter @squadai/worker load-test -- --requests 200 --workers 4` creates requests across all teams (a third of them free-form), sends every job twice, and runs several workers in one process against its own pg-boss schema. It fails if any request ran twice.

Last run, on a development laptop (Windows 11, Postgres 17 in Docker, demo model at 50 ms per call):

| Measure                  | Value                                                                    |
| ------------------------ | ------------------------------------------------------------------------ |
| Requests                 | 120, each job sent twice (240 jobs), 4 workers × 4 concurrent            |
| Queue drained in         | 15.3 s                                                                   |
| Throughput               | 471 requests/min                                                         |
| Job time p50 / p95 / max | 848 / 1728 / 2112 ms                                                     |
| Outcomes                 | 100 ready for review, 20 waiting at a checkpoint, 120 duplicates skipped |
| Model calls              | 1,040                                                                    |
| Requests that ran twice  | 0                                                                        |

With real models, run time is dominated by the provider, not by the queue or the database.
