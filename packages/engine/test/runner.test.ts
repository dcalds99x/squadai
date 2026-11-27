/**
 * End-to-end runs against a real Postgres with the demo model.
 * Skipped without DATABASE_URL (CI provides one).
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getTeamTemplate } from "@squadai/catalog";
import { createDb, createWorkspaceForUser, getOfficeMetrics, hireTeam, schema } from "@squadai/db";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveDelivery,
  cancelDelivery,
  checkScope,
  createRequest,
  decideToolApproval as decideApproval,
  decideToolApproval,
  defaultFlow,
  deleteDelivery,
  deleteTeam,
  loadModelContext,
  parseFlowPlan,
  parsePlan,
  parseReview,
  parseVerdict,
  postUserMessage,
  type RunInput,
  replyInRoom,
  requestChanges,
  resolveFlow,
  runRequest,
  scoreText,
  suggestRoutes,
} from "../src/index.ts";

const url = process.env.DATABASE_URL;

describe("parsers", () => {
  it("splits a review into text and notes", () => {
    const parsed = parseReview(
      "Final text\n---NOTES---\nexcerpt :: reason\nline without separator",
    );
    expect(parsed.text).toBe("Final text");
    expect(parsed.notes).toEqual([{ anchor: "excerpt", body: "reason" }]);
  });

  it("still reads reviews written with the legacy notes marker", () => {
    expect(parseReview("Final text\n---NOTAS---\nexcerpt :: reason").notes).toHaveLength(1);
  });

  it("reads a coordinator plan and ignores unknown agents", () => {
    const plan = parsePlan(
      'Ok! {"tasks":[{"agent":"nina","task":"Tests"},{"agent":"ze","task":"x"}]}',
      ["nina"],
    );
    expect(plan).toEqual([{ agentKey: "nina", task: "Tests" }]);
    expect(parsePlan("no json here", ["nina"])).toEqual([]);
  });

  it("still reads plans written with the legacy Portuguese keys", () => {
    expect(parsePlan('{"tarefas":[{"agente":"nina","tarefa":"Testes"}]}', ["nina"])).toEqual([
      { agentKey: "nina", task: "Testes" },
    ]);
  });

  it("reads a reviewer's verdict", () => {
    expect(parseVerdict("VERDICT: revise\nnotes")).toEqual({ revise: true, text: "notes" });
    expect(parseVerdict("**VERDICT**: approve\nText")).toEqual({ revise: false, text: "Text" });
    expect(parseVerdict("Just the text")).toEqual({ revise: false, text: "Just the text" });
  });

  it("fills in step kinds the way early playbooks meant them", () => {
    const kinds = (n: number) =>
      resolveFlow(Array.from({ length: n }, (_, i) => ({ agentKey: `a${i}`, task: "t" }))).map(
        (s) => s.kind,
      );
    expect(kinds(1)).toEqual(["draft"]);
    expect(kinds(2)).toEqual(["research", "draft"]);
    expect(kinds(3)).toEqual(["research", "draft", "review"]);
  });

  it("reads the lead's plan and keeps it safe", () => {
    const keys = ["lia", "teo", "bia"];
    expect(parseFlowPlan('{"fit":"out","reason":"Not our area."}', keys, "teo")).toEqual({
      fit: "out",
      reason: "Not our area.",
    });
    const plan = parseFlowPlan(
      JSON.stringify({
        fit: "in",
        title: "Launch email",
        steps: [
          { agent: "bia", kind: "review", task: "too early" },
          { agent: "lia", kind: "research", task: "Find facts" },
          { agent: "zed", kind: "draft", task: "unknown agent" },
          { agent: "teo", kind: "discuss", task: "Angle", with: ["lia", "teo", "zed"] },
          { agent: "teo", kind: "draft", task: "Write" },
          { agent: "bia", kind: "review", task: "Check", rounds: 9 },
        ],
      }),
      keys,
      "teo",
    );
    expect(plan).toEqual({
      fit: "in",
      title: "Launch email",
      steps: [
        { agentKey: "lia", kind: "research", task: "Find facts" },
        { agentKey: "teo", kind: "discuss", task: "Angle", with: ["lia"] },
        { agentKey: "teo", kind: "draft", task: "Write" },
        { agentKey: "bia", kind: "review", task: "Check", rounds: 3 },
      ],
    });
    // Nothing that writes: the lead writes.
    const research = parseFlowPlan(
      '{"fit":"in","title":"X","steps":[{"agent":"lia","kind":"research","task":"Look"}]}',
      keys,
      "teo",
    );
    expect(research?.fit === "in" && research.steps.map((s) => s.kind)).toEqual([
      "research",
      "draft",
    ]);
    expect(parseFlowPlan("no json", keys, "teo")).toBeNull();
    expect(defaultFlow(keys, "teo", "t").map((s) => `${s.agentKey}:${s.kind}`)).toEqual([
      "lia:research",
      "teo:draft",
      "bia:review",
    ]);
  });

  it("scores keywords and synonyms", () => {
    expect(
      scoreText("revisar o PR do checkout", "Revisar pull request código").score,
    ).toBeGreaterThan(0);
    expect(scoreText("um post para o blog", "Artigo para o blog").matched).toContain("blog");
    expect(scoreText("review the checkout PR", "Review a pull request").score).toBeGreaterThan(0);
    expect(scoreText("an article for the blog", "Blog post").matched).toContain("article");
  });
});

describe.skipIf(!url)("runner (Postgres + demo model)", () => {
  const db = createDb(url as string, { max: 3 });
  const userId = `engine-${randomUUID()}`;
  let workspaceId = "";
  const deps = {
    db,
    loadModels: (ws: string) => loadModelContext(db, ws, { masterKey: null }),
  };
  const teams: Record<string, string> = {};

  const playbookId = async (teamKey: string, key: string) => {
    const [pb] = await db
      .select()
      .from(schema.playbook)
      .where(
        and(eq(schema.playbook.teamId, teams[teamKey] as string), eq(schema.playbook.key, key)),
      );
    return pb?.id as string;
  };

  /** Runs a request and everything it triggers (helper teams, resumes), like the worker does. */
  const drain = async (first: RunInput) => {
    const queue: RunInput[] = [first];
    const outcomes: string[] = [];
    while (queue.length > 0) {
      const job = queue.shift() as RunInput;
      const result = await runRequest(deps, job);
      outcomes.push(result.outcome);
      queue.push(...result.followUps);
    }
    return outcomes;
  };

  const setDemo = (demoMode: boolean) =>
    db
      .update(schema.workspace)
      .set({ settings: { demoMode, locale: "pt-BR" } })
      .where(eq(schema.workspace.id, workspaceId));

  beforeAll(async () => {
    await db
      .insert(schema.user)
      .values({ id: userId, name: "Rita Prova", email: `${userId}@example.test` });
    ({ workspaceId } = await createWorkspaceForUser(db, {
      userId,
      userName: "Rita Prova",
      locale: "pt-BR",
    }));
    const [seo] = await db
      .select()
      .from(schema.team)
      .where(eq(schema.team.workspaceId, workspaceId));
    teams.seo = seo?.id as string;
    teams.research = (
      await hireTeam(db, { workspaceId, template: getTeamTemplate("market-research") })
    ).teamId;
    teams.code = (
      await hireTeam(db, { workspaceId, template: getTeamTemplate("code-review") })
    ).teamId;
    await setDemo(true);
  });

  afterAll(async () => {
    await db.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId));
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    await db.close();
  });

  it("fails politely when no provider is connected, then resumes", async () => {
    await setDemo(false);
    const { requestId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "newsletter"),
      userId,
      prompt: "Uma newsletter sobre horta em apartamento",
    });
    expect((await runRequest(deps, { requestId })).outcome).toBe("failed");
    const messages = await db
      .select()
      .from(schema.message)
      .where(eq(schema.message.requestId, requestId));
    expect(messages.some((m) => m.body.includes("Modelos e custos"))).toBe(true);

    await setDemo(true);
    expect((await runRequest(deps, { requestId })).outcome).toBe("awaiting_approval");
    expect(
      await db.select().from(schema.run).where(eq(schema.run.requestId, requestId)),
    ).toHaveLength(1);
  });

  it("runs a sequential playbook with tools, revisions and approval", async () => {
    const { requestId, deliveryId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "artigo-blog"),
      userId,
      prompt: "Preciso de um artigo sobre horta em apartamento",
    });
    expect(await drain({ requestId })).toEqual(["awaiting_approval"]);

    const versions = await db
      .select()
      .from(schema.deliveryVersion)
      .where(eq(schema.deliveryVersion.deliveryId, deliveryId))
      .orderBy(asc(schema.deliveryVersion.number));
    // Bia sends the first draft back once (review loop), then approves.
    expect(versions.map((v) => v.label)).toEqual([
      "rascunho · Téo",
      "ajuste · Téo",
      "revisão · Bia",
    ]);
    const messages = await db
      .select()
      .from(schema.message)
      .where(eq(schema.message.requestId, requestId));
    expect(messages.some((m) => m.body.includes("Pesquisar na internet"))).toBe(true);

    const change = await requestChanges(db, {
      workspaceId,
      deliveryId,
      userId,
      feedback: "Mais curto",
    });
    expect(await drain(change)).toEqual(["awaiting_approval"]);
    await approveDelivery(db, { workspaceId, deliveryId, userId });
    const [done] = await db
      .select()
      .from(schema.delivery)
      .where(eq(schema.delivery.id, deliveryId));
    expect(done?.adjustmentCount).toBe(1);
    expect((await getOfficeMetrics(db, workspaceId)).firstPassRate).toBe(0);
  });

  it("asks another team for help and resumes with their answer", async () => {
    const { requestId, deliveryId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "artigo-blog"),
      userId,
      prompt: "Preciso de um artigo sobre o preço de painel solar",
    });
    // origin waits → helper team delivers → origin resumes and finishes
    expect(await drain({ requestId })).toEqual(["waiting", "delivered", "awaiting_approval"]);

    const [h] = await db
      .select()
      .from(schema.handoff)
      .where(eq(schema.handoff.originRequestId, requestId));
    expect(h?.status).toBe("done");
    expect(h?.toTeamId).toBe(teams.research);
    const [del] = await db.select().from(schema.delivery).where(eq(schema.delivery.id, deliveryId));
    expect(del?.status).toBe("awaiting_approval");
  });

  it("runs parallel work and combines it", async () => {
    const { requestId, deliveryId } = await createRequest(db, {
      workspaceId,
      teamId: teams.research as string,
      playbookId: await playbookId("research", "analise-concorrentes"),
      userId,
      prompt: "Compare as lojas de café online",
    });
    expect(await drain({ requestId })).toEqual(["awaiting_approval"]);
    const steps = await db
      .select()
      .from(schema.step)
      .innerJoin(schema.run, eq(schema.run.id, schema.step.runId))
      .where(eq(schema.run.requestId, requestId));
    expect(steps.map((s) => s.step.input?.kind).sort()).toEqual([
      "contribution",
      "contribution",
      "synthesis",
    ]);
    const [v] = await db
      .select()
      .from(schema.deliveryVersion)
      .where(eq(schema.deliveryVersion.deliveryId, deliveryId));
    expect(v?.label).toBe("resultado · Clara");
  });

  it("coordinates, pauses for permission, and resumes", async () => {
    // Keep Nina offline so the test makes no network call to GitHub.
    const [nina] = await db
      .select()
      .from(schema.agent)
      .where(and(eq(schema.agent.teamId, teams.code as string), eq(schema.agent.key, "nina")));
    await db
      .update(schema.agentToolPolicy)
      .set({ policy: "deny" })
      .where(eq(schema.agentToolPolicy.agentId, nina?.id as string));

    const { requestId } = await createRequest(db, {
      workspaceId,
      teamId: teams.code as string,
      playbookId: await playbookId("code", "revisar-pr"),
      userId,
      prompt: "Revise o PR github.com/exemplo/loja/pull/7",
    });
    expect((await runRequest(deps, { requestId })).outcome).toBe("waiting");

    const [ask] = await db
      .select()
      .from(schema.approval)
      .where(
        and(
          eq(schema.approval.workspaceId, workspaceId),
          eq(schema.approval.kind, "tool"),
          eq(schema.approval.status, "pending"),
        ),
      );
    expect(ask?.payload?.tool).toBe("github_comment");

    const resume = await decideToolApproval(db, {
      workspaceId,
      approvalId: ask?.id as string,
      userId,
      allow: true,
    });
    expect((await runRequest(deps, resume)).outcome).toBe("awaiting_approval");
    const kinds = await db
      .select({ kind: schema.step.input })
      .from(schema.step)
      .innerJoin(schema.run, eq(schema.run.id, schema.step.runId))
      .where(eq(schema.run.requestId, requestId));
    expect(kinds.map((k) => k.kind?.kind).sort()).toEqual(["contribution", "plan", "synthesis"]);
  });

  it("stops when the monthly budget is used up", async () => {
    await db
      .update(schema.budget)
      .set({ monthlyLimitCents: 1 })
      .where(eq(schema.budget.workspaceId, workspaceId));
    await db
      .insert(schema.llmCall)
      .values({ workspaceId, provider: "anthropic", model: "x", costMicros: 20_000 });
    const { requestId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "newsletter"),
      userId,
      prompt: "Uma newsletter sobre o mês",
    });
    expect((await runRequest(deps, { requestId })).outcome).toBe("failed");
    const [r] = await db.select().from(schema.run).where(eq(schema.run.requestId, requestId));
    expect(r?.error).toContain("orçamento");
    await db
      .update(schema.budget)
      .set({ monthlyLimitCents: 10_000 })
      .where(eq(schema.budget.workspaceId, workspaceId));
  });

  it("suggests the right team for a request", async () => {
    const [code] = await suggestRoutes(db, workspaceId, "Pode revisar o pull request do checkout?");
    expect(code?.teamId).toBe(teams.code);
    const [blog] = await suggestRoutes(db, workspaceId, "Quero um post para o blog sobre plantas");
    expect(blog?.teamId).toBe(teams.seo);
  });

  it("lets a mentioned agent reply in the room", async () => {
    const { messageId, replyAgentIds } = await postUserMessage(db, {
      workspaceId,
      teamId: teams.seo as string,
      userId,
      body: "@teo deixa o tom bem leve, tá?",
    });
    expect(replyAgentIds).toHaveLength(1);
    await replyInRoom(deps, { messageId, agentId: replyAgentIds[0] as string });
    const replies = await db
      .select()
      .from(schema.message)
      .where(eq(schema.message.authorAgentId, replyAgentIds[0] as string));
    // The reply knows where the work stands (here, the latest delivery).
    expect(replies.some((m) => m.body.startsWith("Oi! Aqui é Téo. Sobre “"))).toBe(true);
  });

  it("has the team lead answer when nobody is mentioned", async () => {
    const { replyAgentNames } = await postUserMessage(db, {
      workspaceId,
      teamId: teams.seo as string,
      userId,
      body: "O que já está pronto até agora?",
    });
    expect(replyAgentNames).toEqual(["Téo"]);
  });
});

describe.skipIf(!url)("runner in an English workspace (Postgres + demo model)", () => {
  const db = createDb(url as string, { max: 3 });
  const userId = `engine-en-${randomUUID()}`;
  let workspaceId = "";
  const deps = {
    db,
    loadModels: (ws: string) => loadModelContext(db, ws, { masterKey: null }),
  };
  const teams: Record<string, string> = {};

  const playbookId = async (teamKey: string, key: string) => {
    const [pb] = await db
      .select()
      .from(schema.playbook)
      .where(
        and(eq(schema.playbook.teamId, teams[teamKey] as string), eq(schema.playbook.key, key)),
      );
    return pb?.id as string;
  };
  const roomLines = async (requestId: string) =>
    (
      await db
        .select({ body: schema.message.body })
        .from(schema.message)
        .where(eq(schema.message.requestId, requestId))
        .orderBy(asc(schema.message.createdAt))
    ).map((m) => m.body);

  beforeAll(async () => {
    await db
      .insert(schema.user)
      .values({ id: userId, name: "Sam Test", email: `${userId}@example.test` });
    ({ workspaceId } = await createWorkspaceForUser(db, {
      userId,
      userName: "Sam Test",
      locale: "en",
    }));
    const [seo] = await db
      .select()
      .from(schema.team)
      .where(eq(schema.team.workspaceId, workspaceId));
    teams.seo = seo?.id as string;
    teams.code = (
      await hireTeam(db, { workspaceId, template: getTeamTemplate("code-review") })
    ).teamId;
    await db
      .update(schema.workspace)
      .set({ settings: { demoMode: true, locale: "en" } })
      .where(eq(schema.workspace.id, workspaceId));
  });

  afterAll(async () => {
    await db.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId));
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    await db.close();
  });

  it("works, talks and writes in English", async () => {
    const { requestId, deliveryId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "artigo-blog"),
      userId,
      prompt: "I need a blog post about balcony gardens",
    });
    expect((await runRequest(deps, { requestId })).outcome).toBe("awaiting_approval");

    const lines = await roomLines(requestId);
    expect(lines[0]).toBe("New request (Blog post): I need a blog post about balcony gardens");
    expect(lines).toContain(
      "Starting the research: research the topic and list sources, common questions and keywords. I'll be back with what I find.",
    );
    expect(lines).toContain("Research done. Téo, over to you!");
    expect(lines).toContain("Using “Search the web”…");
    expect(lines.at(-1)).toBe("“A blog post about balcony gardens” is ready for you to review.");

    const versions = await db
      .select()
      .from(schema.deliveryVersion)
      .where(eq(schema.deliveryVersion.deliveryId, deliveryId))
      .orderBy(asc(schema.deliveryVersion.number));
    expect(versions.map((v) => v.label)).toEqual(["draft · Téo", "revision · Téo", "review · Bia"]);
    expect(versions[2]?.content).toContain("# Balcony gardens: the complete, no-fluff guide");
    expect(lines).toContain("Back to you, Téo: I left 1 note.");
    expect(lines).toContain("Got the notes. Reworking the text.");
    // Téo asks a teammate mid-draft, and the answer shows up in the room.
    expect(lines.some((l) => l.startsWith("Lia, quick question:"))).toBe(true);
    const notes = await db
      .select()
      .from(schema.reviewNote)
      .where(eq(schema.reviewNote.versionId, versions[2]?.id as string));
    expect(notes.map((n) => n.body)).toContain("Made the sentence more concrete.");

    const [approval] = await db
      .select()
      .from(schema.approval)
      .where(eq(schema.approval.deliveryId, deliveryId));
    expect(approval?.question).toBe("The work is ready. Can I wrap it up?");
  });

  it("lets the lead plan a request with no delivery type", async () => {
    const { requestId, deliveryId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      userId,
      prompt: "Write a launch email for our new balcony garden kit",
    });
    expect((await runRequest(deps, { requestId })).outcome).toBe("awaiting_approval");
    const [req] = await db.select().from(schema.request).where(eq(schema.request.id, requestId));
    expect(req?.playbookId).toBeNull();
    expect(req?.flow?.steps.map((s) => `${s.agentKey}:${s.kind}`)).toEqual([
      "lia:research",
      "teo:draft",
      "bia:review",
    ]);
    const [del] = await db.select().from(schema.delivery).where(eq(schema.delivery.id, deliveryId));
    expect(del?.kind).toBe(req?.flow?.title);
    const lines = await roomLines(requestId);
    expect(lines[0]).toBe(
      "New request (Open request): Write a launch email for our new balcony garden kit",
    );
    expect(lines).toContain("Reading the request to decide how we'll work on it.");
    expect(
      lines.some((l) =>
        l.endsWith("Lia researches → Téo writes → Bia reviews (up to 2 rounds) → you approve."),
      ),
    ).toBe(true);

    // A revision follows the same flow, without planning again.
    const change = await requestChanges(db, {
      workspaceId,
      deliveryId,
      userId,
      feedback: "Shorter, please",
    });
    expect((await runRequest(deps, change)).outcome).toBe("awaiting_approval");
    const planning = (await roomLines(requestId)).filter((l) =>
      l.startsWith("Reading the request"),
    );
    expect(planning).toHaveLength(1);
  });

  it("talks it over, stops at a checkpoint and goes on when you confirm", async () => {
    const { requestId, deliveryId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "estudo-caso"),
      userId,
      prompt: "A case study about a bakery that doubled online orders",
    });
    expect((await runRequest(deps, { requestId })).outcome).toBe("waiting");
    const [checkpoint] = await db
      .select()
      .from(schema.approval)
      .where(
        and(eq(schema.approval.deliveryId, deliveryId), eq(schema.approval.kind, "checkpoint")),
      );
    expect(checkpoint?.status).toBe("pending");
    let lines = await roomLines(requestId);
    expect(lines.some((l) => l.startsWith("Before we go on, let's talk it over"))).toBe(true);
    expect(lines).toContain("Settled. We'll go with what we agreed.");
    expect(lines.some((l) => l.startsWith("Before we go on, I need you to confirm"))).toBe(true);
    // Nothing is written before the person confirms.
    expect(
      await db
        .select()
        .from(schema.deliveryVersion)
        .where(eq(schema.deliveryVersion.deliveryId, deliveryId)),
    ).toHaveLength(0);

    const resume = await decideApproval(db, {
      workspaceId,
      approvalId: checkpoint?.id as string,
      userId,
      allow: true,
    });
    expect((await runRequest(deps, resume)).outcome).toBe("awaiting_approval");
    lines = await roomLines(requestId);
    expect(lines).toContain("You confirmed. Moving on.");
    expect(lines.at(-1)).toContain("is ready for you to review");
  });

  it("closes the request when you stop it at a checkpoint", async () => {
    const { requestId, deliveryId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "estudo-caso"),
      userId,
      prompt: "A case study about a gym that cut churn",
    });
    expect((await runRequest(deps, { requestId })).outcome).toBe("waiting");
    const [checkpoint] = await db
      .select()
      .from(schema.approval)
      .where(
        and(eq(schema.approval.deliveryId, deliveryId), eq(schema.approval.kind, "checkpoint")),
      );
    const resume = await decideApproval(db, {
      workspaceId,
      approvalId: checkpoint?.id as string,
      userId,
      allow: false,
    });
    expect((await runRequest(deps, resume)).outcome).toBe("cancelled");
    const [req] = await db.select().from(schema.request).where(eq(schema.request.id, requestId));
    expect(req?.status).toBe("cancelled");
    expect(await roomLines(requestId)).toContain("You asked to stop here. The request is closed.");
  });

  it("keeps teams on their own work and points to the right one", async () => {
    const offTopic = await checkScope(db, {
      workspaceId,
      teamId: teams.code as string,
      prompt: "Write a blog post about balcony gardens",
    });
    expect(offTopic.fit).toBe("out");
    expect(offTopic.alternatives[0]?.teamId).toBe(teams.seo);
    const onTopic = await checkScope(db, {
      workspaceId,
      teamId: teams.seo as string,
      prompt: "Write a blog post about balcony gardens",
    });
    expect(onTopic.fit).toBe("in");
    const fix = await checkScope(db, {
      workspaceId,
      teamId: teams.code as string,
      prompt: "Investigate the bug in the checkout tests",
    });
    expect(fix.fit).toBe("in");
    // "checkout" must not match "fact-checking" in the content team's skills.
    const code = await checkScope(db, {
      workspaceId,
      teamId: teams.seo as string,
      prompt: "Fix the bug in our checkout code",
    });
    expect(code.fit).toBe("out");
    expect(code.alternatives[0]?.teamId).toBe(teams.code);
    const newsletter = await checkScope(db, {
      workspaceId,
      teamId: teams.seo as string,
      prompt: "A newsletter about our checkout redesign",
    });
    expect(newsletter.fit).toBe("in");
  });

  it("coordinates in English, with the plan's protocol keys unchanged", async () => {
    // Keep Nina offline so the test makes no network call to GitHub.
    const [nina] = await db
      .select()
      .from(schema.agent)
      .where(and(eq(schema.agent.teamId, teams.code as string), eq(schema.agent.key, "nina")));
    await db
      .update(schema.agentToolPolicy)
      .set({ policy: "deny" })
      .where(eq(schema.agentToolPolicy.agentId, nina?.id as string));
    const { requestId } = await createRequest(db, {
      workspaceId,
      teamId: teams.code as string,
      playbookId: await playbookId("code", "revisar-pr"),
      userId,
      prompt: "Review the PR github.com/example/shop/pull/7",
    });
    // Rui asks before commenting on GitHub: the run pauses for a person.
    expect((await runRequest(deps, { requestId })).outcome).toBe("waiting");
    const lines = await roomLines(requestId);
    expect(lines).toContain("I'll split the work with the team.");
    expect(lines.some((l) => l.startsWith("Here's the plan: Nina takes “Look at"))).toBe(true);
    expect(lines.at(-1)).toBe(
      "I need your permission to use “Comment on GitHub”. You'll find it in Waiting on you.",
    );
  });

  it("never runs the same request twice at once", async () => {
    const slow = {
      db,
      loadModels: (ws: string) => loadModelContext(db, ws, { masterKey: null, demoDelayMs: 100 }),
    };
    const { requestId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "newsletter"),
      userId,
      prompt: "A newsletter about rooftop beehives",
    });
    // The same job delivered twice, picked up by two workers at the same moment.
    const outcomes = await Promise.all([
      runRequest(slow, { requestId }),
      runRequest(slow, { requestId }),
    ]);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(["awaiting_approval", "skipped"]);
    const runs = await db.select().from(schema.run).where(eq(schema.run.requestId, requestId));
    expect(runs).toHaveLength(1);
    const versions = await db
      .select()
      .from(schema.deliveryVersion)
      .innerJoin(schema.delivery, eq(schema.delivery.id, schema.deliveryVersion.deliveryId))
      .where(eq(schema.delivery.requestId, requestId));
    // Draft, rewrite after review notes, review: once each, not twice.
    expect(versions).toHaveLength(2);
  });

  it("resumes from the right step after the worker is killed mid-run", async () => {
    const { requestId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "artigo-blog"),
      userId,
      prompt: "A blog post about worm composting",
    });
    const stepsOf = () =>
      db
        .select({ id: schema.step.id, position: schema.step.position, status: schema.step.status })
        .from(schema.step)
        .innerJoin(schema.run, eq(schema.run.id, schema.step.runId))
        .where(eq(schema.run.requestId, requestId))
        .orderBy(asc(schema.step.position));

    // A real worker process, killed once research is done and the draft has begun.
    const fixture = fileURLToPath(new URL("./fixtures/run-request.ts", import.meta.url));
    const child = spawn(process.execPath, [fixture, requestId], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "ignore",
    });
    const deadline = Date.now() + 30_000;
    for (;;) {
      const steps = await stepsOf();
      if (steps[0]?.status === "done" && steps.length >= 2) break;
      if (Date.now() > deadline) throw new Error("the worker never got past research");
      await new Promise((r) => setTimeout(r, 50));
    }
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));

    const [crashed] = await db.select().from(schema.run).where(eq(schema.run.requestId, requestId));
    expect(crashed?.status).toBe("running");
    const research = (await stepsOf())[0];
    const callsFor = async (stepId: string) =>
      (await db.select().from(schema.llmCall).where(eq(schema.llmCall.stepId, stepId))).length;
    const researchCalls = await callsFor(research?.id as string);
    expect(researchCalls).toBeGreaterThan(0);

    // While the dead worker's lease lasts, a retry steps aside…
    expect((await runRequest(deps, { requestId })).outcome).toBe("skipped");
    // …and once it runs out (as when pg-boss retries the job), the run picks up where it was.
    await db
      .update(schema.run)
      .set({ leaseUntil: new Date(Date.now() - 1000) })
      .where(eq(schema.run.id, crashed?.id as string));
    expect((await runRequest(deps, { requestId })).outcome).toBe("awaiting_approval");

    expect(await callsFor(research?.id as string)).toBe(researchCalls);
    const runs = await db.select().from(schema.run).where(eq(schema.run.requestId, requestId));
    expect(runs).toHaveLength(1);
    expect((await stepsOf()).every((st) => st.status === "done")).toBe(true);
  }, 60_000);

  it("cancels a delivery: a running worker stops at its next step", async () => {
    const { requestId, deliveryId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "newsletter"),
      userId,
      prompt: "A newsletter about winter cycling",
    });
    const slow = {
      db,
      loadModels: (ws: string) => loadModelContext(db, ws, { masterKey: null, demoDelayMs: 300 }),
    };
    const running = runRequest(slow, { requestId });
    // Cancel once the run has started.
    for (let i = 0; i < 100; i++) {
      const [r] = await db.select().from(schema.run).where(eq(schema.run.requestId, requestId));
      if (r) break;
      await new Promise((done) => setTimeout(done, 20));
    }
    await cancelDelivery(db, { workspaceId, deliveryId, userId });
    expect((await running).outcome).toBe("cancelled");

    const [del] = await db.select().from(schema.delivery).where(eq(schema.delivery.id, deliveryId));
    expect(del?.status).toBe("cancelled");
    expect(await roomLines(requestId)).toContain(
      "You cancelled “A newsletter about winter cycling”. The team stopped that work.",
    );
    await expect(cancelDelivery(db, { workspaceId, deliveryId, userId })).rejects.toThrow(
      "delivery_closed",
    );
  });

  it("deletes a delivery with everything behind it", async () => {
    const { requestId, deliveryId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "newsletter"),
      userId,
      prompt: "A newsletter about bike lights",
    });
    await runRequest(deps, { requestId });
    await deleteDelivery(db, { workspaceId, deliveryId, userId });
    expect(
      await db.select().from(schema.request).where(eq(schema.request.id, requestId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.deliveryVersion)
        .where(eq(schema.deliveryVersion.deliveryId, deliveryId)),
    ).toHaveLength(0);
    expect(await roomLines(requestId)).toHaveLength(0);
  });

  it("removes a team, and a team waiting on its help carries on", async () => {
    const research = (
      await hireTeam(db, { workspaceId, template: getTeamTemplate("market-research") })
    ).teamId;
    const helper = await createRequest(db, {
      workspaceId,
      teamId: research,
      userId,
      prompt: "Current prices of e-bike batteries",
    });
    // Another team's request is waiting on this one.
    const origin = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "newsletter"),
      userId,
      prompt: "A newsletter about e-bike batteries",
    });
    await db.insert(schema.handoff).values({
      workspaceId,
      fromTeamId: teams.seo as string,
      toTeamId: research,
      ask: "Prices?",
      originRequestId: origin.requestId,
      helperRequestId: helper.requestId,
    });

    // Work the team did, with model calls tied to its agents, runs and steps.
    await runRequest(deps, { requestId: helper.requestId });
    const spend = async () =>
      (
        await db
          .select({ micros: schema.llmCall.costMicros })
          .from(schema.llmCall)
          .where(eq(schema.llmCall.workspaceId, workspaceId))
      ).length;
    const callsBefore = await spend();

    const { followUps } = await deleteTeam(db, { workspaceId, teamId: research, userId });
    // The cost ledger keeps every call.
    expect(await spend()).toBe(callsBefore);
    expect(followUps).toEqual([{ requestId: origin.requestId }]);
    expect(await db.select().from(schema.team).where(eq(schema.team.id, research))).toHaveLength(0);
    expect(
      await db.select().from(schema.request).where(eq(schema.request.id, helper.requestId)),
    ).toHaveLength(0);
    // Its department ("Research") went with it: nothing else was in it.
    const departments = await db
      .select({ name: schema.department.name })
      .from(schema.department)
      .where(eq(schema.department.workspaceId, workspaceId));
    expect(departments.map((d) => d.name)).not.toContain("Research");
  });

  it("explains failures in English", async () => {
    await db
      .update(schema.workspace)
      .set({ settings: { demoMode: false, locale: "en" } })
      .where(eq(schema.workspace.id, workspaceId));
    const { requestId } = await createRequest(db, {
      workspaceId,
      teamId: teams.seo as string,
      playbookId: await playbookId("seo", "newsletter"),
      userId,
      prompt: "A newsletter about the month",
    });
    expect((await runRequest(deps, { requestId })).outcome).toBe("failed");
    expect((await roomLines(requestId)).at(-1)).toBe(
      "The team got stuck: The anthropic provider isn't connected. Connect it in Models & costs.",
    );
  });
});
