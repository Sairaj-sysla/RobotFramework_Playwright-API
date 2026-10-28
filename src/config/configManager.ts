/**
 * Loads configuration once per process: values already present in the
 * environment win over values in `.env`, so CI secrets are never overridden by
 * a stray local file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ConfigurationError } from '../utils/errorHandler.js';
import { parseConfig, type FrameworkConfig } from './environmentConfig.js';

/** Project root: dist/src/config -> ../../.. ; src/config -> ../.. */
export function projectRoot(): string {
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  return dir;
}

/** Loads `.env` into process.env without overriding variables that are already set. */
export function loadDotEnv(file = path.join(projectRoot(), '.env')): boolean {
  if (!fs.existsSync(file)) return false;
  // process.loadEnvFile (Node >= 20.12) never overrides existing variables.
  process.loadEnvFile(file);
  return true;
}

const PROFILE_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Environment profile: with TEST_ENV=<name> (e.g. `projectbase`), `.env.<name>` is loaded before
 * `.env`, so its values win over `.env` while real environment variables still win over both.
 * Returns the profile file that was loaded, if any. Throws for a missing profile file so a typo
 * never silently falls back to the default `.env` configuration.
 */
export function loadEnvProfile(root = projectRoot()): string | undefined {
  const name = process.env.TEST_ENV?.trim().toLowerCase();
  if (!name || name === 'local' || name === 'ci') return undefined;
  if (!PROFILE_NAME.test(name)) throw new ConfigurationError(`TEST_ENV '${name}' must contain only lowercase letters, digits and '-'.`);
  const file = path.join(root, `.env.${name}`);
  if (!fs.existsSync(file)) {
    throw new ConfigurationError(`TEST_ENV=${name} but ${file} does not exist. Copy .env.${name}.example to .env.${name} and fill it in.`);
  }
  process.loadEnvFile(file);
  return file;
}

let cached: FrameworkConfig | undefined;

export function getConfig(): FrameworkConfig {
  if (!cached) {
    loadEnvProfile();
    loadDotEnv();
    cached = parseConfig(process.env);
  }
  return cached;
}
