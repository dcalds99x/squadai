import { getRequestConfig } from "next-intl/server";
import { DEFAULT_TIMEZONE } from "@/lib/env";
import { getUserLocale } from "./locale";
import { MESSAGES } from "./messages";

/**
 * next-intl without locale routing: URLs stay the same in every language and
 * the locale comes from the person's preference (cookie, then Accept-Language).
 */
export default getRequestConfig(async () => {
  const locale = await getUserLocale();
  return {
    locale,
    messages: MESSAGES[locale],
    timeZone: process.env.SQUADAI_TIMEZONE || DEFAULT_TIMEZONE,
  };
});
