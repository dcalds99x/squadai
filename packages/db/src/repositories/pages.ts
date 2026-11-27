/**
 * Read models for the screens. Each function returns exactly what one screen
 * needs, scoped to a workspace, so pages never assemble queries themselves.
 */
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "../client.ts";
import {
  agent,
  agentToolPolicy,
  approval,
  budget,
  delivery,
  deliveryVersion,
  department,
  llmCall,
  message,
  playbook,
  providerCredential,
  request,
  reviewNote,
  room,
  run,
  step,
  team,
  user,
  workspace,
} from "../schema/index.ts";

const monthStart = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Agents with a step running right now, and what they are doing. */
export async function getPresence(db: DbOrTx, workspaceId: string) {
  const rows = await db
    .select({
      agentId: step.agentId,
      task: sql<string>`${step.input}->>'task'`,
      title: delivery.title,
    })
    .from(step)
    .innerJoin(run, eq(run.id, step.runId))
    .innerJoin(request, eq(request.id, run.requestId))
    .innerJoin(delivery, eq(delivery.requestId, request.id))
    .where(and(eq(request.workspaceId, workspaceId), eq(step.status, "running")));
  return new Map(
    rows
      .filter((r) => r.agentId)
      .map((r) => [r.agentId as string, { task: r.task, title: r.title }]),
  );
}

export async function getPendingApprovals(db: DbOrTx, workspaceId: string) {
  return db
    .select({
      id: approval.id,
      createdAt: approval.createdAt,
      question: approval.question,
      approvalKind: approval.kind,
      payload: approval.payload,
      deliveryId: delivery.id,
      title: delivery.title,
      kind: delivery.kind,
      teamName: team.name,
      teamSlug: team.slug,
      agentName: agent.name,
      avatar: agent.avatar,
    })
    .from(approval)
    .innerJoin(delivery, eq(delivery.id, approval.deliveryId))
    .innerJoin(team, eq(team.id, delivery.teamId))
    .leftJoin(agent, eq(agent.id, approval.requestedByAgentId))
    .where(and(eq(approval.workspaceId, workspaceId), eq(approval.status, "pending")))
    .orderBy(asc(approval.createdAt));
}

/** Teams with their playbooks, for the request composer. */
export async function getRequestOptions(db: DbOrTx, workspaceId: string) {
  const rows = await db
    .select({
      teamId: team.id,
      teamName: team.name,
      playbookId: playbook.id,
      playbookName: playbook.name,
      description: playbook.description,
    })
    .from(playbook)
    .innerJoin(team, eq(team.id, playbook.teamId))
    .where(eq(team.workspaceId, workspaceId))
    .orderBy(asc(team.createdAt), asc(playbook.position));
  const teams = new Map<
    string,
    { id: string; name: string; playbooks: { id: string; name: string; description: string }[] }
  >();
  for (const r of rows) {
    const t = teams.get(r.teamId) ?? { id: r.teamId, name: r.teamName, playbooks: [] };
    t.playbooks.push({ id: r.playbookId, name: r.playbookName, description: r.description });
    teams.set(r.teamId, t);
  }
  return [...teams.values()];
}

export async function getRoomMessages(db: DbOrTx, roomId: string, limit = 80) {
  const rows = await db
    .select({
      id: message.id,
      kind: message.kind,
      body: message.body,
      payload: message.payload,
      createdAt: message.createdAt,
      agentId: agent.id,
      agentName: agent.name,
      avatar: agent.avatar,
      userName: user.name,
    })
    .from(message)
    .leftJoin(agent, eq(agent.id, message.authorAgentId))
    .leftJoin(user, eq(user.id, message.authorUserId))
    .where(eq(message.roomId, roomId))
    .orderBy(desc(message.createdAt))
    .limit(limit);
  return rows.reverse();
}

/** The team page: deliveries board, people, playbooks and the room. */
export async function getTeamBoard(db: DbOrTx, workspaceId: string, slug: string) {
  const [t] = await db
    .select({
      id: team.id,
      slug: team.slug,
      name: team.name,
      description: team.description,
      color: team.color,
      leadKey: team.leadKey,
      scope: team.scope,
      department: department.name,
      roomId: room.id,
    })
    .from(team)
    .innerJoin(department, eq(department.id, team.departmentId))
    .innerJoin(room, eq(room.teamId, team.id))
    .where(and(eq(team.workspaceId, workspaceId), eq(team.slug, slug)));
  if (!t) return null;

  const [agents, playbooks, deliveries, messages, presence] = await Promise.all([
    db
      .select({
        id: agent.id,
        key: agent.key,
        name: agent.name,
        role: agent.role,
        bio: agent.bio,
        avatar: agent.avatar,
      })
      .from(agent)
      .where(eq(agent.teamId, t.id))
      .orderBy(asc(agent.position)),
    db
      .select({
        id: playbook.id,
        key: playbook.key,
        name: playbook.name,
        description: playbook.description,
        mode: playbook.mode,
        requiresApproval: playbook.requiresApproval,
        steps: playbook.steps,
      })
      .from(playbook)
      .where(eq(playbook.teamId, t.id))
      .orderBy(asc(playbook.position)),
    db
      .select({
        id: delivery.id,
        title: delivery.title,
        kind: delivery.kind,
        status: delivery.status,
        adjustmentCount: delivery.adjustmentCount,
        createdAt: delivery.createdAt,
        deliveredAt: delivery.deliveredAt,
        requestId: request.id,
        requestStatus: request.status,
        error: sql<
          string | null
        >`(select ${run.error} from ${run} where ${run.requestId} = ${request.id} order by ${run.createdAt} desc limit 1)`,
        versions: sql<number>`(select count(*)::int from ${deliveryVersion} where ${deliveryVersion.deliveryId} = ${delivery.id})`,
      })
      .from(delivery)
      .innerJoin(request, eq(request.id, delivery.requestId))
      .where(eq(delivery.teamId, t.id))
      .orderBy(desc(delivery.createdAt))
      .limit(60),
    getRoomMessages(db, t.roomId),
    getPresence(db, workspaceId),
  ]);

  return { ...t, agents, playbooks, deliveries, messages, presence };
}

export async function getDeliveryPage(db: DbOrTx, workspaceId: string, deliveryId: string) {
  const [d] = await db
    .select({
      id: delivery.id,
      title: delivery.title,
      kind: delivery.kind,
      status: delivery.status,
      adjustmentCount: delivery.adjustmentCount,
      createdAt: delivery.createdAt,
      deliveredAt: delivery.deliveredAt,
      requestId: request.id,
      prompt: request.prompt,
      requestStatus: request.status,
      teamId: team.id,
      teamName: team.name,
      teamSlug: team.slug,
    })
    .from(delivery)
    .innerJoin(request, eq(request.id, delivery.requestId))
    .innerJoin(team, eq(team.id, delivery.teamId))
    .where(and(eq(delivery.id, deliveryId), eq(team.workspaceId, workspaceId)));
  if (!d) return null;

  const versions = await db
    .select({
      id: deliveryVersion.id,
      number: deliveryVersion.number,
      label: deliveryVersion.label,
      content: deliveryVersion.content,
      createdAt: deliveryVersion.createdAt,
      agentName: agent.name,
      avatar: agent.avatar,
    })
    .from(deliveryVersion)
    .leftJoin(agent, eq(agent.id, deliveryVersion.authorAgentId))
    .where(eq(deliveryVersion.deliveryId, d.id))
    .orderBy(asc(deliveryVersion.number));

  const versionIds = versions.map((v) => v.id);
  const [notes, credits, thread] = await Promise.all([
    versionIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            versionId: reviewNote.versionId,
            anchor: reviewNote.anchor,
            body: reviewNote.body,
            agentName: agent.name,
            avatar: agent.avatar,
          })
          .from(reviewNote)
          .leftJoin(agent, eq(agent.id, reviewNote.agentId))
          .where(inArray(reviewNote.versionId, versionIds)),
    db
      .select({
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        avatar: agent.avatar,
        models: sql<string>`string_agg(distinct ${llmCall.model}, ', ')`,
        calls: sql<number>`count(*)::int`,
        costMicros: sql<number>`sum(${llmCall.costMicros})::int`,
        latencyMs: sql<number>`sum(${llmCall.latencyMs})::int`,
      })
      .from(llmCall)
      .innerJoin(run, eq(run.id, llmCall.runId))
      .innerJoin(agent, eq(agent.id, llmCall.agentId))
      .where(eq(run.requestId, d.requestId))
      .groupBy(agent.id, agent.name, agent.role, agent.avatar, agent.position)
      .orderBy(asc(agent.position)),
    db
      .select({
        id: message.id,
        kind: message.kind,
        body: message.body,
        createdAt: message.createdAt,
        agentName: agent.name,
        avatar: agent.avatar,
        userName: user.name,
      })
      .from(message)
      .leftJoin(agent, eq(agent.id, message.authorAgentId))
      .leftJoin(user, eq(user.id, message.authorUserId))
      .where(eq(message.requestId, d.requestId))
      .orderBy(asc(message.createdAt)),
  ]);

  return { ...d, versions, notes, credits, thread };
}

export async function getAgentProfile(db: DbOrTx, workspaceId: string, agentId: string) {
  const [a] = await db
    .select({
      id: agent.id,
      key: agent.key,
      name: agent.name,
      role: agent.role,
      bio: agent.bio,
      skills: agent.skills,
      prefers: agent.prefers,
      never: agent.never,
      instructions: agent.instructions,
      avatar: agent.avatar,
      tier: agent.tier,
      model: agent.model,
      fallbackModel: agent.fallbackModel,
      style: agent.style,
      teamName: team.name,
      teamSlug: team.slug,
    })
    .from(agent)
    .innerJoin(team, eq(team.id, agent.teamId))
    .where(and(eq(agent.id, agentId), eq(agent.workspaceId, workspaceId)));
  if (!a) return null;

  const since = monthStart();
  const [tools, stats, recent] = await Promise.all([
    db
      .select({ tool: agentToolPolicy.tool, policy: agentToolPolicy.policy })
      .from(agentToolPolicy)
      .where(eq(agentToolPolicy.agentId, a.id))
      .orderBy(asc(agentToolPolicy.tool)),
    db
      .select({
        calls: sql<number>`count(*)::int`,
        costMicros: sql<number>`coalesce(sum(${llmCall.costMicros}), 0)::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${llmCall.latencyMs}), 0)::int`,
      })
      .from(llmCall)
      .where(and(eq(llmCall.agentId, a.id), gte(llmCall.createdAt, since))),
    db
      .selectDistinctOn([delivery.id], {
        id: delivery.id,
        title: delivery.title,
        status: delivery.status,
        adjustmentCount: delivery.adjustmentCount,
        createdAt: delivery.createdAt,
      })
      .from(deliveryVersion)
      .innerJoin(delivery, eq(delivery.id, deliveryVersion.deliveryId))
      .where(eq(deliveryVersion.authorAgentId, a.id))
      .orderBy(delivery.id, desc(delivery.createdAt))
      .limit(20),
  ]);
  recent.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
  const delivered = recent.filter((r) => r.status === "delivered");
  return {
    ...a,
    tools,
    stats: {
      calls: stats[0]?.calls ?? 0,
      costMicros: stats[0]?.costMicros ?? 0,
      avgLatencyMs: stats[0]?.avgLatencyMs ?? 0,
      delivered: delivered.length,
      firstPass: delivered.filter((r) => r.adjustmentCount === 0).length,
    },
    recent: recent.slice(0, 6),
  };
}

export async function getModelsPage(db: DbOrTx, workspaceId: string) {
  const since = monthStart();
  const [ws, credentials, limits, spendByTeam] = await Promise.all([
    db
      .select({ settings: workspace.settings })
      .from(workspace)
      .where(eq(workspace.id, workspaceId)),
    db
      .select({
        id: providerCredential.id,
        provider: providerCredential.provider,
        label: providerCredential.label,
        keyHint: providerCredential.keyHint,
        baseUrl: providerCredential.baseUrl,
        models: providerCredential.models,
        lastCheckedAt: providerCredential.lastCheckedAt,
      })
      .from(providerCredential)
      .where(eq(providerCredential.workspaceId, workspaceId))
      .orderBy(asc(providerCredential.createdAt)),
    db.select().from(budget).where(eq(budget.workspaceId, workspaceId)),
    db
      .select({
        teamName: sql<string>`coalesce(${team.name}, 'Conversas na sala')`,
        costMicros: sql<number>`sum(${llmCall.costMicros})::int`,
        calls: sql<number>`count(*)::int`,
      })
      .from(llmCall)
      .leftJoin(agent, eq(agent.id, llmCall.agentId))
      .leftJoin(team, eq(team.id, agent.teamId))
      .where(and(eq(llmCall.workspaceId, workspaceId), gte(llmCall.createdAt, since)))
      .groupBy(team.name)
      .orderBy(desc(sql`sum(${llmCall.costMicros})`)),
  ]);
  return {
    settings: ws[0]?.settings ?? {},
    credentials,
    budget: limits[0] ?? null,
    spendByTeam,
  };
}

/** Connected providers and the models each offered at its last check, for model pickers. */
export async function getModelOptions(
  db: DbOrTx,
  workspaceId: string,
): Promise<{ provider: string; models: string[] }[]> {
  return db
    .select({ provider: providerCredential.provider, models: providerCredential.models })
    .from(providerCredential)
    .where(eq(providerCredential.workspaceId, workspaceId))
    .orderBy(asc(providerCredential.createdAt));
}
