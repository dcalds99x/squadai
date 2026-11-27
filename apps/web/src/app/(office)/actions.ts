"use server";

import { getTeamTemplate } from "@squadai/catalog";
import {
  AGENT_STYLES,
  LOCALES,
  MODEL_TIERS,
  PROVIDERS,
  type Provider,
  TOOL_POLICIES,
  type WorkspaceSettings,
} from "@squadai/core";
import { decryptSecret, encryptSecret, maskSecret, parseMasterKey } from "@squadai/core/crypto";
import { getDb, hireTeam, schema } from "@squadai/db";
import {
  approveDelivery,
  cancelDelivery,
  checkScope,
  createRequest,
  deleteDelivery,
  deleteTeam,
  notify,
  postUserMessage,
  requestChanges,
} from "@squadai/engine";
import { checkConnection } from "@squadai/providers";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import {
  ActionError,
  type ActionState,
  attempt,
  refuseInPublicDemo,
  requireManager,
} from "@/lib/action";
import { getContentText } from "@/lib/content";
import { env } from "@/lib/env";
import { parseDecimal } from "@/lib/format";
import { enqueueReply, enqueueRun } from "@/lib/queue";
import { workspaceContext } from "@/lib/secrets";
import { requireOffice } from "@/lib/session";

export type { ActionState };

// ── Work ────────────────────────────────────────────────────────────────

export async function createRequestAction(_: ActionState, form: FormData): Promise<ActionState> {
  let redirectTo: string | null = null;
  const result = await attempt(async () => {
    const { user, workspace } = await requireOffice();
    const db = getDb();
    // "Send to <team>" after a scope refusal: the suggested team decides how to do it.
    const sentTo = String(form.get("sendTo") ?? "");
    const teamId = sentTo || String(form.get("teamId") ?? "");
    const playbookId = sentTo ? null : String(form.get("playbookId") ?? "") || null;
    const prompt = String(form.get("prompt") ?? "");

    if (!sentTo && prompt.trim().length >= 5) {
      const verdict = await checkScope(
        db,
        { workspaceId: workspace.id, teamId, prompt },
        await workspaceContext(workspace.id),
      );
      if (verdict.fit === "out") {
        const text = await getContentText();
        return {
          outOfScope: {
            reason: verdict.reason,
            alternatives: verdict.alternatives.map((a) => ({
              teamId: a.teamId,
              teamName: text.c(a.teamName),
              agentName: a.agentName,
            })),
          },
        };
      }
    }

    const created = await createRequest(db, {
      workspaceId: workspace.id,
      teamId,
      playbookId,
      userId: user.id,
      prompt,
    });
    await enqueueRun({ requestId: created.requestId });
    const [t] = await db
      .select({ slug: schema.team.slug })
      .from(schema.team)
      .where(eq(schema.team.id, teamId));
    redirectTo =
      String(form.get("stay") ?? "") === "1" && !sentTo ? null : `/teams/${t?.slug ?? ""}`;
    revalidatePath("/", "layout");
    return { ok: true, message: (await getTranslations("actions"))("requestSent") };
  });
  if (redirectTo) redirect(redirectTo);
  return result;
}

export async function approveAction(deliveryId: string): Promise<ActionState> {
  return attempt(async () => {
    const { user, workspace } = await requireOffice();
    const { followUps } = await approveDelivery(getDb(), {
      workspaceId: workspace.id,
      deliveryId,
      userId: user.id,
    });
    for (const job of followUps) await enqueueRun(job);
    revalidatePath("/", "layout");
    return { ok: true, message: (await getTranslations("actions"))("delivered") };
  });
}

export async function requestChangesAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { user, workspace } = await requireOffice();
    const job = await requestChanges(getDb(), {
      workspaceId: workspace.id,
      deliveryId: String(form.get("deliveryId") ?? ""),
      userId: user.id,
      feedback: String(form.get("feedback") ?? ""),
    });
    await enqueueRun(job);
    revalidatePath("/", "layout");
    return { ok: true, message: (await getTranslations("actions"))("changesSent") };
  });
}

/** Stops the team's work on a delivery; it stays on record as cancelled. */
export async function cancelDeliveryAction(deliveryId: string): Promise<ActionState> {
  return attempt(async () => {
    const { user, workspace } = await requireOffice();
    const { followUps } = await cancelDelivery(getDb(), {
      workspaceId: workspace.id,
      deliveryId,
      userId: user.id,
    });
    for (const job of followUps) await enqueueRun(job);
    revalidatePath("/", "layout");
    return { ok: true, message: (await getTranslations("actions"))("deliveryCancelled") };
  });
}

/** Deletes a delivery with everything behind it, then goes back to its team. */
export async function deleteDeliveryAction(deliveryId: string): Promise<ActionState> {
  let back: string | null = null;
  const result = await attempt(async () => {
    const { user, workspace } = await requireOffice();
    const db = getDb();
    const [owner] = await db
      .select({ slug: schema.team.slug })
      .from(schema.delivery)
      .innerJoin(schema.team, eq(schema.team.id, schema.delivery.teamId))
      .where(and(eq(schema.delivery.id, deliveryId), eq(schema.team.workspaceId, workspace.id)));
    const { followUps } = await deleteDelivery(db, {
      workspaceId: workspace.id,
      deliveryId,
      userId: user.id,
    });
    for (const job of followUps) await enqueueRun(job);
    revalidatePath("/", "layout");
    back = owner ? `/teams/${owner.slug}` : "/";
    return { ok: true };
  });
  if (back) redirect(back);
  return result;
}

/** Removes a team and all its work. Managers only. */
export async function deleteTeamAction(teamId: string): Promise<ActionState> {
  let done = false;
  const result = await attempt(async () => {
    const { user, workspace } = await requireManager();
    const { followUps } = await deleteTeam(getDb(), {
      workspaceId: workspace.id,
      teamId,
      userId: user.id,
    });
    for (const job of followUps) await enqueueRun(job);
    revalidatePath("/", "layout");
    done = true;
    return { ok: true };
  });
  if (done) redirect("/");
  return result;
}

export async function retryRequestAction(requestId: string): Promise<ActionState> {
  return attempt(async () => {
    const { workspace } = await requireOffice();
    const db = getDb();
    const [req] = await db
      .select({
        id: schema.request.id,
        teamId: schema.request.teamId,
        status: schema.request.status,
      })
      .from(schema.request)
      .where(and(eq(schema.request.id, requestId), eq(schema.request.workspaceId, workspace.id)));
    if (!req) throw new ActionError("requestNotFound");
    if (req.status !== "failed") throw new ActionError("requestNotStuck");
    await db.update(schema.request).set({ status: "queued" }).where(eq(schema.request.id, req.id));
    await enqueueRun({ requestId: req.id });
    await notify(db, {
      type: "request",
      workspaceId: workspace.id,
      teamId: req.teamId,
      requestId: req.id,
    });
    return { ok: true };
  });
}

export async function sendRoomMessageAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { user, workspace } = await requireOffice();
    const posted = await postUserMessage(getDb(), {
      workspaceId: workspace.id,
      teamId: String(form.get("teamId") ?? ""),
      userId: user.id,
      body: String(form.get("body") ?? ""),
    });
    for (const agentId of posted.replyAgentIds)
      await enqueueReply({ messageId: posted.messageId, agentId });
    // The room shows them typing until their answer arrives.
    return { ok: true, replying: posted.replyAgentNames };
  });
}

// ── Team and agents ─────────────────────────────────────────────────────

export async function hireTeamAction(templateId: string): Promise<ActionState> {
  let slug = "";
  const result = await attempt(async () => {
    const { user, workspace } = await requireManager();
    // The team arrives in the workspace locale (hireTeam reads it).
    ({ slug } = await hireTeam(getDb(), {
      workspaceId: workspace.id,
      template: getTeamTemplate(templateId),
      hiredBy: user.id,
    }));
    revalidatePath("/", "layout");
    return { ok: true };
  });
  if (slug) redirect(`/teams/${slug}`);
  return result;
}

const AgentForm = z.object({
  agentId: z.uuid(),
  tier: z.enum(MODEL_TIERS),
  style: z.enum(AGENT_STYLES),
  model: z.string().trim(),
  fallbackModel: z.string().trim(),
  instructions: z.string().trim().min(10),
});

const modelRef = (value: string) => {
  if (!value) return null;
  if (!/^[a-z-]+:.+$/.test(value)) throw new ActionError("modelRefFormat");
  return value;
};

export async function updateAgentAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { user, workspace } = await requireManager();
    const parsed = AgentForm.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      throw new ActionError(field === "instructions" ? "instructionsTooShort" : "invalidData");
    }
    const data = parsed.data;
    const db = getDb();
    const updated = await db
      .update(schema.agent)
      .set({
        tier: data.tier,
        style: data.style,
        model: modelRef(data.model),
        fallbackModel: modelRef(data.fallbackModel),
        instructions: data.instructions,
      })
      .where(and(eq(schema.agent.id, data.agentId), eq(schema.agent.workspaceId, workspace.id)))
      .returning({ id: schema.agent.id });
    if (updated.length === 0) throw new ActionError("agentNotFound");
    await db.insert(schema.auditLog).values({
      workspaceId: workspace.id,
      actorType: "user",
      actorId: user.id,
      action: "agent.updated",
      target: data.agentId,
      metadata: { tier: data.tier, style: data.style, model: data.model || null },
    });
    revalidatePath(`/agents/${data.agentId}`);
    return { ok: true, message: (await getTranslations("actions"))("saved") };
  });
}

export async function setToolPolicyAction(
  agentId: string,
  tool: string,
  policy: string,
): Promise<ActionState> {
  return attempt(async () => {
    const { user, workspace } = await requireManager();
    const value = z.enum(TOOL_POLICIES).parse(policy);
    const db = getDb();
    const [owned] = await db
      .select({ id: schema.agent.id })
      .from(schema.agent)
      .where(and(eq(schema.agent.id, agentId), eq(schema.agent.workspaceId, workspace.id)));
    if (!owned) throw new ActionError("agentNotFound");
    await db
      .insert(schema.agentToolPolicy)
      .values({ agentId, tool, policy: value })
      .onConflictDoUpdate({
        target: [schema.agentToolPolicy.agentId, schema.agentToolPolicy.tool],
        set: { policy: value },
      });
    await db.insert(schema.auditLog).values({
      workspaceId: workspace.id,
      actorType: "user",
      actorId: user.id,
      action: "agent.tool_policy_changed",
      target: agentId,
      metadata: { tool, policy: value },
    });
    revalidatePath(`/agents/${agentId}`);
    return { ok: true };
  });
}

// ── Models and costs ────────────────────────────────────────────────────

const KEY_OPTIONAL: Provider[] = ["ollama", "openai-compatible"];

export async function saveProviderAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    refuseInPublicDemo();
    const { user, workspace } = await requireManager();
    const provider = z.enum(PROVIDERS).parse(form.get("provider"));
    const apiKey = String(form.get("apiKey") ?? "").trim();
    const baseUrl = String(form.get("baseUrl") ?? "").trim() || null;
    if (!apiKey && !KEY_OPTIONAL.includes(provider)) throw new ActionError("pasteKey");
    if (provider === "openai-compatible" && !baseUrl) throw new ActionError("baseUrlRequired");

    let masterKey: Buffer;
    try {
      masterKey = parseMasterKey(env().SQUADAI_MASTER_KEY);
    } catch {
      throw new ActionError("noMasterKey");
    }

    // The check speaks to the person who is connecting, in their language.
    const check = await checkConnection(
      { provider, apiKey: apiKey || null, baseUrl },
      await getLocale(),
    );
    if (!check.ok) {
      if (check.error) return { error: check.error };
      throw new ActionError("connectFailed");
    }

    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.providerCredential)
        .where(
          and(
            eq(schema.providerCredential.workspaceId, workspace.id),
            eq(schema.providerCredential.provider, provider),
          ),
        );
      await tx.insert(schema.providerCredential).values({
        workspaceId: workspace.id,
        provider,
        label: provider,
        encryptedKey: apiKey ? encryptSecret(apiKey, masterKey) : null,
        keyHint: apiKey ? maskSecret(apiKey) : null,
        baseUrl,
        models: check.models,
        lastCheckedAt: new Date(),
      });
      await tx.insert(schema.auditLog).values({
        workspaceId: workspace.id,
        actorType: "user",
        actorId: user.id,
        action: "provider.connected",
        target: provider,
      });
    });
    revalidatePath("/models");
    const t = await getTranslations("actions");
    return { ok: true, message: t("providerConnected", { count: check.models.length }) };
  });
}

/** Asks a connected provider for its models again, so the pickers show what is new. */
export async function refreshProviderModelsAction(credentialId: string): Promise<ActionState> {
  return attempt(async () => {
    refuseInPublicDemo();
    const { workspace } = await requireManager();
    const db = getDb();
    const [cred] = await db
      .select()
      .from(schema.providerCredential)
      .where(
        and(
          eq(schema.providerCredential.id, credentialId),
          eq(schema.providerCredential.workspaceId, workspace.id),
        ),
      );
    if (!cred) throw new ActionError("connectFailed");
    let apiKey: string | null = null;
    if (cred.encryptedKey) {
      try {
        apiKey = decryptSecret(cred.encryptedKey, parseMasterKey(env().SQUADAI_MASTER_KEY));
      } catch {
        throw new ActionError("noMasterKey");
      }
    }
    const check = await checkConnection(
      { provider: cred.provider, apiKey, baseUrl: cred.baseUrl },
      await getLocale(),
    );
    if (!check.ok) return { error: check.error ?? undefined };
    await db
      .update(schema.providerCredential)
      .set({ models: check.models, lastCheckedAt: new Date() })
      .where(eq(schema.providerCredential.id, cred.id));
    revalidatePath("/models");
    revalidatePath("/agents", "layout");
    const t = await getTranslations("actions");
    return { ok: true, message: t("providerConnected", { count: check.models.length }) };
  });
}

export async function removeProviderAction(credentialId: string): Promise<ActionState> {
  return attempt(async () => {
    const { user, workspace } = await requireManager();
    const db = getDb();
    const removed = await db
      .delete(schema.providerCredential)
      .where(
        and(
          eq(schema.providerCredential.id, credentialId),
          eq(schema.providerCredential.workspaceId, workspace.id),
        ),
      )
      .returning({ provider: schema.providerCredential.provider });
    if (removed[0]) {
      await db.insert(schema.auditLog).values({
        workspaceId: workspace.id,
        actorType: "user",
        actorId: user.id,
        action: "provider.removed",
        target: removed[0].provider,
      });
    }
    revalidatePath("/models");
    return { ok: true };
  });
}

async function updateSettings(
  workspaceId: string,
  change: (s: WorkspaceSettings) => WorkspaceSettings,
) {
  const db = getDb();
  const [ws] = await db
    .select({ settings: schema.workspace.settings })
    .from(schema.workspace)
    .where(eq(schema.workspace.id, workspaceId));
  await db
    .update(schema.workspace)
    .set({ settings: change(ws?.settings ?? {}) })
    .where(eq(schema.workspace.id, workspaceId));
}

export async function setDemoModeAction(on: boolean): Promise<ActionState> {
  return attempt(async () => {
    if (!on) refuseInPublicDemo();
    const { workspace } = await requireManager();
    await updateSettings(workspace.id, (s) => ({ ...s, demoMode: on }));
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** The language agents work in. A workspace setting, separate from each person's interface. */
export async function setWorkspaceLocaleAction(locale: string): Promise<ActionState> {
  return attempt(async () => {
    const { user, workspace } = await requireManager();
    const parsed = z.enum(LOCALES).safeParse(locale);
    if (!parsed.success) throw new ActionError("unknownLocale");
    await updateSettings(workspace.id, (s) => ({ ...s, locale: parsed.data }));
    await getDb()
      .insert(schema.auditLog)
      .values({
        workspaceId: workspace.id,
        actorType: "user",
        actorId: user.id,
        action: "workspace.locale_changed",
        target: workspace.id,
        metadata: { locale: parsed.data },
      });
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function saveTierModelsAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { workspace } = await requireManager();
    const tierModels: WorkspaceSettings["tierModels"] = {};
    for (const tier of MODEL_TIERS) {
      const primary = modelRef(String(form.get(`${tier}.primary`) ?? "").trim());
      const fallback = modelRef(String(form.get(`${tier}.fallback`) ?? "").trim());
      if (primary)
        tierModels[tier] = {
          primary: primary as `${string}:${string}`,
          fallback: fallback as `${string}:${string}` | null,
        };
    }
    await updateSettings(workspace.id, (s) => ({ ...s, tierModels }));
    revalidatePath("/models");
    return { ok: true, message: (await getTranslations("actions"))("modelsSaved") };
  });
}

export async function saveBudgetAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { workspace } = await requireManager();
    // People type amounts the way their language writes them: "20,50" or "20.50".
    const value = parseDecimal(String(form.get("monthly") ?? ""), await getLocale());
    if (value !== null && (!Number.isFinite(value) || value < 0))
      throw new ActionError("budgetFormat");
    await getDb()
      .insert(schema.budget)
      .values({
        workspaceId: workspace.id,
        monthlyLimitCents: value === null ? null : Math.round(value * 100),
      })
      .onConflictDoUpdate({
        target: schema.budget.workspaceId,
        set: { monthlyLimitCents: value === null ? null : Math.round(value * 100) },
      });
    revalidatePath("/", "layout");
    return { ok: true, message: (await getTranslations("actions"))("budgetSaved") };
  });
}
