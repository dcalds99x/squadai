/**
 * Numbers, money, dates and durations for the person's locale. Pure functions,
 * so server and client components format the same way (and tests can check it).
 */
import type { Locale } from "@squadai/core";

export type DayPeriod = "morning" | "afternoon" | "evening";

/** Which greeting fits this moment in the office's time zone. */
export function dayPeriod(now: Date, timeZone: string): DayPeriod {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone }).format(now),
  );
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

/** "Quinta-feira, 26 de novembro" / "Thursday, November 26". */
export function longDate(now: Date, timeZone: string, locale: Locale): string {
  const text = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Whole amounts without cents: "US$ 20" / "$20"; otherwise "US$ 0,12" / "$0.12". */
export function formatMoney(cents: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** Model costs are tiny: show 4 decimals below a cent. Costs are recorded in micro-dollars. */
export function formatUsdMicros(micros: number, locale: Locale): string {
  const usd = micros / 1_000_000;
  const digits = usd !== 0 && usd < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(usd);
}

export function formatPercent(ratio: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
    ratio,
  );
}

/** "45 min", "~3 h", "~1,5 h" / "~1.5 h". */
export function formatDuration(minutes: number, locale: Locale): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(minutes / 60);
  return `~${hours} h`;
}

export function formatTime(date: Date, timeZone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(
    date,
  );
}

export function formatDateTime(date: Date, timeZone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

/** A number for an input field, without grouping: "20,5" / "20.5". */
export function formatDecimalInput(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 2 }).format(
    value,
  );
}

/**
 * Reads a number typed in the person's locale ("1.234,5" / "1,234.5"). Returns
 * null for an empty field and NaN for text that is not a number.
 */
export function parseDecimal(raw: string, locale: Locale): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
  const group = parts.find((p) => p.type === "group")?.value ?? ",";
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const normalized = text.split(group).join("").replace(decimal, ".");
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}
