import type { DeliveryStatus } from "./domain.ts";

/**
 * The office dashboard numbers. Every metric answers a question a manager of
 * a real team would ask, so each one has a plain definition here.
 */

export interface DeliveryFact {
  status: DeliveryStatus;
  /** How many times the person asked for changes before approving. */
  adjustmentCount: number;
  deliveredAt: Date | null;
  /** How long a person would take to do this by hand (from the playbook). */
  estimatedHumanMinutes: number;
}

export interface OfficeMetricsInput {
  deliveries: DeliveryFact[];
  pendingApprovals: { createdAt: Date }[];
  spendCents: number;
  budgetCents: number | null;
  now: Date;
}

export interface OfficeMetrics {
  /** Deliveries approved since Monday 00:00 UTC. */
  deliveredThisWeek: number;
  /** Share of this week's deliveries approved with no change requests (0–1), or null if none. */
  firstPassRate: number | null;
  /** Approvals waiting on a person. */
  waitingOnYou: number;
  /** Minutes the oldest pending approval has been waiting, or null if none. */
  oldestWaitingMinutes: number | null;
  /** Estimated minutes of human work saved this week. */
  minutesSaved: number;
  spendCents: number;
  budgetCents: number | null;
  /** Share of the monthly budget already spent (0–1), or null without a budget. */
  budgetUsed: number | null;
}

/** Monday 00:00 UTC of the week that contains `date`. */
export function startOfWeekUtc(date: Date): Date {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

export function computeOfficeMetrics(input: OfficeMetricsInput): OfficeMetrics {
  const weekStart = startOfWeekUtc(input.now);
  const thisWeek = input.deliveries.filter(
    (d) => d.status === "delivered" && d.deliveredAt !== null && d.deliveredAt >= weekStart,
  );
  const firstPass = thisWeek.filter((d) => d.adjustmentCount === 0).length;

  const oldest = input.pendingApprovals.reduce<Date | null>(
    (min, a) => (min === null || a.createdAt < min ? a.createdAt : min),
    null,
  );

  return {
    deliveredThisWeek: thisWeek.length,
    firstPassRate: thisWeek.length === 0 ? null : firstPass / thisWeek.length,
    waitingOnYou: input.pendingApprovals.length,
    oldestWaitingMinutes:
      oldest === null
        ? null
        : Math.max(0, Math.floor((input.now.getTime() - oldest.getTime()) / 60_000)),
    minutesSaved: thisWeek.reduce((sum, d) => sum + d.estimatedHumanMinutes, 0),
    spendCents: input.spendCents,
    budgetCents: input.budgetCents,
    budgetUsed:
      input.budgetCents === null || input.budgetCents <= 0
        ? null
        : input.spendCents / input.budgetCents,
  };
}
