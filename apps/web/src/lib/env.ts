import "server-only";
import { z } from "zod";

/** Where dates and times are shown when SQUADAI_TIMEZONE is not set. */
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
  // On Render the public URL is known; elsewhere set it.
  BETTER_AUTH_URL: z.url().default(process.env.RENDER_EXTERNAL_URL ?? "http://localhost:3000"),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  SQUADAI_TIMEZONE: z.string().default(DEFAULT_TIMEZONE),
  SQUADAI_MASTER_KEY: z.string().optional(),
  /**
   * "1" for a public demo: offices start in demo mode with every team and sample
   * work, and nobody can add API keys, integrations or MCP servers (strangers'
   * secrets, and URLs the server would call).
   */
  SQUADAI_PUBLIC_DEMO: z.enum(["0", "1"]).default("0"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Read lazily so `next build` works without runtime secrets. */
export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function publicDemo(): boolean {
  return env().SQUADAI_PUBLIC_DEMO === "1";
}

export function githubEnabled(): boolean {
  const e = env();
  return Boolean(e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET);
}
