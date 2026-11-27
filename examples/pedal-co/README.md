# Case study: Pedal & Co. (fictional)

> **Pedal & Co. is not a real company, and the numbers below are illustrative.** This case study shows how a Forward Deployed Engineer would take squadai into a client: discovery, a custom team, a new connector, deployment and how results are measured. The team and the connector in this folder are real, working files, tested in CI.

## 1. The client

Pedal & Co. sells bike parts online from Porto, in Portuguese and English. Four people run the shop; one of them spends most of the day in the support inbox.

## 2. Discovery (week 1)

Two interviews (the owner and the support person) and one week of the inbox:

| Finding                | Detail                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------- |
| Volume                 | ~400 messages a week, peaking on Mondays                                                |
| What people ask        | 61% "where is my order", 22% returns and exchanges, 17% product questions               |
| First response         | 9 hours on average; 31 hours over weekends                                              |
| Where the answers live | The order system (status, carrier, tracking) and a one-page returns policy              |
| Red lines              | Refunds and discounts are always a person's call. Nothing goes to a customer unchecked. |

What that means for the design:

- Most answers are lookups plus a well-written reply, so a **team that can read orders** removes most of the work.
- "Nothing unchecked" maps to squadai's **approval before delivery**. "Refunds are a person's call" maps to a **checkpoint** and to the team's **scope**.
- The order system has an internal API. A small **MCP server** in front of it is the safest way to expose it: read-only, three tools, one token.

## 3. The custom team

[`support-team.yaml`](support-team.yaml) defines **Customer support**:

| Agent       | Role               | Model profile | Tools                             |
| ----------- | ------------------ | ------------- | --------------------------------- |
| Gabi (lead) | Writes the replies | balanced      | order lookups                     |
| Davi        | Orders specialist  | economy       | order lookups, return eligibility |
| Rita        | Quality reviewer   | economy       | none                              |

- **Scope:** replies, order status, returns within policy, help-center articles. Not refunds, discounts or account changes, not marketing, not code. A request outside that is refused and pointed to the right team.
- **Reply to a customer:** Davi looks the order up, Gabi writes, Rita reviews and can send it back once. You approve.
- **Handle a return request:** Davi checks eligibility, then the team **stops at a checkpoint** for a person's OK before anything is promised.
- Free-form requests ("write a saved reply for delayed CTT shipments") are planned by Gabi, the lead.

## 4. The new connector

[`orders-mcp/`](orders-mcp) is an MCP server (Streamable HTTP, bearer token) with three read-only tools: `get_order`, `orders_for_customer`, `return_eligibility`. Here it serves sample data; in the real deployment `ORDERS` is replaced by calls to the shop's order API.

Connecting it takes one form in **Integrations → MCP servers**: name `orders`, the URL, the token. squadai tests it, lists its tools, and they show up on every agent's profile as `mcp.orders.<tool>`, blocked until allowed. The template above allows exactly the ones each agent needs.

```bash
ORDERS_MCP_TOKEN=change-me pnpm --filter @squadai/example-orders-mcp start
```

## 5. Deployment (week 2)

| Decision                                             | Why                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Docker Compose on the shop's existing VM             | One small machine already runs their site; Postgres is the only new dependency.                                  |
| Anthropic key in Models & costs, budget US$ 60/month | Encrypted at rest; the budget stops runs instead of surprising the owner.                                        |
| Economy profile for Davi and Rita, balanced for Gabi | Lookups and checks are cheap; the writing is where quality shows.                                                |
| Traces to Langfuse, without content                  | The owner sees cost per reply; customer data stays on the VM (`SQUADAI_TRACE_CONTENT` off).                      |
| Evals before go-live                                 | Ten real (anonymized) inbox messages became eval cases, including two refund requests the team must not promise. |

Rollout: one week where every reply is approved by the support person (the default), then a review of edits and of the cases where the team was sent back by Rita.

## 6. Results (illustrative)

What squadai measures on its own, and what the pilot would be judged on:

| Metric                             | Before     | After 4 weeks (target) | Where it comes from                                |
| ---------------------------------- | ---------- | ---------------------- | -------------------------------------------------- |
| First response time                | 9 h        | under 1 h              | request created → delivery ready                   |
| Replies approved without changes   | —          | 80%                    | "Approved on the first pass" on the home page      |
| Support person's time on the inbox | ~25 h/week | ~8 h/week              | "Time saved" (12 min per reply, from the playbook) |
| Cost per reply                     | —          | about US$ 0.02         | Models & costs, per team                           |
| Refunds promised by the team       | —          | 0                      | scope + checkpoint; covered by evals               |

## 7. What an FDE would do next

- Replace the sample data with the shop's order API and add an eval for every new kind of message.
- Turn the most common approved replies into saved replies (a free-form request to the same team).
- Add a WhatsApp channel through another MCP server, with the same scope and approvals.
