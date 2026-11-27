import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CaseSchema, loadSuites } from "../src/cases.ts";
import { runChecks } from "../src/checks.ts";

const blog = CaseSchema.parse({
  id: "blog",
  prompt: "A blog post about composting",
  expect: { outcome: "awaiting_approval", mention: ["composting"], minWords: 3, headings: true },
});

describe("rule checks", () => {
  it("passes a delivery that meets every expectation", () => {
    const checks = runChecks(blog, {
      scope: "in",
      suggested: null,
      outcome: "awaiting_approval",
      text: "# Composting\n\nStart composting at home today.",
    });
    expect(checks.every((c) => c.pass)).toBe(true);
  });

  it("names what failed", () => {
    const checks = runChecks(blog, {
      scope: "in",
      suggested: null,
      outcome: "failed",
      text: "Too short",
    });
    expect(checks.filter((c) => !c.pass).map((c) => c.name)).toEqual([
      "outcome",
      'mentions "composting"',
      "at least 3 words",
      "uses headings",
    ]);
  });

  it("checks refusals and where they point", () => {
    const offTopic = CaseSchema.parse({
      id: "x",
      prompt: "Fix the bug",
      expect: { scope: "out", suggests: "code-review" },
    });
    expect(
      runChecks(offTopic, { scope: "out", suggested: "code-review" }).every((c) => c.pass),
    ).toBe(true);
    expect(runChecks(offTopic, { scope: "in", suggested: null }).map((c) => c.pass)).toEqual([
      false,
      false,
    ]);
  });

  it("every team has valid cases, including at least one refusal", () => {
    const suites = loadSuites(fileURLToPath(new URL("../cases", import.meta.url)));
    expect(suites.map((s) => s.team)).toEqual(["code-review", "content-seo", "market-research"]);
    for (const s of suites) expect(s.cases.some((c) => c.expect.scope === "out")).toBe(true);
  });
});
