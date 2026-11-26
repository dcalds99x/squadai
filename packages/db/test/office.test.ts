/**
 * Integration tests against a real Postgres. They run when DATABASE_URL is set
 * (CI starts a Postgres service; locally run `pnpm db:up && pnpm db:migrate`).
 */
import { randomUUID } from "node:crypto";
import { getTeamTemplate } from "@squadai/catalog";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  createDb,
  createWorkspaceForUser,
  getOfficeMetrics,
  getPrimaryWorkspace,
  getSidebar,
  getTeamsWithAgents,
  hireTeam,
} from "../src/index.ts";
import { agent, agentToolPolicy, message, room, user, workspace } from "../src/schema/index.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("office (Postgres)", () => {
  const db = createDb(url as string, { max: 2 });
  const userId = `test-${randomUUID()}`;

  afterAll(async () => {
    const ws = await getPrimaryWorkspace(db, userId);
    if (ws) await db.delete(workspace).where(eq(workspace.id, ws.id));
    await db.delete(user).where(eq(user.id, userId));
    await db.close();
  });

  it("gives a new person an office with the starter team", async () => {
    await db.insert(user).values({ id: userId, name: "Ana Souza", email: `${userId}@example.com` });
    const { workspaceId } = await createWorkspaceForUser(db, {
      userId,
      userName: "Ana Souza",
      locale: "pt-BR",
    });

    const ws = await getPrimaryWorkspace(db, userId);
    expect(ws?.name).toBe("Escritório de Ana");
    expect(ws?.role).toBe("owner");

    const sidebar = await getSidebar(db, workspaceId);
    expect(sidebar.map((d) => d.name)).toEqual(["Marketing"]);
    expect(sidebar[0]?.teams[0]?.name).toBe("Conteúdo & SEO");

    const teams = await getTeamsWithAgents(db, workspaceId);
    expect(teams[0]?.agents.map((a) => a.name)).toEqual(["Lia", "Téo", "Bia"]);
  });

  it("hires a second team into its own department, with permissions", async () => {
    const ws = await getPrimaryWorkspace(db, userId);
    const { teamId } = await hireTeam(db, {
      workspaceId: ws?.id as string,
      template: getTeamTemplate("code-review"),
    });

    const rui = await db.select().from(agent).where(eq(agent.teamId, teamId));
    const policies = await db
      .select()
      .from(agentToolPolicy)
      .where(eq(agentToolPolicy.agentId, rui.find((a) => a.key === "rui")?.id as string));
    expect(policies.find((p) => p.tool === "github_merge")?.policy).toBe("deny");

    const sidebar = await getSidebar(db, ws?.id as string);
    expect(sidebar.map((d) => d.name)).toEqual(["Marketing", "Desenvolvimento"]);
  });

  it("reports honest metrics for a brand-new office", async () => {
    const ws = await getPrimaryWorkspace(db, userId);
    const metrics = await getOfficeMetrics(db, ws?.id as string);
    expect(metrics.deliveredThisWeek).toBe(0);
    expect(metrics.firstPassRate).toBeNull();
    expect(metrics.waitingOnYou).toBe(0);
    expect(metrics.budgetCents).toBe(10_000);
  });
});

describe.skipIf(!url)("an office in English (Postgres)", () => {
  const db = createDb(url as string, { max: 2 });
  const userId = `test-${randomUUID()}`;

  afterAll(async () => {
    const ws = await getPrimaryWorkspace(db, userId);
    if (ws) await db.delete(workspace).where(eq(workspace.id, ws.id));
    await db.delete(user).where(eq(user.id, userId));
    await db.close();
  });

  it("names the office, hires the team and greets in the workspace locale", async () => {
    await db.insert(user).values({ id: userId, name: "Sam Lee", email: `${userId}@example.com` });
    const { workspaceId } = await createWorkspaceForUser(db, {
      userId,
      userName: "Sam Lee",
      locale: "en",
    });

    const ws = await getPrimaryWorkspace(db, userId);
    expect(ws?.name).toBe("Sam's office");
    expect(ws?.settings.locale).toBe("en");

    const teams = await getTeamsWithAgents(db, workspaceId);
    expect(teams[0]?.name).toBe("Content & SEO");
    expect(teams[0]?.agents.map((a) => [a.name, a.role])).toEqual([
      ["Lia", "Researcher"],
      ["Téo", "Writer"],
      ["Bia", "Editor"],
    ]);

    await hireTeam(db, { workspaceId, template: getTeamTemplate("code-review") });
    const sidebar = await getSidebar(db, workspaceId);
    expect(sidebar.map((d) => d.name)).toEqual(["Marketing", "Engineering"]);

    const [welcome] = await db
      .select({ body: message.body })
      .from(message)
      .innerJoin(room, eq(room.id, message.roomId))
      .where(eq(room.teamId, teams[0]?.id as string));
    expect(welcome?.body).toBe(
      "Lia, Téo, and Bia just joined the office. Say hi or make your first request.",
    );
  });
});

describe.skipIf(!url)("hub read models (Postgres)", () => {
  it("run against a real database", async () => {
    const {
      createDb: open,
      getAttention,
      getRecentActivity,
      getTeamStats,
      getWeekSeries,
    } = await import("../src/index.ts");
    const db = open(url as string, { max: 1 });
    const someWorkspace = "00000000-0000-0000-0000-000000000000";
    try {
      expect(await getWeekSeries(db, someWorkspace)).toHaveLength(7);
      expect((await getTeamStats(db, someWorkspace)).size).toBe(0);
      expect((await getAttention(db, someWorkspace)).deliveryApprovals).toBe(0);
      expect(await getRecentActivity(db, someWorkspace)).toEqual([]);
    } finally {
      await db.close();
    }
  });
});
