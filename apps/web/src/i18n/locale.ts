import "server-only";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  type Locale,
  matchAcceptLanguage,
} from "@squadai/core";
import { cookies, headers } from "next/headers";

/**
 * A person's interface language: the language switcher's cookie, else what
 * the browser asks for, else pt-BR. See docs/adr/0009-internationalization.md.
 */
export function resolveLocale(input: {
  cookie: string | null | undefined;
  acceptLanguage: string | null | undefined;
}): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  return matchAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}

/** The current request's interface language. */
export async function getUserLocale(): Promise<Locale> {
  const [jar, all] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    cookie: jar.get(LOCALE_COOKIE)?.value,
    acceptLanguage: all.get("accept-language"),
  });
}

/** The same, from raw request headers (Better Auth hooks run outside a Next.js render). */
export function localeFromHeaders(raw: Headers | null | undefined): Locale {
  const cookie = raw
    ?.get("cookie")
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === LOCALE_COOKIE)?.[1];
  return resolveLocale({
    cookie: cookie ? decodeURIComponent(cookie) : null,
    acceptLanguage: raw?.get("accept-language"),
  });
}

export async function setUserLocale(locale: Locale): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
