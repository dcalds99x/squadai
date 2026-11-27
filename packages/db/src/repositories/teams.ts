import { localizeTemplate, type TeamTemplate } from "@squadai/catalog";
import { formatList, generateAvatar, type Locale, workspaceLocale } from "@squadai/core";
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../client.ts";
import {
  agent,
  agentToolPolicy,
  auditLog,
  department,
  message,
  playbook,
  room,
  team,
  workspace,
} from "../schema/index.ts";

/** The first line in a new team's room. */
const WELCOME: Record<Locale, (names: string) => string> = {
  "pt-BR": (names) => `${names} chegaram ao escritório. Diga oi ou faça o primeiro pedido.`,
  en: (names) => `${names} just joined the office. Say hi or make your first request.`,
};

export interface HireTeamResult {
  teamId: string;
  slug: string;
}

/**
 * "Contratar um time": copies a catalog template into a workspace, with its
 * department, agents, permissions, playbooks and room. The copy is owned by the
 * workspace, so people can change it without touching the catalog. It is
 * written in the workspace locale, when the template has that translation.
 */
export async function hireTeam(
  db: DbOrTx,
  input: { workspaceId: string; template: TeamTemplate; hiredBy?: string },
): Promise<HireTeamResult> {
  const { workspaceId } = input;

  return db.transaction(async (tx) => {
    const [ws] = await tx
      .select({ settings: workspace.settings })
      .from(workspace)
      .where(eq(workspace.id, workspaceId));
    if (!ws) throw new Error("Unknown workspace.");
    const locale = workspaceLocale(ws.settings);
    const template = localizeTemplate(input.template, locale);

    const [dept] = await tx
      .insert(department)
      .values({
        workspaceId,
        name: template.department,
        position: sql`(select count(*) from ${department} where ${department.workspaceId} = ${workspaceId})`,
      })
      .onConflictDoUpdate({
        target: [department.workspaceId, department.name],
        set: { name: template.department },
      })
      .returning({ id: department.id });
    if (!dept) throw new Error("Could not create department.");

    const slug = await uniqueTeamSlug(tx, workspaceId, template.id);
    const [created] = await tx
      .insert(team)
      .values({
        workspaceId,
        departmentId: dept.id,
        slug,
        name: template.name,
        description: template.description,
        color: template.color,
        leadKey: template.lead ?? null,
        scope: template.scope,
        templateRef: `${template.id}@${template.version}`,
      })
      .returning({ id: team.id });
    if (!created) throw new Error("Could not create team.");

    const agents = await tx
      .insert(agent)
      .values(
        template.agents.map((a, position) => ({
          workspaceId,
          position,
          teamId: created.id,
          key: a.key,
          name: a.name,
          role: a.role,
          bio: a.bio,
          skills: a.skills,
          prefers: a.prefers,
          never: a.never,
          instructions: a.instructions,
          avatar: generateAvatar(`${a.name}:${a.key}:${template.id}`),
          tier: a.tier,
          style: a.style,
        })),
      )
      .returning({ id: agent.id, key: agent.key });
    const agentIdByKey = new Map(agents.map((a) => [a.key, a.id]));

    const policies = template.agents.flatMap((a) =>
      Object.entries(a.tools).map(([tool, policy]) => ({
        agentId: agentIdByKey.get(a.key) as string,
        tool,
        policy,
      })),
    );
    if (policies.length > 0) await tx.insert(agentToolPolicy).values(policies);

    await tx.insert(playbook).values(
      template.playbooks.map((p, position) => ({
        teamId: created.id,
        position,
        key: p.key,
        name: p.name,
        description: p.description,
        mode: p.mode,
        steps: p.steps.map((s) => ({
          agentKey: s.agent,
          task: s.task,
          ...(s.kind ? { kind: s.kind } : {}),
          ...(s.with ? { with: s.with } : {}),
          ...(s.rounds ? { rounds: s.rounds } : {}),
        })),
        estimatedHumanMinutes: p.estimatedHumanMinutes,
        requiresApproval: p.approval,
      })),
    );

    const [teamRoom] = await tx
      .insert(room)
      .values({ teamId: created.id })
      .returning({ id: room.id });
    if (!teamRoom) throw new Error("Could not create room.");
    const names = template.agents.map((a) => a.name);
    await tx.insert(message).values({
      roomId: teamRoom.id,
      kind: "system",
      body: WELCOME[locale](formatList(names, locale)),
    });

    await tx.insert(auditLog).values({
      workspaceId,
      actorType: input.hiredBy ? "user" : "system",
      actorId: input.hiredBy ?? null,
      action: "team.hired",
      target: created.id,
      metadata: { template: template.id, version: template.version, locale: template.locale },
    });

    return { teamId: created.id, slug };
  });
}

async function uniqueTeamSlug(db: DbOrTx, workspaceId: string, base: string): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await db
      .select({ id: team.id })
      .from(team)
      .where(and(eq(team.workspaceId, workspaceId), eq(team.slug, candidate)))
      .limit(1);
    if (taken.length === 0) return candidate;
  }
}
