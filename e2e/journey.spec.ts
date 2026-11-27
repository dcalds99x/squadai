/**
 * The main journey, as a new person lives it: sign up, turn on demo mode, ask
 * a team for something in their own words, approve the delivery, then give an
 * agent a tool that asks first and allow it from "Waiting on you". Along the
 * way: a refusal that points to the right team, and a checkpoint.
 */
import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let page: Page;
const email = `e2e-${randomUUID().slice(0, 8)}@example.test`;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page?.close();
});

/** Types a request on a team page and sends it, with "Team decides" or a delivery type. */
async function ask(prompt: string, kind?: string) {
  await page.getByPlaceholder(/What can the .* team do for you\?/).fill(prompt);
  if (kind) await page.getByText(kind, { exact: true }).first().click();
  await page.getByRole("button", { name: "Ask the team" }).click();
}

const room = () => page.getByRole("complementary").or(page.locator("aside")).last();

test("signs up and lands in the office", async () => {
  await page.goto("/sign-in");
  await page.getByPlaceholder("What the team will call you").fill("Erin Tester");
  await page.locator('input[type="email"]').fill(email);
  // A throwaway password for a throwaway account in the test database.
  await page.locator('input[type="password"]').fill(`e2e-${randomUUID()}`);
  await page.getByRole("button", { name: "Create account and meet the team" }).click();
  await expect(page.getByRole("link", { name: "Content & SEO", exact: true })).toBeVisible();
});

test("turns on demo mode", async () => {
  await page.goto("/models");
  const toggle = page.getByRole("switch", { name: "Demo mode" });
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});

test("refuses off-topic work and says so", async () => {
  await page.goto("/teams/content-seo");
  await ask("Fix the bug in our checkout code");
  await expect(page.getByText("That's outside what Content & SEO does.")).toBeVisible();
});

test("asks in its own words; the lead plans and the team delivers", async () => {
  await page.goto("/teams/content-seo");
  await ask("Write a launch email for our new balcony garden kit");
  await expect(room().getByText(/^Plan for “.+”: Lia researches → Téo writes/)).toBeVisible();
  await expect(room().getByText(/Back to you, Téo/)).toBeVisible();
  await expect(
    room()
      .getByText(/is ready for you to review\./)
      .first(),
  ).toBeVisible();
});

test("approves the delivery", async () => {
  await page.goto("/waiting");
  await page.getByRole("link", { name: "Review" }).first().click();
  await expect(page.getByText(/launch email/i).first()).toBeVisible();
  await page.getByRole("button", { name: "Approve and deliver" }).click();
  await expect(page.getByText(/Delivered\./).first()).toBeVisible();
});

test("stops at a checkpoint until you say go on", async () => {
  await page.goto("/teams/content-seo");
  await ask("A case study about a bakery that doubled online orders", "Case study");
  await page.goto("/waiting");
  await expect(page.getByText("wants your OK before the team goes on")).toBeVisible();
  await page.getByRole("button", { name: "Go on" }).click();
  await expect(page.getByText("wants your OK before the team goes on")).toHaveCount(0);
  await expect(
    page.getByText("A case study about a bakery that doubled online orders"),
  ).toBeVisible();
});

test("an agent asks before using a tool, and you allow it", async () => {
  await page.goto("/teams/content-seo");
  await page.getByRole("link", { name: /Lia/ }).first().click();
  const webSearch = page.getByRole("group", { name: "Search the web" });
  await webSearch.getByText("Asks first", { exact: true }).click();
  await expect(webSearch.getByRole("radio", { name: "Asks first" })).toBeChecked();

  await page.goto("/teams/content-seo");
  await ask("A newsletter about city beekeeping", "Newsletter");
  await page.goto("/waiting");
  await expect(page.getByText(/wants to use/)).toBeVisible();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(page.getByText(/wants to use/)).toHaveCount(0);
});
