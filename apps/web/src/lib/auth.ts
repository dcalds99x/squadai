import "server-only";
import { createLogger } from "@squadai/core";
import { createWorkspaceForUser, getDb, schema } from "@squadai/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { localeFromHeaders } from "@/i18n/locale";
import { seedDemoOffice } from "./demo";
import { env, githubEnabled, publicDemo } from "./env";

const log = createLogger({ service: "web", module: "auth" });

function createAuth() {
  const e = env();
  const db = getDb();
  return betterAuth({
    appName: "squadai",
    secret: e.BETTER_AUTH_SECRET,
    baseURL: e.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    socialProviders: githubEnabled()
      ? {
          github: {
            clientId: e.GITHUB_CLIENT_ID as string,
            clientSecret: e.GITHUB_CLIENT_SECRET as string,
          },
        }
      : {},
    databaseHooks: {
      user: {
        create: {
          // Every new person gets an office with the starter team, in their language.
          after: async (user, context) => {
            const demo = publicDemo();
            const { workspaceId } = await createWorkspaceForUser(db, {
              userId: user.id,
              userName: user.name,
              locale: localeFromHeaders(context?.headers ?? context?.request?.headers),
              demo,
            });
            if (demo) await seedDemoOffice(workspaceId, user.id);
            log.info("workspace created", { userId: user.id, workspaceId, demo });
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { squadaiAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.squadaiAuth ??= createAuth();
  return globalForAuth.squadaiAuth;
}
