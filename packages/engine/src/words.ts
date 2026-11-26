/**
 * Everything the engine writes, in the workspace's language: what agents say
 * in the room, the prompts they receive and how tools describe themselves.
 *
 * `PT_BR` is the reference; every other locale must have exactly its shape, so
 * a missing line fails `pnpm typecheck`. Protocol tokens (tool tags, tool input
 * keys, the review marker and the plan's JSON keys) are deliberately the same
 * in every language. See docs/adr/0009-internationalization.md.
 */
import type { Locale } from "@squadai/core";

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const quote = (text: string) => `“${text}”`;

const PT_BR = {
  room: {
    usedFallback: (agent: string, model: string) =>
      `${agent} trocou para o modelo reserva (${model}) porque o principal não respondeu.`,
    askPermission: (tool: string) =>
      `Preciso da sua permissão para usar ${quote(tool)}. Está em Esperando você.`,
    usingTool: (tool: string) => `Usando ${quote(tool)}…`,
    startRevision: "Recebi o seu ajuste. Mexendo no texto agora.",
    startResearch: (task: string) =>
      `Começando a pesquisa: ${lowerFirst(task).replace(/\.$/, "")}. Já volto com o que encontrar.`,
    startReview: "Peguei o texto. Revisando agora.",
    startDraft: "Peguei o material. Escrevendo agora.",
    researchDone: (next?: string) =>
      next ? `Terminei a pesquisa. ${next}, é com você!` : "Terminei a pesquisa.",
    reviewDone: (notes: number) =>
      notes > 0
        ? `Revisei tudo e deixei ${notes} ${notes === 1 ? "nota" : "notas"} explicando as mudanças.`
        : "Revisei tudo. Está pronto.",
    draftDone: (next?: string) => (next ? `Rascunho pronto. ${next}, pode revisar!` : "Pronto!"),
    splitWork: "Vou dividir o trabalho com o time.",
    planAgreed: (parts: { agent: string; task: string }[]) =>
      `Combinado: ${parts.map((p) => `${p.agent} fica com ${quote(p.task)}`).join("; ")}.`,
    tookPart: (task: string) => `Peguei minha parte: ${lowerFirst(task)}`,
    partDone: "Minha parte está pronta.",
    redoResult: "Recebi o seu ajuste. Refazendo o resultado.",
    combining: "Juntando tudo agora.",
    combined: "Pronto, juntei tudo.",
    failed: (reason: string) => `O time travou: ${reason}`,
    readyForReview: (title: string) => `${quote(title)} está pronto para você revisar.`,
    delivered: (title: string) => `${quote(title)} foi entregue.`,
    newRequest: (playbook: string, prompt: string) => `Novo pedido (${playbook}): ${prompt}`,
    approved: (title: string) =>
      `Você aprovou ${quote(title)}. Entrega concluída. Obrigado pelo retorno!`,
    toolAllowed: (agent: string | null) =>
      `Você permitiu que ${agent ?? "o agente"} usasse a ferramenta.`,
    toolRefused: (agent: string | null) =>
      `Você não permitiu. ${agent ?? "O agente"} vai seguir sem essa ferramenta.`,
    changesRequested: (title: string, feedback: string) => `Ajuste em ${quote(title)}: ${feedback}`,
    handoffIncoming: (team: string, ask: string) => `Pedido do time ${team}: ${ask}`,
    handoffOutgoing: (team: string, ask: string) => `Pedi ajuda ao time ${team}: ${ask}`,
    handoffAnswered: (team: string) => `O time ${team} respondeu. Continuando o trabalho.`,
    replyFailed: (reason: string) => `Queria responder, mas não consegui: ${reason}`,
  },
  approval: {
    tool: (agent: string, tool: string) => `${agent} quer usar ${quote(tool)}.`,
    delivery: "O trabalho está pronto. Posso finalizar?",
  },
  /** First word of a version label, followed by " · <agent>". */
  version: { draft: "rascunho", review: "revisão", adjustment: "ajuste", result: "resultado" },
  fallbackName: { colleague: "Colega", system: "Sistema" },
  prompt: {
    system: (agent: string, role: string, team: string) =>
      `Você é ${agent} (${role}) e trabalha no time ${team}. Responda sempre em português do Brasil, em Markdown.`,
    request: (prompt: string) => `Pedido de quem está no comando:\n${prompt}`,
    feedback: (feedback: string) => `Ajuste pedido depois da última versão:\n${feedback}`,
    research: (by: string, text: string) => `Pesquisa de ${by}:\n${text}`,
    toReview: (text: string) => `Texto para revisar:\n${text}`,
    current: (text: string) => `Versão atual:\n${text}`,
    taskNow: (task: string) => `Sua tarefa agora: ${task}`,
    reviewFormat: (marker: string) =>
      `Responda com o texto revisado completo. Depois, numa linha sozinha, escreva ${marker} e, abaixo, uma nota por linha no formato:\ntrecho do texto revisado :: por que você mudou`,
    draftFormat: "Responda apenas com o texto final, pronto para usar.",
    task: (task: string) => `Sua tarefa: ${task}`,
    team: (lines: string) => `Seu time:\n${lines}`,
    planFormat:
      'Divida o trabalho. Responda SOMENTE com JSON no formato {"tasks":[{"agent":"chave","task":"o que fazer"}]}, usando as chaves acima. Mantenha os nomes dos campos do JSON exatamente como estão. Não inclua você mesmo.',
    part: (task: string) => `Sua parte: ${task}`,
    contributionFormat: "Responda com a sua contribuição, objetiva e organizada.",
    contribution: (by: string, text: string) => `Contribuição de ${by}:\n${text}`,
    combineTask: "Junte tudo.",
    resultFormat: "Responda apenas com o resultado final, pronto para usar.",
    helperRequest: (ask: string, agent: string, team: string) =>
      `${ask}\n\n(Pedido de ${agent}, do time ${team}.)`,
    chatSystem: (agent: string, role: string, team: string) =>
      `Você é ${agent} (${role}) no time ${team}. Está conversando na sala do time, como num chat de trabalho. Responda em 1 a 3 frases curtas, em português do Brasil, sem Markdown.`,
    chat: (transcript: string) =>
      `Conversa recente:\n${transcript}\n\nResponda à última mensagem que mencionou você.`,
    routerSystem:
      "Você escolhe qual time de um escritório deve fazer um pedido. Responda só com o número da opção.",
    router: (prompt: string, options: string) => `Pedido: ${prompt}\n\nOpções:\n${options}`,
    routerOption: (n: number, playbook: string, team: string, description: string) =>
      `${n}. ${playbook} (time ${team}): ${description}`,
  },
  /** What tools tell the model. Their input keys are protocol tokens and stay the same. */
  toolResult: {
    unavailable: "Ferramenta indisponível.",
    notOffered: "Essa ferramenta não está disponível para você.",
    refused: "A pessoa responsável não autorizou esse uso. Siga sem essa ferramenta.",
    helpFailed: "O outro time não conseguiu ajudar.",
    failed: (error: string) => `A ferramenta falhou: ${error}`,
    limit: "Você já usou o limite de ferramentas. Entregue agora o trabalho final, sem chamadas.",
  },
  tools: {
    webSearch: {
      label: "Pesquisar na internet",
      description: 'Pesquisa na web e devolve um resumo com fontes. Entrada: {"query": "texto"}.',
      example: "preço médio de painel solar residencial 2026",
      missingQuery: "Informe uma consulta.",
      demoResults: (query: string) =>
        `Resultados de exemplo para "${query}" (modo demonstração):\n- Guia introdutório sobre ${query} — exemplo.com/guia\n- Perguntas frequentes sobre ${query} — exemplo.com/faq`,
      sources: "Fontes",
    },
    githubRead: {
      label: "Ler o GitHub",
      description:
        'Lê um pull request: título, descrição e as mudanças. Entrada: {"repo": "dono/repositorio", "pr": 123}.',
      missingTarget: "Informe repo (dono/nome) e o número do PR.",
      noDiff: "(sem diff)",
      author: "Autor",
      demo: (pr: number, repo: string) =>
        `PR #${pr} de ${repo} (exemplo do modo demonstração): muda a validação de formulário e adiciona um teste.`,
      failed: (error: string) =>
        `Não consegui ler o PR: ${error}. Ele é privado? Conecte o GitHub em Integrações.`,
      githubStatus: (status: number) => `GitHub respondeu ${status}`,
    },
    githubComment: {
      label: "Comentar no GitHub",
      description:
        'Publica um comentário em um pull request. Entrada: {"repo": "dono/repositorio", "pr": 123, "comment": "texto"}.',
      example: "Resumo da revisão…",
      missingInput: "Informe repo, pr e comment.",
      simulated: "Comentário simulado (modo demonstração): nada foi publicado no GitHub.",
      posted: (url: string) => `Comentário publicado: ${url}`,
    },
    askForHelp: {
      label: "Pedir ajuda a outro time",
      description: (teams: string) =>
        `Pede algo a outro time do escritório e espera a resposta. Times: ${teams || "nenhum"}. Entrada: {"team": "slug-do-time", "question": "o que você precisa"}.`,
      exampleTeam: "outro-time",
      example: "Preciso de preços atuais de…",
      missingInput: "Informe o time e a pergunta.",
      unknownTeam: (team: string) => `Não encontrei o time "${team}".`,
    },
    githubMerge: {
      label: "Fazer merge no GitHub",
      description: "Faz merge de um pull request.",
      never: "squadai não faz merge.",
    },
    mcp: {
      description: (description: string, server: string) =>
        `${description} (servidor MCP ${server}). Entrada: os argumentos da ferramenta em JSON.`,
      error: (text: string) => `Erro: ${text}`,
    },
  },
};

export type Words = typeof PT_BR;

const EN: Words = {
  room: {
    usedFallback: (agent, model) =>
      `${agent} switched to the backup model (${model}) because the main one didn't respond.`,
    askPermission: (tool) =>
      `I need your permission to use ${quote(tool)}. You'll find it in Waiting on you.`,
    usingTool: (tool) => `Using ${quote(tool)}…`,
    startRevision: "Got your feedback. Working on the text now.",
    startResearch: (task) =>
      `Starting the research: ${lowerFirst(task).replace(/\.$/, "")}. I'll be back with what I find.`,
    startReview: "Got the text. Reviewing it now.",
    startDraft: "Got the material. Writing now.",
    researchDone: (next) => (next ? `Research done. ${next}, over to you!` : "Research done."),
    reviewDone: (notes) =>
      notes > 0
        ? `Reviewed everything and left ${notes} ${notes === 1 ? "note" : "notes"} explaining the changes.`
        : "Reviewed everything. It's ready.",
    draftDone: (next) => (next ? `Draft ready. ${next}, it's yours to review!` : "Done!"),
    splitWork: "I'll split the work with the team.",
    planAgreed: (parts) =>
      `Here's the plan: ${parts.map((p) => `${p.agent} takes ${quote(p.task)}`).join("; ")}.`,
    tookPart: (task) => `On my part now: ${lowerFirst(task)}`,
    partDone: "My part is done.",
    redoResult: "Got your feedback. Redoing the result.",
    combining: "Putting it all together now.",
    combined: "Done, it's all put together.",
    failed: (reason) => `The team got stuck: ${reason}`,
    readyForReview: (title) => `${quote(title)} is ready for you to review.`,
    delivered: (title) => `${quote(title)} was delivered.`,
    newRequest: (playbook, prompt) => `New request (${playbook}): ${prompt}`,
    approved: (title) =>
      `You approved ${quote(title)}. Delivery complete. Thanks for the feedback!`,
    toolAllowed: (agent) => `You allowed ${agent ?? "the agent"} to use the tool.`,
    toolRefused: (agent) => `You said no. ${agent ?? "The agent"} will carry on without that tool.`,
    changesRequested: (title, feedback) => `Changes to ${quote(title)}: ${feedback}`,
    handoffIncoming: (team, ask) => `Request from the ${team} team: ${ask}`,
    handoffOutgoing: (team, ask) => `Asked the ${team} team for help: ${ask}`,
    handoffAnswered: (team) => `The ${team} team answered. Picking the work back up.`,
    replyFailed: (reason) => `I wanted to reply, but couldn't: ${reason}`,
  },
  approval: {
    tool: (agent, tool) => `${agent} wants to use ${quote(tool)}.`,
    delivery: "The work is ready. Can I wrap it up?",
  },
  version: { draft: "draft", review: "review", adjustment: "revision", result: "result" },
  fallbackName: { colleague: "Teammate", system: "System" },
  prompt: {
    system: (agent, role, team) =>
      `You are ${agent} (${role}) and you work on the ${team} team. Always reply in English, in Markdown.`,
    request: (prompt) => `Request from the person in charge:\n${prompt}`,
    feedback: (feedback) => `Changes requested after the last version:\n${feedback}`,
    research: (by, text) => `Research by ${by}:\n${text}`,
    toReview: (text) => `Text to review:\n${text}`,
    current: (text) => `Current version:\n${text}`,
    taskNow: (task) => `Your task now: ${task}`,
    reviewFormat: (marker) =>
      `Reply with the full revised text. Then, on a line of its own, write ${marker} and, below it, one note per line in the format:\nexcerpt from the revised text :: why you changed it`,
    draftFormat: "Reply with only the final text, ready to use.",
    task: (task) => `Your task: ${task}`,
    team: (lines) => `Your team:\n${lines}`,
    planFormat:
      'Split the work. Reply with ONLY JSON in the format {"tasks":[{"agent":"key","task":"what to do"}]}, using the keys above. Keep the JSON field names exactly as shown. Do not include yourself.',
    part: (task) => `Your part: ${task}`,
    contributionFormat: "Reply with your contribution, focused and well organized.",
    contribution: (by, text) => `Contribution from ${by}:\n${text}`,
    combineTask: "Put it all together.",
    resultFormat: "Reply with only the final result, ready to use.",
    helperRequest: (ask, agent, team) =>
      `${ask}\n\n(Requested by ${agent}, from the ${team} team.)`,
    chatSystem: (agent, role, team) =>
      `You are ${agent} (${role}) on the ${team} team. You're chatting in the team room, like in a work chat. Reply in 1 to 3 short sentences, in English, without Markdown.`,
    chat: (transcript) =>
      `Recent conversation:\n${transcript}\n\nReply to the last message that mentioned you.`,
    routerSystem:
      "You choose which team in an office should take a request. Reply with only the option number.",
    router: (prompt, options) => `Request: ${prompt}\n\nOptions:\n${options}`,
    routerOption: (n, playbook, team, description) =>
      `${n}. ${playbook} (${team} team): ${description}`,
  },
  toolResult: {
    unavailable: "Tool unavailable.",
    notOffered: "That tool isn't available to you.",
    refused: "The person in charge didn't allow this. Carry on without that tool.",
    helpFailed: "The other team couldn't help.",
    failed: (error) => `The tool failed: ${error}`,
    limit: "You've reached the tool limit. Deliver the final work now, without calls.",
  },
  tools: {
    webSearch: {
      label: "Search the web",
      description: 'Searches the web and returns a summary with sources. Input: {"query": "text"}.',
      example: "average price of residential solar panels 2026",
      missingQuery: "Provide a search query.",
      demoResults: (query) =>
        `Sample results for "${query}" (demo mode):\n- Beginner's guide to ${query} — example.com/guide\n- Frequently asked questions about ${query} — example.com/faq`,
      sources: "Sources",
    },
    githubRead: {
      label: "Read GitHub",
      description:
        'Reads a pull request: title, description and changes. Input: {"repo": "owner/repository", "pr": 123}.',
      missingTarget: "Provide the repo (owner/name) and the PR number.",
      noDiff: "(no diff)",
      author: "Author",
      demo: (pr, repo) =>
        `PR #${pr} in ${repo} (demo mode sample): changes form validation and adds a test.`,
      failed: (error) =>
        `Couldn't read the PR: ${error}. Is it private? Connect GitHub in Integrations.`,
      githubStatus: (status) => `GitHub responded with ${status}`,
    },
    githubComment: {
      label: "Comment on GitHub",
      description:
        'Posts a comment on a pull request. Input: {"repo": "owner/repository", "pr": 123, "comment": "text"}.',
      example: "Review summary…",
      missingInput: "Provide repo, pr and comment.",
      simulated: "Simulated comment (demo mode): nothing was posted to GitHub.",
      posted: (url) => `Comment posted: ${url}`,
    },
    askForHelp: {
      label: "Ask another team for help",
      description: (teams) =>
        `Asks another team in the office for something and waits for the answer. Teams: ${teams || "none"}. Input: {"team": "team-slug", "question": "what you need"}.`,
      exampleTeam: "other-team",
      example: "I need current prices for…",
      missingInput: "Provide the team and the question.",
      unknownTeam: (team) => `Couldn't find the team "${team}".`,
    },
    githubMerge: {
      label: "Merge on GitHub",
      description: "Merges a pull request.",
      never: "squadai doesn't merge.",
    },
    mcp: {
      description: (description, server) =>
        `${description} (MCP server ${server}). Input: the tool's arguments as JSON.`,
      error: (text) => `Error: ${text}`,
    },
  },
};

const WORDS: Record<Locale, Words> = { "pt-BR": PT_BR, en: EN };

/** The engine's words in a workspace language. */
export function wordsFor(locale: Locale): Words {
  return WORDS[locale];
}
