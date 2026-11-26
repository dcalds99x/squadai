import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const root = path.join(process.cwd(), "../..");

// In development, read the repository-level .env (Docker passes real env vars).
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {}

const config: NextConfig = {
  // A self-contained server bundle for the Docker image.
  output: "standalone",
  outputFileTracingRoot: root,
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    "@squadai/core",
    "@squadai/ui",
    "@squadai/db",
    "@squadai/catalog",
    "@squadai/engine",
    "@squadai/providers",
  ],
  serverExternalPackages: ["pg-boss"],
  poweredByHeader: false,
};

// Reads the request locale and messages from src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(config);
