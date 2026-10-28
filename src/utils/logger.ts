/**
 * Small structured logger for framework processes (remote server, demo app,
 * orchestrator). Output goes to stderr as one JSON object per line so it can be
 * captured to a file and filtered. Robot Framework log output for keywords is
 * written separately through KeywordContext.log.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function isLogLevel(value: string): value is LogLevel {
  return value in LEVEL_ORDER;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(
  component: string,
  level: LogLevel = 'info',
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): Logger {
  const emit = (messageLevel: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[messageLevel] < LEVEL_ORDER[level]) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: messageLevel, component, message, ...fields }));
  };
  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}
