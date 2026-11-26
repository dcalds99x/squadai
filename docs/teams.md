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
    playbooks:
      reply-to-customer: # one entry per playbook key
        name: Responder um cliente
        description: Uma resposta pronta para enviar.
        tasks: # one per step, in order
          - Escreva a resposta seguindo a política.
```

Only words are translated. Keys, agent names, tools, tiers, modes and the order of steps come from the template, so the team works the same in every language. A translation must be complete: `pnpm catalog:generate` fails if it misses an agent, a playbook or a step's task.
