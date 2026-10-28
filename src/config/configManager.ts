/**
 * Loads configuration once per process: values already present in the
 * environment win over values in `.env`, so CI secrets are never overridden by
 * a stray local file.
 */
import fs from 'node:fs';
import path from 'node:path';
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

let cached: FrameworkConfig | undefined;

export function getConfig(): FrameworkConfig {
  if (!cached) {
    loadDotEnv();
    cached = parseConfig(process.env);
  }
  return cached;
}
