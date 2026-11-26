import { describe, expect, it } from "vitest";
import {
  dayPeriod,
  formatDecimalInput,
  formatDuration,
  formatMoney,
  formatUsdMicros,
  longDate,
  parseDecimal,
} from "../src/lib/format.ts";

const tz = "America/Sao_Paulo";
// Thursday, 26 November 2026, 09:30 in São Paulo.
const morning = new Date("2026-11-26T12:30:00Z");

describe("format", () => {
  it("picks the greeting from the office's time zone", () => {
    expect(dayPeriod(morning, tz)).toBe("morning");
    expect(dayPeriod(new Date("2026-11-26T18:00:00Z"), tz)).toBe("afternoon");
    expect(dayPeriod(new Date("2026-11-27T01:00:00Z"), tz)).toBe("evening");
  });

  it("writes dates the way each language does", () => {
    expect(longDate(morning, tz, "pt-BR")).toBe("Quinta-feira, 26 de novembro");
    expect(longDate(morning, tz, "en")).toBe("Thursday, November 26");
  });

  it("formats money and durations for the locale", () => {
    // Intl puts a no-break space between "US$" and the amount.
    expect(formatMoney(2000, "USD", "pt-BR")).toBe("US$ 20");
    expect(formatMoney(2000, "USD", "en")).toBe("$20");
    expect(formatUsdMicros(1234, "en")).toBe("$0.0012");
    expect(formatUsdMicros(1_500_000, "pt-BR")).toBe("US$ 1,50");
    expect(formatDuration(45, "en")).toBe("45 min");
    expect(formatDuration(90, "pt-BR")).toBe("~1,5 h");
    expect(formatDuration(90, "en")).toBe("~1.5 h");
  });

  it("reads numbers typed in either convention", () => {
    expect(parseDecimal("1.234,5", "pt-BR")).toBe(1234.5);
    expect(parseDecimal("20,50", "pt-BR")).toBe(20.5);
    expect(parseDecimal("1,234.5", "en")).toBe(1234.5);
    expect(parseDecimal("20.50", "en")).toBe(20.5);
    expect(parseDecimal("  ", "en")).toBeNull();
    expect(parseDecimal("twenty", "en")).toBeNaN();
    expect(formatDecimalInput(20.5, "pt-BR")).toBe("20,5");
    expect(formatDecimalInput(1234.5, "en")).toBe("1234.5");
  });
});
