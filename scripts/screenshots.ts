/**
 * Captures the README screenshots from a running squadai, end to end:
 * signs up a fresh account, turns on demo mode, hires teams, makes requests
 * (including a handoff and a tool permission) and photographs every screen.
 *
 *   docker compose up -d --build
 *   pnpm screenshots                 # English, into docs/images
 *   SCREENSHOT_LOCALE=pt-BR pnpm screenshots
 *
 * Uses an installed Chromium-based browser (Edge or Chrome) through
 * playwright-core, so there is nothing extra to download. Set
 * SCREENSHOT_BROWSER=chrome to use Chrome, or SCREENSHOT_EXECUTABLE to point
 * at any Chromium binary.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";

const BASE = process.env.SCREENSHOT_URL ?? "http://localhost:3000";
const LOCALE = process.env.SCREENSHOT_LOCALE === "pt-BR" ? "pt-BR" : "en";
const OUT = join(import.meta.dirname, "..", "docs", "images");
const SUFFIX = LOCALE === "en" ? "" : `-${LOCALE}`;

const TEXT = {
  en: {
    name: "Your name",
    email: "Email",
    password: "Password",
    createAccount: "Create account and meet the team",
    demo: "Demo mode",
    hire: "Hire this team",
    request: "Write a blog post about the price of home solar panels",
    review: "Review the PR github.com/octocat/Hello-World/pull/1",
    suggested: "suggested",
    ask: /^Ask /,
    askTeam: "Ask the team",
    ready: "is ready for you to review",
    allow: "Allow",
    approve: "Approve and deliver",
  },
  "pt-BR": {
    name: "Seu nome",
    email: "E-mail",
    password: "Senha",
    createAccount: "Criar conta e conhecer o time",
    demo: "Modo demonstração",
    hire: "Contratar este time",
    request: "Preciso de um artigo sobre o preço de painel solar residencial",
    review: "Revise o PR github.com/octocat/Hello-World/pull/1",
    suggested: "sugerido",
    ask: /^Pedir para /,
    askTeam: "Pedir ao time",
    ready: "está pronto para você revisar",
    allow: "Permitir",
    approve: "Aprovar e entregar",
  },
}[LOCALE];

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
  const file = join(OUT, `${name}${SUFFIX}.png`);
  await page.screenshot({ path: file });
  console.log(`✓ ${file}`);
}

/** Waits until a live page shows some text (pages refresh themselves over SSE). */
async function waitForText(page: Page, text: string, timeoutMs = 120_000) {
  await page.waitForFunction((t) => document.body.textContent?.includes(t) ?? false, text, {
    timeout: timeoutMs,
  });
}

async function launch(): Promise<Browser> {
  const executablePath = process.env.SCREENSHOT_EXECUTABLE;
  if (executablePath) return chromium.launch({ executablePath });
  return chromium.launch({ channel: process.env.SCREENSHOT_BROWSER ?? "msedge" });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: LOCALE === "en" ? "en-US" : "pt-BR",
  });
  await context.addCookies([{ name: "squadai-locale", value: LOCALE, url: BASE }]);
  const page = await context.newPage();

  // Sign up: the office arrives with its starter team.
  await page.goto(`${BASE}/sign-in`);
  await shot(page, "sign-in");
  const id = Date.now().toString(36);
  await page.getByLabel(TEXT.name).fill("Ana Souza");
  await page.getByLabel(TEXT.email).fill(`ana.${id}@example.test`);
  await page.getByLabel(TEXT.password).fill(`demo-${id}-password`);
  await page.getByRole("button", { name: TEXT.createAccount }).click();
  await page.waitForURL(`${BASE}/`);

  // Demo mode: the full flow with no API key and no cost.
  await page.goto(`${BASE}/models`);
  const demo = page.getByRole("switch", { name: TEXT.demo });
  if ((await demo.getAttribute("aria-checked")) !== "true") await demo.click();
  await page.waitForTimeout(800);

  // Hire the other two teams.
  for (let i = 0; i < 2; i++) {
    await page.goto(`${BASE}/hire`);
    await page.getByRole("button", { name: TEXT.hire }).first().click();
    await page.waitForURL(/\/teams\//);
  }
  await page.goto(`${BASE}/hire`);
  await shot(page, "hire");

  // A request routed to the right team; its research asks another team for prices.
  await page.goto(`${BASE}/new-request`);
  await page.locator("textarea").fill(TEXT.request);
  await page.getByText(TEXT.suggested).waitFor();
  await shot(page, "new-request");
  await page.getByRole("button", { name: TEXT.ask }).click();
  await page.waitForURL(/\/teams\//);
  await page.waitForTimeout(4000);
  await shot(page, "team-working");
  await waitForText(page, TEXT.ready);
  await shot(page, "team");

  // The delivery: versions, review notes, who did what and what it cost.
  await page.locator('a[href^="/deliveries/"]').first().click();
  await page.waitForURL(/\/deliveries\//);
  await shot(page, "delivery");
  await page.getByRole("button", { name: TEXT.approve }).click();
  await page.waitForTimeout(1500);

  // A code review that stops to ask permission before commenting on GitHub.
  await page.goto(`${BASE}/teams/code-review`);
  await page.locator("textarea").first().fill(TEXT.review);
  await page.getByRole("button", { name: TEXT.askTeam }).click();
  await page.goto(`${BASE}/waiting`);
  await waitForText(page, TEXT.allow);
  await shot(page, "waiting");
  await page.getByRole("button", { name: TEXT.allow, exact: true }).click();

  // One more delivery so the office has something waiting.
  await page.goto(`${BASE}/new-request`);
  await page
    .locator("textarea")
    .fill(TEXT.request.replace(/solar panels|painel solar residencial/, "vertical gardens"));
  await page.getByText(TEXT.suggested).waitFor();
  await page.getByRole("button", { name: TEXT.ask }).click();
  await page.waitForURL(/\/teams\//);
  await waitForText(page, TEXT.ready);

  await page.goto(`${BASE}/`);
  await shot(page, "home");

  await page.goto(`${BASE}/teams/content-seo`);
  await page.locator('a[href^="/agents/"]').first().click();
  await page.waitForURL(/\/agents\//);
  await shot(page, "agent");

  await page.goto(`${BASE}/models`);
  await shot(page, "models");
  await page.goto(`${BASE}/integrations`);
  await shot(page, "integrations");
  await page.goto(`${BASE}/audit`);
  await shot(page, "audit");

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
