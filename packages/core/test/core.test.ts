import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret, parseMasterKey } from "../src/crypto.ts";
import {
  ACCESSORIES,
  closestLocale,
  computeOfficeMetrics,
  formatList,
  generateAvatar,
  HAIR_STYLES,
  matchAcceptLanguage,
  parseModelRef,
  startOfWeekUtc,
  workspaceLocale,
} from "../src/index.ts";

describe("generateAvatar", () => {
  it("gives the same face for the same seed", () => {
    expect(generateAvatar("Téo")).toEqual(generateAvatar("Téo"));
  });

  it("only uses known parts", () => {
    const avatar = generateAvatar("Lia");
    expect(Object.keys(HAIR_STYLES)).toContain(avatar.hair);
    expect(Object.keys(ACCESSORIES)).toContain(avatar.accessory);
  });

  it("varies across a team of agents", () => {
    const faces = ["Lia", "Téo", "Bia", "Ivo", "Rui", "Nina", "Caio", "Duda"].map((n) =>
      JSON.stringify(generateAvatar(n)),
    );
    expect(new Set(faces).size).toBe(faces.length);
  });
});

describe("computeOfficeMetrics", () => {
  const now = new Date("2026-11-26T15:00:00Z"); // Thursday
  const monday = new Date("2026-11-23T10:00:00Z");
  const lastWeek = new Date("2026-11-20T10:00:00Z");

  it("starts the week on Monday UTC", () => {
    expect(startOfWeekUtc(now).toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });

  it("counts this week's deliveries, first-pass rate and time saved", () => {
    const m = computeOfficeMetrics({
      now,
      deliveries: [
        {
          status: "delivered",
          adjustmentCount: 0,
          deliveredAt: monday,
          estimatedHumanMinutes: 120,
        },
        { status: "delivered", adjustmentCount: 1, deliveredAt: monday, estimatedHumanMinutes: 60 },
        {
          status: "delivered",
          adjustmentCount: 0,
          deliveredAt: lastWeek,
          estimatedHumanMinutes: 90,
        },
        {
          status: "awaiting_approval",
          adjustmentCount: 0,
          deliveredAt: null,
          estimatedHumanMinutes: 30,
        },
      ],
      pendingApprovals: [
        { createdAt: new Date("2026-11-26T13:00:00Z") },
        { createdAt: new Date("2026-11-26T14:30:00Z") },
      ],
      spendCents: 3800,
      budgetCents: 10000,
    });
    expect(m.deliveredThisWeek).toBe(2);
    expect(m.firstPassRate).toBe(0.5);
    expect(m.minutesSaved).toBe(180);
    expect(m.waitingOnYou).toBe(2);
    expect(m.oldestWaitingMinutes).toBe(120);
    expect(m.budgetUsed).toBeCloseTo(0.38);
  });

  it("returns nulls instead of fake zeros for an empty office", () => {
    const m = computeOfficeMetrics({
      now,
      deliveries: [],
      pendingApprovals: [],
      spendCents: 0,
      budgetCents: null,
    });
    expect(m.firstPassRate).toBeNull();
    expect(m.oldestWaitingMinutes).toBeNull();
    expect(m.budgetUsed).toBeNull();
  });
});

describe("secrets", () => {
  const key = randomBytes(32);

  it("round-trips a secret", () => {
    const sealed = encryptSecret("sk-test-123", key);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("sk-test-123");
    expect(decryptSecret(sealed, key)).toBe("sk-test-123");
  });

  it("rejects a tampered payload", () => {
    const parts = encryptSecret("sk-test-123", key).split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const sealed = encryptSecret("sk-test-123", key);
    expect(() => decryptSecret(sealed, randomBytes(32))).toThrow();
  });

  it("validates the master key size", () => {
    expect(() => parseMasterKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
    expect(parseMasterKey(key.toString("base64")).length).toBe(32);
  });

  it("masks keys", () => {
    expect(maskSecret("sk-ant-abcd1234")).toBe("…1234");
  });
});

describe("parseModelRef", () => {
  it("splits provider and model", () => {
    expect(parseModelRef("anthropic:claude-sonnet-5-5")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
  });

  it("rejects refs without a provider", () => {
    expect(() => parseModelRef("claude")).toThrow();
  });
});

describe("locales", () => {
  it("matches the browser language by preference", () => {
    expect(matchAcceptLanguage("en-US,en;q=0.9,pt-BR;q=0.8")).toBe("en");
    expect(matchAcceptLanguage("fr-FR,pt;q=0.7,en;q=0.5")).toBe("pt-BR");
    expect(matchAcceptLanguage("de-DE,fr;q=0.9")).toBeNull();
    expect(matchAcceptLanguage("en;q=0,pt-BR;q=0.1")).toBe("pt-BR");
    expect(matchAcceptLanguage(null)).toBeNull();
  });

  it("maps regional variants to a supported language", () => {
    expect(closestLocale("pt-PT")).toBe("pt-BR");
    expect(closestLocale("EN-gb")).toBe("en");
    expect(closestLocale("es")).toBeNull();
  });

  it("reads the workspace locale, defaulting to pt-BR for older settings", () => {
    expect(workspaceLocale({})).toBe("pt-BR");
    expect(workspaceLocale({ locale: "en" })).toBe("en");
    expect(workspaceLocale({ locale: "xx" as never })).toBe("pt-BR");
  });

  it("joins names the way each language does", () => {
    expect(formatList(["Lia", "Téo", "Bia"], "pt-BR")).toBe("Lia, Téo e Bia");
    expect(formatList(["Lia", "Téo", "Bia"], "en")).toBe("Lia, Téo, and Bia");
  });
});
