const secretKeyPattern =
  /(?:authorization|cookie|password|secret|signature|token|databaseurl|databaseuri|connectionstring|apikey|privatekey|accesskey|credentials)$/i;

export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>());
}

function redactValue(value: unknown, visited: WeakSet<object>): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (visited.has(value)) {
    return "[CIRCULAR]";
  }

  visited.add(value);

  let redacted: unknown;

  if (Array.isArray(value)) {
    redacted = value.map((item) => redactValue(item, visited));
  } else {
    redacted = Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        secretKeyPattern.test(key)
          ? "[REDACTED]"
          : redactValue(nestedValue, visited),
      ]),
    );
  }

  visited.delete(value);
  return redacted;
}

type LogContext = Record<string, unknown>;
type LogSink = (entry: string) => void;

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export function createLogger(sink: LogSink): Logger {
  const write = (
    level: "info" | "warn" | "error",
    message: string,
    context?: LogContext,
  ) => {
    sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...(context ? { context: redact(context) } : {}),
      }),
    );
  };

  return {
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}
