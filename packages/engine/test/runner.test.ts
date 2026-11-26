/**
 * End-to-end runs against a real Postgres with the demo model.
 * Skipped without DATABASE_URL (CI provides one).
 */
import { randomUUID } from "node:crypto";
import { getTeamTemplate } from "@squadai/catalog";
import { createDb, createWorkspaceForUser, getOfficeMetrics, hireTeam, schema } from "@squadai/db";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveDelivery,
  createRequest,
  decideToolApproval,
  loadModelContext,
  parsePlan,
  parseReview,
  postUserMessage,
  type RunInput,
  replyInRoom,
  requestChanges,
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
    expect(versions.map((v) => v.label)).toEqual(["rascunho · Téo", "revisão · Bia"]);
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
    const { messageId, mentionedAgentIds } = await postUserMessage(db, {
      workspaceId,
      teamId: teams.seo as string,
      userId,
      body: "@teo deixa o tom bem leve, tá?",
    });
    expect(mentionedAgentIds).toHaveLength(1);
    await replyInRoom(deps, { messageId, agentId: mentionedAgentIds[0] as string });
    const replies = await db
      .select()
      .from(schema.message)
      .where(eq(schema.message.authorAgentId, mentionedAgentIds[0] as string));
    expect(replies.some((m) => m.body.includes("Anotado"))).toBe(true);
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
    expect(versions.map((v) => v.label)).toEqual(["draft · Téo", "review · Bia"]);
    expect(versions[1]?.content).toContain("# Balcony gardens: the complete, no-fluff guide");
    const notes = await db
      .select()
      .from(schema.reviewNote)
      .where(eq(schema.reviewNote.versionId, versions[1]?.id as string));
    expect(notes.map((n) => n.body)).toContain("Made the sentence more concrete.");

    const [approval] = await db
      .select()
      .from(schema.approval)
      .where(eq(schema.approval.deliveryId, deliveryId));
    expect(approval?.question).toBe("The work is ready. Can I wrap it up?");
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
