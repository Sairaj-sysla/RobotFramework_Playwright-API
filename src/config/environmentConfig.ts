/**
 * Framework configuration schema: every supported environment variable, its
 * type, default and validation. Values come from the process environment, which
 * configManager populates from an optional `.env` file.
 */
import { ConfigurationError } from '../utils/errorHandler.js';
import { isLogLevel, type LogLevel } from '../utils/logger.js';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';
/** Installed browsers Playwright can drive instead of its own Chromium build (`chromium` only). */
export const BROWSER_CHANNELS = ['chrome', 'chrome-beta', 'msedge', 'msedge-beta', 'msedge-dev'] as const;
export type BrowserChannel = (typeof BROWSER_CHANNELS)[number];

export interface FrameworkConfig {
  environment: string;
  /** ProjectBase URL; also the fallback for EASY_URL (OrangeHRM suite). */
  baseUrl: string;
  /** OrangeHRM login page (`getEasyURL()`); empty = use baseUrl. */
  easyUrl: string;
  /** Excel workbook with the OrangeHRM login rows. */
  orangeLoginWorkbook: string;
  appUsername: string;
  /** Secret. Never log; use summarizeConfig() for output. */
  appPassword: string;
  browser: BrowserName;
  /** System browser channel (chromium only); undefined = Playwright's bundled Chromium. */
  browserChannel: BrowserChannel | undefined;
  headless: boolean;
  browserTimeoutMs: number;
  navigationTimeoutMs: number;
  browserTracing: boolean;
  logLevel: LogLevel;
  resultsDir: string;
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

  optionalOneOf<T extends string>(name: string, allowed: readonly T[]): T | undefined {
    return this.raw(name) === undefined ? undefined : this.oneOf(name, allowed, allowed[0]!);
  }
}

/** Parses and validates configuration. Throws one error listing every problem. */
export function parseConfig(env: Env): FrameworkConfig {
  const read = new Reader(env);
  const logLevel = read.optional('LOG_LEVEL', 'info').toLowerCase();
  if (!isLogLevel(logLevel)) read.problems.push(`LOG_LEVEL must be debug, info, warn or error, got '${logLevel}'`);

  const config: FrameworkConfig = {
    environment: read.optional('TEST_ENV', 'local'),
    // Which of these a run needs depends on the suites: each suite setup validates its own
    // (ProjectBase: BASE_URL, APP_USERNAME, APP_PASSWORD; OrangeHRM: ORANGE_LOGIN_WORKBOOK).
    baseUrl: read.url('BASE_URL', false),
    easyUrl: read.url('EASY_URL', false),
    orangeLoginWorkbook: read.optional('ORANGE_LOGIN_WORKBOOK', ''),
    appUsername: read.optional('APP_USERNAME', ''),
    appPassword: read.optional('APP_PASSWORD', ''),
    browser: read.oneOf('BROWSER', ['chromium', 'firefox', 'webkit'] as const, 'chromium'),
    browserChannel: read.optionalOneOf('BROWSER_CHANNEL', BROWSER_CHANNELS),
    headless: read.boolean('HEADLESS', true),
    browserTimeoutMs: read.integer('BROWSER_TIMEOUT_MS', 10_000, 100, 300_000),
    navigationTimeoutMs: read.integer('NAVIGATION_TIMEOUT_MS', 30_000, 100, 300_000),
    browserTracing: read.boolean('BROWSER_TRACING', false),
    logLevel: isLogLevel(logLevel) ? logLevel : 'info',
    resultsDir: read.optional('RESULTS_DIR', 'results'),
  };

  if (config.browserChannel && config.browser !== 'chromium') {
    read.problems.push(`BROWSER_CHANNEL '${config.browserChannel}' requires BROWSER=chromium, got '${config.browser}'`);
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
    browserChannel: config.browserChannel ?? null,
    appPassword: config.appPassword ? '***set***' : '***missing***',
  };
}
