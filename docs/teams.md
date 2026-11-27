# Creating a team

A team is one YAML file in [`packages/catalog/templates`](../packages/catalog/templates). The file name must match its `id`.

```yaml
id: support-replies # lowercase, hyphens
version: 1 # bump when you change the template
locale: en # the language this file is written in (en or pt-BR; default en)
department: Support # sidebar group; created if it does not exist
name: Support replies
description: We answer your customers politely and consistently.
color: "#CA8A04"
lead: gabi # who plans free-form requests (default: the first agent)
scope: # what the team does and doesn't do; off-topic requests go elsewhere
  does:
    - Replies to customer questions
    - Help-center articles
  doesNot:
    - Refunds or account changes
    - Legal advice

agents:
  - key: gabi
    name: Gabi
    role: Support
    bio: I answer as if the customer were family. # first person
    skills: [Support replies, Warm tone]
    prefers: The customer's question and the company policy.
    never: Promise something the policy doesn't allow.
    tier: balanced # economy | balanced | max
    style: balanced # precise | balanced | creative
    tools: # allow | ask | deny (unlisted tools are denied)
      web_search: allow
      request_help: allow
    instructions: |
      You are Gabi, from support. ...

playbooks:
  - key: reply-to-customer
    name: Reply to a customer
    description: A reply ready to send.
    mode: sequential # sequential | coordinator | parallel
    estimatedHumanMinutes: 15
    approval: true
    steps:
      - agent: gabi
        task: Write the reply following the policy.
```

Then run:

```bash
pnpm catalog:generate   # validates and regenerates src/generated.ts
pnpm test --filter @squadai/catalog
```

## How the team works: flows

Steps in a sequential playbook can say what kind of work they are. Leave `kind` out and the position decides (first = research, last of three or more = review, the rest = draft).

```yaml
steps:
  - agent: lia
    task: Collect the customer's context and the numbers.
    kind: research
  - agent: teo
    task: Agree on the story's angle.
    kind: discuss
    with: [lia, bia] # teammates who join the conversation
  - agent: teo
    task: Confirm the angle with you before writing.
    kind: checkpoint # the team waits for the person's OK
  - agent: teo
    task: Write the case study.
    kind: draft
  - agent: bia
    task: Check every claim and polish the copy.
    kind: review
    rounds: 2 # may send the draft back to the writer once
```

People can also ask for anything without picking a playbook. Then the team's `lead` plans the steps for that request, using the same kinds. Write the `scope` so the lead and the scope check know what is in and out.

Write the persona the way a teammate would introduce themselves. The bio, "prefers" and "never" appear on the agent's profile, so people learn how to work with the agent.

## Translations

A team can come in more than one language. Add a `translations` block with the words for each extra locale. When an office hires the team, it gets the version in the office's language, or the template's own language when there is no translation.

```yaml
translations:
  pt-BR:
    department: Atendimento
    name: Respostas de suporte
    description: A gente responde seus clientes com educação e consistência.
    agents:
      gabi: # one entry per agent key
        role: Atendimento
        bio: Respondo como se o cliente fosse da família.
        skills: [Respostas de suporte, Tom acolhedor]
        prefers: A pergunta do cliente e a política da empresa.
        never: Prometer algo que a política não permite.
        instructions: |
          Você é a Gabi, do atendimento. ...
    scope: # optional; the template's own scope is used without it
      does: [Respostas a dúvidas de clientes, Artigos da central de ajuda]
      doesNot: [Reembolsos ou mudanças de conta, Orientação jurídica]
    playbooks:
      reply-to-customer: # one entry per playbook key
        name: Responder um cliente
        description: Uma resposta pronta para enviar.
        tasks: # one per step, in order
          - Escreva a resposta seguindo a política.
```

Only words are translated. Keys, agent names, tools, tiers, modes and the order of steps come from the template, so the team works the same in every language. A translation must be complete: `pnpm catalog:generate` fails if it misses an agent, a playbook or a step's task.
