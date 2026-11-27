/**
 * The demo model: deterministic, free and offline. It lets anyone try the
 * whole flow (and lets tests run it) without an API key. Its answers are
 * clearly templated, so nobody mistakes them for real work. It writes in the
 * workspace's language (`hint.locale`).
 */
import { DEFAULT_LOCALE, type Locale } from "@squadai/core";
import { formatToolCall } from "./protocol.ts";
import type { ChatModel, ChatRequest, ModelOutput } from "./types.ts";

export const DEMO_PROVIDER = "demo";
export const DEMO_MODEL = "squadai-demo";
/** Separates a review's text from its notes. A protocol token: the same in every locale. */
export const REVIEW_NOTES_MARKER = "---NOTES---";
/** The marker early builds used. Reviews written with it still parse. */
export const LEGACY_REVIEW_NOTES_MARKER = "---NOTAS---";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * "Preciso de um artigo sobre energia solar." → "energia solar"
 * "I need a blog post about solar energy." → "solar energy"
 * It understands both languages: people write in whatever language they think in.
 */
export function subjectOf(request: string): string {
  const firstLine = request.trim().split("\n")[0] ?? "";
  const subject = firstLine
    .replace(/^(preciso de|quero|gostaria de|faça|faz|escreva|crie)\s+/i, "")
    .replace(
      /^(um|uma|o|a)\s+[^\s]+(\s+(curto|curta|completo|completa|rápido|rápida))?\s+(sobre|de|para)\s+/i,
      "",
    )
    .replace(/^(i need|i want|i'd like|we need|please write|write|create|make)\s+/i, "")
    .replace(/^(a|an|the)\s+(?:[^\s]+\s+){1,3}?(about|on)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .slice(0, 120)
    .trim();
  return subject.charAt(0).toLowerCase() + subject.slice(1);
}

function titleCase(topic: string): string {
  const clean = topic.trim().replace(/[.!?]+$/, "");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

const MARKET_WORDS =
  /preç|custo|concorr|mercado|valor|quanto custa|price|cost|competit|market|how much/i;
const PR_LINK = /([\w.-]+\/[\w.-]+)(?:\/pull\/|#)(\d+)/;

type Hint = NonNullable<ChatRequest["hint"]>;

const PT_BR = {
  askForData: (subject: string) =>
    `Preciso de preços e dados de mercado sobre ${subject}, com fontes.`,
  prComment: "Revisão do time squadai: veja o resumo completo na entrega. (modo demonstração)",
  findings: "**O que encontrei com as ferramentas**",
  research: (topic: string) => [
    `## Pesquisa sobre: ${topic}`,
    "",
    "**Dúvidas mais comuns**",
    "- O que é e para quem serve?",
    "- Quanto custa e em quanto tempo traz resultado?",
    "- Quais são os erros mais comuns de quem está começando?",
    "",
    "**Palavras-chave sugeridas**: guia, passo a passo, vale a pena, custo",
  ],
  planTask: (subject: string) =>
    `Analise "${subject}" do seu ponto de vista e traga os 3 pontos mais importantes.`,
  contribution: (name: string, subject: string) => [
    `### Contribuição de ${name}`,
    `- Ponto principal sobre ${subject}.`,
    "- Um risco que vale acompanhar.",
    "- Uma recomendação prática.",
  ],
  synthesis: (topic: string, subject: string) => [
    `# ${topic}: resultado do time`,
    "",
    "## Resumo",
    `Juntamos o trabalho de todos sobre ${subject}. Os pontos abaixo estão em ordem de importância.`,
    "",
    "## Principais pontos",
    "1. O ponto mais importante levantado pelo time.",
    "2. O principal risco e como reduzir.",
    "3. A próxima ação recomendada.",
  ],
  draft: (topic: string, subject: string) => [
    `# ${topic}: o guia direto ao ponto`,
    "",
    `Se você chegou até aqui, provavelmente quer entender ${subject} sem enrolação. Vamos por partes.`,
    "",
    "## O que é",
    "Em poucas palavras: é uma forma de resolver o problema com menos esforço e mais clareza.",
    "",
    "## Quanto custa",
    "Depende do seu caso. O importante é comparar opções antes de decidir.",
    "",
    "## Como começar",
    "1. Entenda o que você precisa.",
    "2. Compare pelo menos três alternativas.",
    "3. Comece pequeno e ajuste no caminho.",
  ],
  signature: "_Texto gerado no modo demonstração._",
  /** What the review changes in the draft, and the note it leaves for each change. */
  edits: [
    {
      from: "o guia direto ao ponto",
      to: "guia completo e sem enrolação",
      why: "Título mais específico, com a palavra que as pessoas buscam.",
    },
    {
      from: "Depende do seu caso.",
      to: "Depende do tamanho do seu caso.",
      why: "Deixei a frase mais concreta.",
    },
  ],
  chat: (name: string) =>
    `Oi! Aqui é ${name}. Anotado, vou levar isso em conta no próximo trabalho. (modo demonstração)`,
  /** How a review prompt introduces the text, for callers that send no `hint.reviewing`. */
  reviewLabel: "Texto para revisar:",
  /** A discussion, one line per turn. */
  discussion: [
    (subject: string) => `Eu abriria com o ponto mais forte sobre ${subject}, logo no começo.`,
    (subject: string) =>
      `Concordo. E deixaria claro para quem é: quem está começando com ${subject}.`,
    () => "Fechado para mim. Só cuidaria para cada número ter fonte.",
  ],
  discussionSummary: (subject: string) => [
    `- Abrimos com o ponto mais forte sobre ${subject}.`,
    "- Falamos com quem está começando.",
    "- Todo número com fonte.",
  ],
  teammateQuestion: (subject: string) => `Qual é o ponto que não pode faltar sobre ${subject}?`,
  sendBack: "A abertura ainda está genérica. Comece pelo problema de quem lê.",
  triageTitle: "Entrega sob medida",
  chatStatus: (name: string, title: string, state: string) =>
    `Oi! Aqui é ${name}. Sobre “${title}”: ${state}. Se quiser, abra a entrega pelo quadro ao lado. (modo demonstração)`,
};

/** The demo model's templated text, per workspace language. */
const WORDS: Record<Locale, typeof PT_BR> = {
  "pt-BR": PT_BR,
  en: {
    askForData: (subject) => `I need prices and market data on ${subject}, with sources.`,
    prComment: "Review from the squadai team: see the full summary in the delivery. (demo mode)",
    findings: "**What I found with the tools**",
    research: (topic) => [
      `## Research: ${topic}`,
      "",
      "**Most common questions**",
      "- What is it and who is it for?",
      "- How much does it cost, and how soon does it pay off?",
      "- What mistakes do beginners make most often?",
      "",
      "**Suggested keywords**: guide, step by step, is it worth it, cost",
    ],
    planTask: (subject) =>
      `Look at "${subject}" from your point of view and bring back the 3 most important points.`,
    contribution: (name, subject) => [
      `### ${name}'s contribution`,
      `- The main point about ${subject}.`,
      "- A risk worth keeping an eye on.",
      "- A practical recommendation.",
    ],
    synthesis: (topic, subject) => [
      `# ${topic}: the team's result`,
      "",
      "## Summary",
      `We pulled together everyone's work on ${subject}. The points below are in order of importance.`,
      "",
      "## Key points",
      "1. The most important point the team raised.",
      "2. The main risk and how to reduce it.",
      "3. The recommended next step.",
    ],
    draft: (topic, subject) => [
      `# ${topic}: the no-nonsense guide`,
      "",
      `If you made it here, you probably want to understand ${subject} without the fluff. Let's take it one step at a time.`,
      "",
      "## What it is",
      "In short: a way to solve the problem with less effort and more clarity.",
      "",
      "## What it costs",
      "It depends on your situation. What matters is comparing options before you decide.",
      "",
      "## How to start",
      "1. Figure out what you need.",
      "2. Compare at least three alternatives.",
      "3. Start small and adjust along the way.",
    ],
    signature: "_Text generated in demo mode._",
    edits: [
      {
        from: "the no-nonsense guide",
        to: "the complete, no-fluff guide",
        why: "A more specific title, with the word people search for.",
      },
      {
        from: "It depends on your situation.",
        to: "It depends on the size of your project.",
        why: "Made the sentence more concrete.",
      },
    ],
    chat: (name) =>
      `Hi! It's ${name}. Noted, I'll keep that in mind for the next piece of work. (demo mode)`,
    reviewLabel: "Text to review:",
    discussion: [
      (subject) => `I'd open with the strongest point about ${subject}, right at the top.`,
      (subject) => `Agreed. And I'd make it clear who it's for: people new to ${subject}.`,
      () => "Works for me. Just make sure every number has a source.",
    ],
    discussionSummary: (subject) => [
      `- We open with the strongest point about ${subject}.`,
      "- We write for people who are just starting.",
      "- Every number gets a source.",
    ],
    teammateQuestion: (subject) => `What's the one thing we can't leave out about ${subject}?`,
    sendBack: "The opening is still generic. Start from the reader's problem.",
    triageTitle: "Tailored delivery",
    chatStatus: (name, title, state) =>
      `Hi! It's ${name}. On “${title}”: ${state}. You can open it from the board. (demo mode)`,
  },
};

type Words = typeof PT_BR;

function toolResults(request: ChatRequest): { name: string; body: string }[] {
  return (request.continuation ?? [])
    .filter((t) => t.role === "user")
    .flatMap((t) => {
      const m = /<result name="([^"]+)">\s*([\s\S]*?)\s*<\/result>/.exec(t.content);
      return m ? [{ name: m[1] ?? "", body: m[2] ?? "" }] : [];
    });
}

/** The demo model uses tools the way a careful colleague would: once, when useful. */
function nextToolCall(request: ChatRequest, hint: Hint, words: Words): string | null {
  const tools = hint.tools ?? [];
  const used = new Set(toolResults(request).map((r) => r.name));
  const subject = subjectOf(hint.topic);
  if (hint.kind === "research") {
    const helper = hint.teams?.find((t) => t.slug.includes("research")) ?? hint.teams?.[0];
    if (
      tools.includes("request_help") &&
      helper &&
      !used.has("request_help") &&
      MARKET_WORDS.test(hint.topic)
    ) {
      return formatToolCall("request_help", {
        team: helper.slug,
        question: words.askForData(subject),
      });
    }
    if (tools.includes("web_search") && !used.has("web_search")) {
      return formatToolCall("web_search", { query: subject });
    }
  }
  if (hint.kind === "draft" && tools.includes("ask_teammate") && !used.has("ask_teammate")) {
    const other = hint.teammates?.find((t) => t.name !== hint.agentName);
    if (other && !hint.rework) {
      return formatToolCall("ask_teammate", {
        teammate: other.key,
        question: words.teammateQuestion(subject),
      });
    }
  }
  const pr = PR_LINK.exec(hint.topic);
  if (
    pr &&
    hint.kind === "contribution" &&
    tools.includes("github_read") &&
    !used.has("github_read")
  ) {
    return formatToolCall("github_read", { repo: pr[1], pr: Number(pr[2]) });
  }
  if (
    pr &&
    hint.kind === "synthesis" &&
    tools.includes("github_comment") &&
    !used.has("github_comment")
  ) {
    return formatToolCall("github_comment", {
      repo: pr[1],
      pr: Number(pr[2]),
      comment: words.prComment,
    });
  }
  return null;
}

function findings(request: ChatRequest, words: Words): string {
  const results = toolResults(request);
  if (results.length === 0) return "";
  return [
    "",
    words.findings,
    ...results.map((r) => `- _${r.name}_: ${r.body.replace(/\s+/g, " ").slice(0, 280)}`),
  ].join("\n");
}

/** The text under review: from the hint, else whatever follows a review label in the prompt. */
function textToReview(request: ChatRequest): string {
  if (request.hint?.reviewing !== undefined) return request.hint.reviewing.trim();
  const label = Object.values(WORDS)
    .map((w) => w.reviewLabel)
    .find((l) => request.prompt.includes(l));
  return label ? (request.prompt.split(label).at(-1)?.trim() ?? "") : "";
}

function write(request: ChatRequest): string {
  const hint: Hint = request.hint ?? {
    agentName: "Agente",
    kind: "chat" as const,
    topic: request.prompt,
  };
  const words = WORDS[hint.locale ?? DEFAULT_LOCALE];
  const call = nextToolCall(request, hint, words);
  if (call) return call;

  const subject = subjectOf(hint.topic);
  const topic = titleCase(subject);
  switch (hint.kind) {
    case "research":
      return [...words.research(topic), findings(request, words)].join("\n");
    case "triage": {
      // A small, sensible flow from whoever is on the team. Keys are protocol tokens.
      const team = hint.teammates ?? [];
      const lead = team.find((t) => t.name === hint.agentName) ?? team[0];
      const others = team.filter((t) => t !== lead);
      const steps: Record<string, unknown>[] = [];
      if (others[0])
        steps.push({ agent: others[0].key, kind: "research", task: words.planTask(subject) });
      if (lead) steps.push({ agent: lead.key, kind: "draft", task: topic });
      const reviewer = others[1] ?? others[0];
      if (reviewer) steps.push({ agent: reviewer.key, kind: "review", task: topic, rounds: 2 });
      return JSON.stringify({ fit: "in", title: words.triageTitle, steps });
    }
    case "discussion": {
      // The runner numbers discussion turns in `round`; a teammate's quick answer has none.
      const turn = (hint.round ?? 1) - 1;
      const line = words.discussion[Math.min(turn, words.discussion.length - 1)];
      return line ? line(subject) : "";
    }
    case "summary":
      return words.discussionSummary(subject).join("\n");
    case "scope":
      return JSON.stringify({ fit: "in", reason: "", better: "none" });
    case "plan": {
      const others = (hint.teammates ?? []).filter((t) => t.name !== hint.agentName);
      // The plan's keys are protocol tokens, the same in every locale (see parsePlan).
      return JSON.stringify({
        tasks: others.map((t) => ({ agent: t.key, task: words.planTask(subject) })),
      });
    }
    case "contribution":
      return [...words.contribution(hint.agentName, subject), findings(request, words)].join("\n");
    case "synthesis":
      return [
        ...words.synthesis(topic, subject),
        findings(request, words),
        "",
        words.signature,
      ].join("\n");
    case "draft":
      return [...words.draft(topic, subject), "", words.signature].join("\n");
    case "review": {
      // A review that may send the draft back does so once, then approves.
      const loops = (hint.rounds ?? 1) > 1;
      if (loops && (hint.round ?? 1) === 1) {
        return ["VERDICT: revise", "", REVIEW_NOTES_MARKER, `${topic} :: ${words.sendBack}`].join(
          "\n",
        );
      }
      const reviewed = words.edits.reduce(
        (text, edit) => text.replace(edit.from, edit.to),
        textToReview(request),
      );
      return [
        ...(loops ? ["VERDICT: approve", ""] : []),
        reviewed,
        "",
        REVIEW_NOTES_MARKER,
        ...words.edits.map((edit) => `${edit.to} :: ${edit.why}`),
      ].join("\n");
    }
    default: {
      // Room replies get the team's work status: report the latest item.
      const latest = /^- "(.+?)" \([^)]*\): ([^;]+);/m.exec(request.prompt);
      return latest
        ? words.chatStatus(hint.agentName, latest[1] ?? "", latest[2] ?? "")
        : words.chat(hint.agentName);
    }
  }
}

export function createDemoModel(options: { delayMs?: number } = {}): ChatModel {
  return {
    provider: DEMO_PROVIDER,
    model: DEMO_MODEL,
    async generate(request: ChatRequest): Promise<ModelOutput> {
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      const text = write(request);
      return {
        text,
        inputTokens: estimateTokens(
          request.system +
            request.prompt +
            (request.continuation ?? []).map((t) => t.content).join(""),
        ),
        outputTokens: estimateTokens(text),
      };
    },
  };
}
