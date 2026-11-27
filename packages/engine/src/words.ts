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
    cancelled: (title: string) => `Você cancelou ${quote(title)}. O time parou esse trabalho.`,
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
      `Você é ${agent} (${role}) no time ${team}, com experiência sênior, fazendo trabalho de verdade para um cliente. Responda sempre em português do Brasil, em Markdown.

Como você trabalha:
- Faça o trabalho nesta resposta. Nunca diga o que vai fazer depois, nunca peça mais informações a quem pediu e nunca se recuse por falta de algo: assuma o que for razoável, diga a suposição em uma linha e entregue.
- Traga trabalho específico e substancial, de especialista: exemplos concretos, nomes, números de que você tem segurança e estrutura clara. Marque o que precisa ser conferido em vez de deixar de fora.
- Se o material de um colega vier fraco ou faltando, complete com a sua experiência. Não comente sobre o processo nem sobre o time.`,
    request: (prompt: string) => `Pedido de quem está no comando:\n${prompt}`,
    feedback: (feedback: string) => `Ajuste pedido depois da última versão:\n${feedback}`,
    research: (by: string, text: string) => `Pesquisa de ${by}:\n${text}`,
    toReview: (text: string) => `Texto para revisar:\n${text}`,
    current: (text: string) => `Versão atual:\n${text}`,
    taskNow: (task: string) => `Sua tarefa agora: ${task}`,
    reviewFormat: (marker: string) =>
      `Responda com o texto revisado completo: melhore, não encurte, e mantenha pelo menos o mesmo nível de detalhe. Depois, numa linha sozinha, escreva ${marker} e, abaixo, uma nota por linha no formato:\ntrecho do texto revisado :: por que você mudou`,
    draftFormat:
      "Responda apenas com a entrega completa, pronta para usar. Faça um trabalho profundo e específico para este pedido: seções completas, exemplos concretos e conteúdo de verdade, não um esboço (a não ser que tenham pedido um esboço).",
    researchFormat:
      "Entregue a pesquisa agora, com o que você sabe e com as ferramentas que tiver: fatos principais, ângulos, exemplos, públicos e fontes (com links quando souber), organizados em seções. Ao lado do que não deu para confirmar, diga isso. É o material de onde um especialista vai escrever, então traga tudo o que for útil.",
    task: (task: string) => `Sua tarefa: ${task}`,
    team: (lines: string) => `Seu time:\n${lines}`,
    planFormat:
      'Divida o trabalho. Responda SOMENTE com JSON no formato {"tasks":[{"agent":"chave","task":"o que fazer"}]}, usando as chaves acima. Mantenha os nomes dos campos do JSON exatamente como estão. Não inclua você mesmo.',
    part: (task: string) => `Sua parte: ${task}`,
    contributionFormat:
      "Responda com a sua contribuição completa: específica, substancial e organizada, com exemplos concretos.",
    contribution: (by: string, text: string) => `Contribuição de ${by}:\n${text}`,
    combineTask: "Junte tudo.",
    resultFormat:
      "Responda apenas com o resultado final completo, pronto para usar: profundo, específico para o pedido e bem estruturado.",
    helperRequest: (ask: string, agent: string, team: string) =>
      `${ask}\n\n(Pedido de ${agent}, do time ${team}.)`,
    chatSystem: (agent: string, role: string, team: string) =>
      `Você é ${agent} (${role}) no time ${team}. Está conversando na sala do time, como num chat de trabalho com quem pediu o trabalho. Responda de forma natural e útil, em até 6 frases, em português do Brasil, sem títulos. Use o andamento do trabalho abaixo para responder sobre ele com honestidade: o que está pronto, o que falta e o que a pessoa precisa fazer. Se pedirem um trabalho novo, diga para usar a caixa de pedido do time.`,
    chat: (transcript: string, status: string) =>
      `Andamento do trabalho do time:\n${status || "(nenhum pedido ainda)"}\n\nConversa recente:\n${transcript}\n\nResponda à última mensagem da pessoa.`,
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
    askTeammate: {
      label: "Perguntar a um colega",
      description: (teammates: string) =>
        `Faz uma pergunta rápida a um colega do seu time e recebe a resposta na hora. Colegas: ${teammates || "nenhum"}. Entrada: {"teammate": "chave", "question": "sua pergunta"}.`,
      example: "O que você acha deste título?",
      missingInput: "Informe o colega e a pergunta.",
      unknownTeammate: (key: string) => `Não encontrei o colega "${key}" no seu time.`,
      failed: (reason: string) => `O colega não conseguiu responder: ${reason}`,
    },
    mcp: {
      description: (description: string, server: string) =>
        `${description} (servidor MCP ${server}). Entrada: os argumentos da ferramenta em JSON.`,
      error: (text: string) => `Erro: ${text}`,
    },
  },
  /** Free-form requests, flows, scope and talking to teammates. */
  flow: {
    customKind: "Pedido livre",
    planning: "Vou ler o pedido e decidir como o time vai trabalhar.",
    plan: (title: string, steps: string[]) => `Plano para ${quote(title)}: ${steps.join(" → ")}.`,
    step: {
      research: (agent: string) => `${agent} pesquisa`,
      draft: (agent: string) => `${agent} escreve`,
      review: (agent: string, rounds: number) =>
        rounds > 1 ? `${agent} revisa (até ${rounds} rodadas)` : `${agent} revisa`,
      discuss: (agents: string) => `${agents} conversam`,
      checkpoint: "você confirma",
      approve: "você aprova",
    },
    outOfScope: (team: string, reason: string) =>
      `Isso foge do que o time ${team} faz${reason ? `: ${lowerFirst(reason).replace(/\.$/, "")}` : ""}.`,
    tryInstead: (who: string) => `Quem pode ajudar: ${who}.`,
    teamWithAgent: (team: string, agent: string) => `time ${team} (${agent})`,
    teamOnly: (team: string) => `time ${team}`,
    sentBack: (writer: string, notes: number) =>
      notes > 0
        ? `Voltando para você, ${writer}: deixei ${notes} ${notes === 1 ? "nota" : "notas"}.`
        : `Voltando para você, ${writer}: dá para melhorar.`,
    reworking: "Recebi as notas. Ajustando o texto.",
    discussOpen: (task: string) => `Antes de seguir, vamos conversar: ${lowerFirst(task)}`,
    discussClosed: "Fechado. Seguimos com o que combinamos.",
    checkpointAsk: (task: string) =>
      `Antes de seguir, preciso da sua confirmação: ${lowerFirst(task)} Está em Esperando você.`,
    checkpointContinue: "Você confirmou. Seguindo.",
    checkpointStop: "Você pediu para parar aqui. O pedido foi encerrado.",
    askTeammate: (teammate: string, question: string) => `${teammate}, uma pergunta: ${question}`,
  },
  scopePrompt: {
    system: (does: string, doesNot: string, others: string) =>
      [
        does ? `O que o seu time faz: ${does}.` : "",
        doesNot ? `O que o seu time não faz: ${doesNot}.` : "",
        `Se pedirem algo fora disso, não faça: diga com educação que foge do que o time faz e indique quem pode ajudar${others ? ` (${others})` : ""}.`,
      ]
        .filter(Boolean)
        .join(" "),
    classifierSystem:
      "Você decide se um pedido cabe no trabalho de um time. Responda SOMENTE com JSON.",
    classifier: (prompt: string, team: string, scope: string, teams: string) =>
      `Pedido: ${prompt}\n\nTime escolhido: ${team}\n${scope}\n\nOutros times:\n${teams || "nenhum"}\n\nResponda {"fit":"in" ou "out","reason":"uma frase curta","better":"slug do time mais indicado ou none"}. Use "out" só quando o pedido claramente não tem relação com o trabalho do time.`,
    teamLine: (slug: string, name: string, description: string) =>
      `- ${slug}: ${name}. ${description}`,
    scopeLines: (does: string, doesNot: string) =>
      `Faz: ${does || "(ver descrição)"}\nNão faz: ${doesNot || "(nada listado)"}`,
  },
  flowPrompt: {
    triage: (prompt: string, team: string, roster: string, scope: string) =>
      [
        `Pedido de quem está no comando:\n${prompt}`,
        `Você lidera o time ${team}.\n${scope}`,
        `Seu time:\n${roster}`,
        'Decida como o time vai trabalhar nesse pedido. Responda SOMENTE com JSON no formato {"fit":"in","title":"nome curto da entrega","steps":[{"agent":"chave","kind":"research|draft|review|discuss|checkpoint","task":"o que fazer","with":["chave"],"rounds":2}]}.',
        "Regras: use só as chaves acima; 2 a 6 passos; pelo menos um passo draft; review vem depois de um draft e pode ter rounds 1 a 3; discuss precisa de with; checkpoint só quando faz sentido confirmar algo com a pessoa antes de escrever.",
        'Se o pedido não tem relação com o trabalho do time, responda {"fit":"out","reason":"por quê, em uma frase"}. Mantenha os nomes dos campos do JSON exatamente como estão.',
      ].join("\n\n"),
    roster: (key: string, name: string, role: string, skills: string) =>
      `- ${key}: ${name}, ${role}${skills ? ` (${skills})` : ""}`,
    discussion: (task: string, transcript: string) =>
      [
        `O time está conversando antes de seguir. Assunto: ${task}`,
        transcript ? `O que já foi dito:\n${transcript}` : "",
        "Dê a sua visão em 2 ou 3 frases, sem Markdown. Concorde, discorde ou acrescente.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    discussionSummary: (task: string, transcript: string) =>
      `Assunto: ${task}\n\nConversa:\n${transcript}\n\nResuma em tópicos curtos o que o time combinou e o que fica para os próximos passos.`,
    decisions: (by: string, text: string) => `O que o time combinou (resumo de ${by}):\n${text}`,
    verdict:
      "Comece com uma linha sozinha: VERDICT: approve, se o texto já pode seguir, ou VERDICT: revise, se o autor deve reescrever. Mantenha a palavra VERDICT e os valores em inglês.",
    reviewerNotes: (by: string, notes: string) =>
      `Notas de ${by} sobre a versão anterior. Reescreva o texto completo levando cada uma em conta:\n${notes}`,
    teammateSystem: (agent: string, role: string, team: string) =>
      `Você é ${agent} (${role}) no time ${team}. Um colega fez uma pergunta rápida no meio do trabalho. Responda direto, em até 5 frases, em português do Brasil.`,
    teammateQuestion: (from: string, question: string, request: string) =>
      `Pedido em que o time está trabalhando:\n${request}\n\nPergunta de ${from}: ${question}`,
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
    cancelled: (title) => `You cancelled ${quote(title)}. The team stopped that work.`,
  },
  approval: {
    tool: (agent, tool) => `${agent} wants to use ${quote(tool)}.`,
    delivery: "The work is ready. Can I wrap it up?",
  },
  version: { draft: "draft", review: "review", adjustment: "revision", result: "result" },
  fallbackName: { colleague: "Teammate", system: "System" },
  prompt: {
    system: (agent, role, team) =>
      `You are ${agent} (${role}) on the ${team} team: a senior professional doing real work for a client. Always reply in English, in Markdown.

How you work:
- Do the work in this reply. Never say what you will do later, never ask the requester for more information, and never refuse because something is missing: make sensible assumptions, state them in one line, and deliver.
- Be specific and substantial, like an expert colleague: concrete examples, names, numbers you are confident about, and clear structure. Flag claims that need checking instead of leaving them out.
- If a teammate's input is thin or missing, fill the gap from your own expertise. Don't comment on the process or the team.`,
    request: (prompt) => `Request from the person in charge:\n${prompt}`,
    feedback: (feedback) => `Changes requested after the last version:\n${feedback}`,
    research: (by, text) => `Research by ${by}:\n${text}`,
    toReview: (text) => `Text to review:\n${text}`,
    current: (text) => `Current version:\n${text}`,
    taskNow: (task) => `Your task now: ${task}`,
    reviewFormat: (marker) =>
      `Reply with the full revised text: improve it, don't shorten it, and keep at least the same level of detail. Then, on a line of its own, write ${marker} and, below it, one note per line in the format:\nexcerpt from the revised text :: why you changed it`,
    draftFormat:
      "Reply with only the complete deliverable, ready to use. Make it thorough and specific to this request: full sections, concrete examples and real substance, not an outline (unless an outline was asked for).",
    researchFormat:
      "Deliver your research now, from what you know and any tools you have: key facts, angles, examples, audiences and sources (with links when you know them), organized under headings. Say so next to anything you couldn't verify. An expert will write from this, so be thorough.",
    task: (task) => `Your task: ${task}`,
    team: (lines) => `Your team:\n${lines}`,
    planFormat:
      'Split the work. Reply with ONLY JSON in the format {"tasks":[{"agent":"key","task":"what to do"}]}, using the keys above. Keep the JSON field names exactly as shown. Do not include yourself.',
    part: (task) => `Your part: ${task}`,
    contributionFormat:
      "Reply with your full contribution: specific, substantial and organized, with concrete examples.",
    contribution: (by, text) => `Contribution from ${by}:\n${text}`,
    combineTask: "Put it all together.",
    resultFormat:
      "Reply with only the complete final result, ready to use: thorough, specific to the request and well structured.",
    helperRequest: (ask, agent, team) =>
      `${ask}\n\n(Requested by ${agent}, from the ${team} team.)`,
    chatSystem: (agent, role, team) =>
      `You are ${agent} (${role}) on the ${team} team. You're chatting in the team room with the person you work for, like in a work chat. Reply naturally and helpfully, in up to 6 sentences, in English, without headings. Use the work status below to answer questions about it honestly: what is ready, what is left and what the person needs to do. If they ask for new work, tell them to use the team's request box.`,
    chat: (transcript, status) =>
      `Team work status:\n${status || "(no requests yet)"}\n\nRecent conversation:\n${transcript}\n\nReply to the person's last message.`,
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
    askTeammate: {
      label: "Ask a teammate",
      description: (teammates) =>
        `Asks someone on your team a quick question and gets the answer right away. Teammates: ${teammates || "none"}. Input: {"teammate": "key", "question": "your question"}.`,
      example: "What do you think of this headline?",
      missingInput: "Provide the teammate and the question.",
      unknownTeammate: (key) => `Couldn't find "${key}" on your team.`,
      failed: (reason) => `Your teammate couldn't answer: ${reason}`,
    },
    mcp: {
      description: (description, server) =>
        `${description} (MCP server ${server}). Input: the tool's arguments as JSON.`,
      error: (text) => `Error: ${text}`,
    },
  },
  flow: {
    customKind: "Open request",
    planning: "Reading the request to decide how we'll work on it.",
    plan: (title, steps) => `Plan for ${quote(title)}: ${steps.join(" → ")}.`,
    step: {
      research: (agent) => `${agent} researches`,
      draft: (agent) => `${agent} writes`,
      review: (agent, rounds) =>
        rounds > 1 ? `${agent} reviews (up to ${rounds} rounds)` : `${agent} reviews`,
      discuss: (agents) => `${agents} talk it over`,
      checkpoint: "you confirm",
      approve: "you approve",
    },
    outOfScope: (team, reason) =>
      `That's outside what the ${team} team does${reason ? `: ${lowerFirst(reason).replace(/\.$/, "")}` : ""}.`,
    tryInstead: (who) => `Who can help: ${who}.`,
    teamWithAgent: (team, agent) => `the ${team} team (${agent})`,
    teamOnly: (team) => `the ${team} team`,
    sentBack: (writer, notes) =>
      notes > 0
        ? `Back to you, ${writer}: I left ${notes} ${notes === 1 ? "note" : "notes"}.`
        : `Back to you, ${writer}: this can be better.`,
    reworking: "Got the notes. Reworking the text.",
    discussOpen: (task) => `Before we go on, let's talk it over: ${lowerFirst(task)}`,
    discussClosed: "Settled. We'll go with what we agreed.",
    checkpointAsk: (task) =>
      `Before we go on, I need you to confirm: ${lowerFirst(task)} It's in Waiting on you.`,
    checkpointContinue: "You confirmed. Moving on.",
    checkpointStop: "You asked to stop here. The request is closed.",
    askTeammate: (teammate, question) => `${teammate}, quick question: ${question}`,
  },
  scopePrompt: {
    system: (does, doesNot, others) =>
      [
        does ? `What your team does: ${does}.` : "",
        doesNot ? `What your team doesn't do: ${doesNot}.` : "",
        `If someone asks for something outside that, don't do it: say politely that it's outside what the team does and point to who can help${others ? ` (${others})` : ""}.`,
      ]
        .filter(Boolean)
        .join(" "),
    classifierSystem: "You decide whether a request fits a team's work. Reply ONLY with JSON.",
    classifier: (prompt, team, scope, teams) =>
      `Request: ${prompt}\n\nChosen team: ${team}\n${scope}\n\nOther teams:\n${teams || "none"}\n\nReply {"fit":"in" or "out","reason":"one short sentence","better":"slug of the best team, or none"}. Use "out" only when the request clearly has nothing to do with the team's work.`,
    teamLine: (slug, name, description) => `- ${slug}: ${name}. ${description}`,
    scopeLines: (does, doesNot) =>
      `Does: ${does || "(see description)"}\nDoesn't do: ${doesNot || "(nothing listed)"}`,
  },
  flowPrompt: {
    triage: (prompt, team, roster, scope) =>
      [
        `Request from the person in charge:\n${prompt}`,
        `You lead the ${team} team.\n${scope}`,
        `Your team:\n${roster}`,
        'Decide how the team will work on this request. Reply ONLY with JSON in the format {"fit":"in","title":"short name for the delivery","steps":[{"agent":"key","kind":"research|draft|review|discuss|checkpoint","task":"what to do","with":["key"],"rounds":2}]}.',
        "Rules: use only the keys above; 2 to 6 steps; at least one draft step; review comes after a draft and may have rounds 1 to 3; discuss needs with; use checkpoint only when it makes sense to confirm something with the person before writing.",
        'If the request has nothing to do with the team\'s work, reply {"fit":"out","reason":"why, in one sentence"}. Keep the JSON field names exactly as they are.',
      ].join("\n\n"),
    roster: (key, name, role, skills) =>
      `- ${key}: ${name}, ${role}${skills ? ` (${skills})` : ""}`,
    discussion: (task, transcript) =>
      [
        `The team is talking it over before going on. Topic: ${task}`,
        transcript ? `What has been said:\n${transcript}` : "",
        "Give your view in 2 or 3 sentences, no Markdown. Agree, disagree or add something.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    discussionSummary: (task, transcript) =>
      `Topic: ${task}\n\nConversation:\n${transcript}\n\nSum up in short bullets what the team agreed and what it means for the next steps.`,
    decisions: (by, text) => `What the team agreed (summed up by ${by}):\n${text}`,
    verdict:
      "Start with a line on its own: VERDICT: approve, if the text can go on, or VERDICT: revise, if the author should rewrite it.",
    reviewerNotes: (by, notes) =>
      `${by}'s notes on the previous version. Rewrite the full text taking each one into account:\n${notes}`,
    teammateSystem: (agent, role, team) =>
      `You are ${agent} (${role}) on the ${team} team. A teammate asked a quick question in the middle of the work. Answer directly, in at most 5 sentences, in English.`,
    teammateQuestion: (from, question, request) =>
      `Request the team is working on:\n${request}\n\nQuestion from ${from}: ${question}`,
  },
};

const WORDS: Record<Locale, Words> = { "pt-BR": PT_BR, en: EN };

/** The engine's words in a workspace language. */
export function wordsFor(locale: Locale): Words {
  return WORDS[locale];
}
