/**
 * Test orchestrator: validates configuration, runs Robot Framework, redacts secrets from
 * Playwright traces and exits with Robot's own return code.
 *
 *   node dist/scripts/runTests.js [--env <profile>] [robot options] [data sources]
 *
 * Without a data source, `tests` is used.
 *
 * Exit codes: Robot's code (0 = all passed, 1-250 = failed test count, 252 = invalid
 * Robot arguments, 253 = interrupted), 252 for invalid configuration, 255 when Robot cannot be
 * started or trace redaction fails.
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getConfig, projectRoot } from '../src/config/configManager.js';
import { formatError, ErrorCategory } from '../src/utils/errorHandler.js';
import { buildRobotArgs, effectiveOutputDir } from './robotArgs.js';
import { redactTraces } from './traceRedaction.js';
import { workbookSecrets } from './workbookSecrets.js';
import { robotPython } from './processUtils.js';

const EXIT_CONFIGURATION = 252;
const EXIT_ENVIRONMENT = 255;

async function main(): Promise<number> {
  const root = projectRoot();
  const argv = process.argv.slice(2);
  // --env <name>: use the environment profile .env.<name> (see configManager.loadEnvProfile).
  const envIndex = argv.indexOf('--env');
  if (envIndex >= 0) {
    const profile = argv[envIndex + 1];
    if (!profile || profile.startsWith('-')) {
      process.stderr.write(`[${ErrorCategory.Configuration}] --env needs a profile name, e.g. --env staging\n`);
      return EXIT_CONFIGURATION;
    }
    process.env.TEST_ENV = profile;
    argv.splice(envIndex, 2);
  }
  const userArgs = argv;

  let config;
  try {
    config = getConfig();
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    return EXIT_CONFIGURATION;
  }

  const resultsDir = path.resolve(root, config.resultsDir);
  const outputDir = path.resolve(root, effectiveOutputDir(userArgs, resultsDir));
  const env: NodeJS.ProcessEnv = { ...process.env, RESULTS_DIR: resultsDir };
  // Robot Framework 7.5 uses PYTHONIOENCODING verbatim as a codec name when output is not a
  // terminal, so the valid Python form "utf-8:surrogateescape" crashes it. Keep the encoding only.
  if (env.PYTHONIOENCODING?.includes(':')) env.PYTHONIOENCODING = env.PYTHONIOENCODING.split(':')[0];

  let interrupted = false;
  const onSignal = () => {
    interrupted = true; // Robot receives the same Ctrl+C and stops gracefully.
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const python = robotPython(root);
  const robotArgs = buildRobotArgs(userArgs, { resultsDir, defaultDataSource: 'tests', excludedByDefault: [] });
  console.log(`[orchestrator] ${python} ${robotArgs.join(' ')}`);
  const robot = spawn(python, robotArgs, { cwd: root, env, stdio: 'inherit' });
  const code = await new Promise<number>((resolve) => {
    robot.once('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 253 : 255)));
    robot.once('error', (error) => {
      process.stderr.write(`[${ErrorCategory.Environment}] Could not start Robot Framework with '${python}': ${error.message}. Create the virtual environment or set ROBOT_PYTHON.\n`);
      resolve(EXIT_ENVIRONMENT);
    });
  });
  if (interrupted) console.log('[orchestrator] Interrupted');
  console.log(`[orchestrator] Robot Framework finished with exit code ${code}. Results: ${outputDir}`);
  try {
    const secrets = [config.appPassword, ...workbookSecrets(root, config.orangeLoginWorkbook)];
    const redaction = redactTraces(outputDir, secrets);
    if (redaction.traces) {
      console.log(`[orchestrator] Redacted ${redaction.replacements} secret occurrence(s) in ${redaction.traces} trace file(s); removed unpacked trace temp files: ${redaction.removedTempDir}`);
    }
  } catch (error) {
    // Never let a possible secret leak pass silently: fail an otherwise green run.
    process.stderr.write(`[SECURITY] Could not redact secrets from Playwright traces: ${(error as Error).message}. Treat ${outputDir}/browser/traces as sensitive.\n`);
    return code === 0 ? EXIT_ENVIRONMENT : code;
  }
  return code;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(EXIT_ENVIRONMENT);
  },
);
