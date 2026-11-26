import { computeOfficeMetrics, type OfficeMetrics } from "@squadai/core";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { DbOrTx } from "../client.ts";
import {
  agent,
  approval,
  budget,
  delivery,
  department,
  llmCall,
  message,
  playbook,
  room,
  team,
} from "../schema/index.ts";

export interface SidebarTeam {
  id: string;
  slug: string;
  name: string;
  color: string;
  waiting: number;
}

export interface SidebarDepartment {
  id: string;
  name: string;
  teams: SidebarTeam[];
}

/** Departments and their teams, with how many deliveries wait on a person. */
export async function getSidebar(db: DbOrTx, workspaceId: string): Promise<SidebarDepartment[]> {
  const rows = await db
    .select({
      departmentId: department.id,
      departmentName: department.name,
      teamId: team.id,
      slug: team.slug,
      name: team.name,
      color: team.color,
      waiting: sql<number>`(
        select count(*)::int from ${delivery}
        where ${delivery.teamId} = ${team.id} and ${delivery.status} = 'awaiting_approval'
      )`,
    })
    .from(department)
    .innerJoin(team, eq(team.departmentId, department.id))
    .where(eq(department.workspaceId, workspaceId))
    .orderBy(asc(department.position), asc(team.createdAt));

  const byDepartment = new Map<string, SidebarDepartment>();
  for (const r of rows) {
    const entry = byDepartment.get(r.departmentId) ?? {
      id: r.departmentId,
      name: r.departmentName,
      teams: [],
    };
    entry.teams.push({
      id: r.teamId,
      slug: r.slug,
      name: r.name,
      color: r.color,
      waiting: r.waiting,
    });
    byDepartment.set(r.departmentId, entry);
  }
  return [...byDepartment.values()];
}

export async function getTeamsWithAgents(db: DbOrTx, workspaceId: string) {
  const rows = await db
    .select({
      teamId: team.id,
      slug: team.slug,
      teamName: team.name,
      description: team.description,
      color: team.color,
      templateRef: team.templateRef,
      departmentName: department.name,
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      avatar: agent.avatar,
    })
    .from(team)
    .innerJoin(department, eq(department.id, team.departmentId))
    .innerJoin(agent, eq(agent.teamId, team.id))
    .where(eq(team.workspaceId, workspaceId))
    .orderBy(asc(team.createdAt), asc(agent.position));

  const teams = new Map<
    string,
    {
      id: string;
      slug: string;
      name: string;
      description: string;
      color: string;
      /** "<template id>@<version>", or null for a team not hired from the catalog. */
      templateRef: string | null;
      department: string;
      agents: { id: string; name: string; role: string; avatar: (typeof rows)[number]["avatar"] }[];
    }
  >();
  for (const r of rows) {
    const t = teams.get(r.teamId) ?? {
      id: r.teamId,
      slug: r.slug,
      name: r.teamName,
      description: r.description,
      color: r.color,
      templateRef: r.templateRef,
      department: r.departmentName,
      agents: [],
    };
    t.agents.push({ id: r.agentId, name: r.agentName, role: r.agentRole, avatar: r.avatar });
    teams.set(r.teamId, t);
  }
  return [...teams.values()];
}

/** Everything the team page needs: the team, its people, playbooks and room. */
export async function getTeamPage(db: DbOrTx, workspaceId: string, slug: string) {
  const [found] = await db
    .select({
      id: team.id,
      slug: team.slug,
      name: team.name,
      description: team.description,
      color: team.color,
      department: department.name,
      roomId: room.id,
    })
    .from(team)
    .innerJoin(department, eq(department.id, team.departmentId))
    .innerJoin(room, eq(room.teamId, team.id))
    .where(and(eq(team.workspaceId, workspaceId), eq(team.slug, slug)))
    .limit(1);
  if (!found) return null;

  const [agents, playbooks, messages] = await Promise.all([
    db
      .select({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        bio: agent.bio,
        avatar: agent.avatar,
      })
      .from(agent)
      .where(eq(agent.teamId, found.id))
      .orderBy(asc(agent.position)),
    db
      .select({ key: playbook.key, name: playbook.name, description: playbook.description })
      .from(playbook)
      .where(eq(playbook.teamId, found.id))
      .orderBy(asc(playbook.position)),
    db
      .select({
        id: message.id,
        kind: message.kind,
        body: message.body,
        createdAt: message.createdAt,
        authorAgentId: message.authorAgentId,
      })
      .from(message)
      .where(eq(message.roomId, found.roomId))
      .orderBy(asc(message.createdAt))
      .limit(100),
  ]);
  return { ...found, agents, playbooks, messages };
}

export async function getOfficeMetrics(
  db: DbOrTx,
  workspaceId: string,
  now = new Date(),
): Promise<OfficeMetrics> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const weekAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

  const [deliveries, pending, spend, limits] = await Promise.all([
    db
      .select({
        status: delivery.status,
        adjustmentCount: delivery.adjustmentCount,
        deliveredAt: delivery.deliveredAt,
        estimatedHumanMinutes: delivery.estimatedHumanMinutes,
      })
      .from(delivery)
      .innerJoin(team, eq(team.id, delivery.teamId))
      .where(and(eq(team.workspaceId, workspaceId), gte(delivery.deliveredAt, weekAgo))),
    db
      .select({ createdAt: approval.createdAt })
      .from(approval)
      .where(and(eq(approval.workspaceId, workspaceId), eq(approval.status, "pending"))),
    db
      .select({ micros: sql<number>`coalesce(sum(${llmCall.costMicros}), 0)::bigint` })
      .from(llmCall)
      .where(and(eq(llmCall.workspaceId, workspaceId), gte(llmCall.createdAt, monthStart))),
    db
      .select({ cents: budget.monthlyLimitCents })
      .from(budget)
      .where(eq(budget.workspaceId, workspaceId)),
  ]);

  return computeOfficeMetrics({
    now,
    deliveries,
    pendingApprovals: pending,
    // Cost is tracked in USD micros; currency conversion arrives with Phase 2 budgets.
    spendCents: Math.round(Number(spend[0]?.micros ?? 0) / 10_000),
    budgetCents: limits[0]?.cents ?? null,
  });
}
