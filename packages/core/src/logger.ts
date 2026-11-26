type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

/** One JSON object per line, so any log collector can parse it. */
export function createLogger(base: Record<string, unknown> = {}): Logger {
  const write = (level: Level, message: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      message,
      ...base,
      ...fields,
    });
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}
