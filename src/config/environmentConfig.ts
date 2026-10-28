/**
 * Framework configuration schema: every supported environment variable, its
 * type, default and validation. Values come from the process environment, which
 * configManager populates from an optional `.env` file.
 */
import { ConfigurationError } from '../utils/errorHandler.js';
import { isLogLevel, type LogLevel } from '../utils/logger.js';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export interface FrameworkConfig {
  environment: string;
  baseUrl: string;
  apiBaseUrl: string;
  /** Secret. Never log; use summarizeConfig() for output. */
  apiToken: string;
  appUsername: string;
  /** Secret. Never log; use summarizeConfig() for output. */
  appPassword: string;
  browser: BrowserName;
  headless: boolean;
  browserTimeoutMs: number;
  navigationTimeoutMs: number;
  browserTracing: boolean;
  apiTimeoutMs: number;
  apiRetries: number;
  logLevel: LogLevel;
  resultsDir: string;
  remoteHost: string;
  remotePort: number;
  startDemoApp: boolean;
  demoAppPort: number;
}

type Env = Record<string, string | undefined>;

class Reader {
  readonly problems: string[] = [];
  constructor(private readonly env: Env) {}

  private raw(name: string): string | undefined {
    const value = this.env[name]?.trim();
    return value === '' ? undefined : value;
  }

  required(name: string): string {
    const value = this.raw(name);
    if (value === undefined) this.problems.push(`${name} is required but not set`);
    return value ?? '';
  }

  optional(name: string, fallback: string): string {
    return this.raw(name) ?? fallback;
  }

  url(name: string, required = true, fallback = ''): string {
    const value = required ? this.required(name) : this.optional(name, fallback);
    if (value === '') return value;
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
    } catch {
      this.problems.push(`${name} must be an absolute http(s) URL, got '${value}'`);
    }
    return value.replace(/\/+$/, '');
  }

  integer(name: string, fallback: number, min: number, max: number): number {
    const value = this.raw(name);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      this.problems.push(`${name} must be an integer between ${min} and ${max}, got '${value}'`);
      return fallback;
    }
    return parsed;
  }

  boolean(name: string, fallback: boolean): boolean {
    const value = this.raw(name)?.toLowerCase();
    if (value === undefined) return fallback;
    if (['true', '1', 'yes'].includes(value)) return true;
    if (['false', '0', 'no'].includes(value)) return false;
    this.problems.push(`${name} must be true or false, got '${value}'`);
    return fallback;
  }

  oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
    const value = this.raw(name)?.toLowerCase();
    if (value === undefined) return fallback;
    if ((allowed as readonly string[]).includes(value)) return value as T;
    this.problems.push(`${name} must be one of ${allowed.join(', ')}, got '${value}'`);
    return fallback;
  }
}

/** Parses and validates configuration. Throws one error listing every problem. */
export function parseConfig(env: Env): FrameworkConfig {
  const read = new Reader(env);
  const logLevel = read.optional('LOG_LEVEL', 'info').toLowerCase();
  if (!isLogLevel(logLevel)) read.problems.push(`LOG_LEVEL must be debug, info, warn or error, got '${logLevel}'`);

  const config: FrameworkConfig = {
    environment: read.optional('TEST_ENV', 'local'),
    baseUrl: read.url('BASE_URL'),
    apiBaseUrl: read.url('API_BASE_URL'),
    apiToken: read.required('API_TOKEN'),
    appUsername: read.required('APP_USERNAME'),
    appPassword: read.required('APP_PASSWORD'),
    browser: read.oneOf('BROWSER', ['chromium', 'firefox', 'webkit'] as const, 'chromium'),
    headless: read.boolean('HEADLESS', true),
    browserTimeoutMs: read.integer('BROWSER_TIMEOUT_MS', 10_000, 100, 300_000),
    navigationTimeoutMs: read.integer('NAVIGATION_TIMEOUT_MS', 15_000, 100, 300_000),
    browserTracing: read.boolean('BROWSER_TRACING', false),
    apiTimeoutMs: read.integer('API_TIMEOUT_MS', 10_000, 100, 300_000),
    apiRetries: read.integer('API_RETRIES', 1, 0, 5),
    logLevel: isLogLevel(logLevel) ? logLevel : 'info',
    resultsDir: read.optional('RESULTS_DIR', 'results'),
    remoteHost: read.optional('REMOTE_HOST', '127.0.0.1'),
    remotePort: read.integer('REMOTE_PORT', 8270, 1, 65_535),
    startDemoApp: read.boolean('START_DEMO_APP', true),
    demoAppPort: read.integer('DEMO_APP_PORT', 3000, 1, 65_535),
  };

  if (config.apiToken && config.apiToken.length < 16) {
    read.problems.push('API_TOKEN must be at least 16 characters');
  }
  if (read.problems.length) {
    throw new ConfigurationError(
      `Invalid configuration:\n  - ${read.problems.join('\n  - ')}\nSee .env.example for the supported variables.`,
    );
  }
  return config;
}

/** Configuration safe to print or log: secrets are replaced by their presence. */
export function summarizeConfig(config: FrameworkConfig): Record<string, unknown> {
  return {
    ...config,
    apiToken: config.apiToken ? '***set***' : '***missing***',
    appPassword: config.appPassword ? '***set***' : '***missing***',
  };
}
