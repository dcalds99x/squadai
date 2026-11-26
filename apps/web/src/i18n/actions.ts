"use server";

import { isLocale } from "@squadai/core";
import { revalidatePath } from "next/cache";
import { setUserLocale } from "./locale";

/** The language switcher: remembers the person's interface language in a cookie. */
export async function setLocaleAction(locale: string): Promise<{ ok: boolean }> {
  if (!isLocale(locale)) return { ok: false };
  await setUserLocale(locale);
  revalidatePath("/", "layout");
  return { ok: true };
}
