import type { Locale } from "@squadai/core";
import type { Messages } from "./i18n/messages";

// Types every next-intl call: an unknown message key or locale fails `pnpm typecheck`.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
