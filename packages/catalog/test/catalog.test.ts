import { LOCALES } from "@squadai/core";
import { describe, expect, it } from "vitest";
import {
  getTeamTemplate,
  localizeTemplate,
  STARTER_TEAM_ID,
  TEAM_TEMPLATES,
  TeamTemplateSchema,
} from "../src/index.ts";

describe("team catalog", () => {
  it("ships valid templates", () => {
    expect(TEAM_TEMPLATES.length).toBeGreaterThan(0);
    for (const template of TEAM_TEMPLATES) {
      expect(() => TeamTemplateSchema.parse(template)).not.toThrow();
    }
  });

  it("includes the starter team", () => {
    expect(getTeamTemplate(STARTER_TEAM_ID).agents.length).toBeGreaterThan(0);
  });

  it("rejects a playbook step that points to an unknown agent", () => {
    const base = getTeamTemplate(STARTER_TEAM_ID);
    const broken = {
      ...base,
      playbooks: [{ ...base.playbooks[0], steps: [{ agent: "ghost", task: "Nothing" }] }],
    };
    const result = TeamTemplateSchema.safeParse(broken);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("ghost");
  });
});

describe("team translations", () => {
  it("ships every team in every supported language", () => {
    for (const template of TEAM_TEMPLATES) {
      for (const locale of LOCALES) {
        if (locale === template.locale) continue;
        expect(template.translations[locale], `${template.id} in ${locale}`).toBeDefined();
      }
    }
  });

  it("changes the words and keeps the team itself", () => {
    const base = getTeamTemplate(STARTER_TEAM_ID);
    const pt = localizeTemplate(base, "pt-BR");
    expect(pt.locale).toBe("pt-BR");
    expect(pt.name).toBe("Conteúdo & SEO");
    expect(pt.agents.map((a) => [a.key, a.name, a.tier, a.tools])).toEqual(
      base.agents.map((a) => [a.key, a.name, a.tier, a.tools]),
    );
    expect(pt.playbooks[0]?.steps.map((s) => s.agent)).toEqual(
      base.playbooks[0]?.steps.map((s) => s.agent),
    );
    expect(base.playbooks[0]?.steps[0]?.task).toMatch(/^Research/);
    expect(localizeTemplate(base, "en")).toBe(base);
  });

  it("rejects an incomplete translation", () => {
    const base = getTeamTemplate(STARTER_TEAM_ID);
    const pt = base.translations["pt-BR"];
    if (!pt) throw new Error("expected a Portuguese translation");
    const { lia: _, ...agents } = pt.agents;
    const result = TeamTemplateSchema.safeParse({
      ...base,
      translations: {
        "pt-BR": {
          ...pt,
          agents,
          playbooks: { ...pt.playbooks, newsletter: { name: "N", description: "D", tasks: ["x"] } },
        },
      },
    });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain("missing lia");
    expect(messages).toContain("needs 3 tasks, one per step");
  });

  it("rejects a translation into the language the template is written in", () => {
    const base = getTeamTemplate(STARTER_TEAM_ID);
    const result = TeamTemplateSchema.safeParse({
      ...base,
      translations: { en: base.translations["pt-BR"] },
    });
    expect(result.success).toBe(false);
  });
});

describe("translateCatalogText", () => {
  it("shows untouched catalog words in the reader's language", async () => {
    const { translateCatalogText, getTeamTemplate, localizeTemplate } = await import(
      "../src/index.ts"
    );
    const en = getTeamTemplate("content-seo");
    const pt = localizeTemplate(en, "pt-BR");
    expect(translateCatalogText(pt.name, "en")).toBe(en.name);
    expect(translateCatalogText(en.name, "pt-BR")).toBe(pt.name);
    expect(translateCatalogText(pt.department, "en")).toBe(en.department);
    expect(translateCatalogText(pt.playbooks[0]?.name ?? "", "en")).toBe(en.playbooks[0]?.name);
  });

  it("leaves customized or unknown text alone", async () => {
    const { translateCatalogText } = await import("../src/index.ts");
    expect(translateCatalogText("My special team", "pt-BR")).toBe("My special team");
  });
});
