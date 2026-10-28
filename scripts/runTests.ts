/**
 * Test orchestrator: validates configuration, starts the demo app and the
 * TypeScript API remote server, runs Robot Framework, stops the services and
 * exits with Robot's own return code.
 *
 *   node dist/scripts/runTests.js [--no-demo-app] [--no-remote] [robot options] [data sources]
 *
 * Without a data source, `tests` is used. Unless the arguments mention the
 * `intentional-failure` tag, tests with that tag are excluded.
 *
 * Exit codes: Robot's code (0 = all passed, 1-250 = failed test count, 252 = invalid
 * Robot arguments, 253 = interrupted), 252 for invalid configuration, 255 when a
 * service fails to start.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getConfig, projectRoot } from '../src/config/configManager.js';
import { FrameworkError, formatError, ErrorCategory } from '../src/utils/errorHandler.js';
import { buildRobotArgs } from './robotArgs.js';
import { httpOk, isPortInUse, remoteServerReady, startNodeService, stopService, waitUntilReady, type ManagedProcess } from './processUtils.js';

const STARTUP_TIMEOUT_MS = 20_000;
const EXIT_CONFIGURATION = 252;
const EXIT_ENVIRONMENT = 255;

function robotPython(root: string): string {
  if (process.env.ROBOT_PYTHON) return process.env.ROBOT_PYTHON;
  const candidates = process.platform === 'win32'
    ? [path.join(root, '.venv', 'Scripts', 'python.exe')]
    : [path.join(root, '.venv', 'bin', 'python')];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? (process.platform === 'win32' ? 'python' : 'python3');
}

async function main(): Promise<number> {
  const root = projectRoot();
  const argv = process.argv.slice(2);
  const startDemoFlag = !argv.includes('--no-demo-app');
  const startRemote = !argv.includes('--no-remote');
  const userArgs = argv.filter((arg) => arg !== '--no-demo-app' && arg !== '--no-remote');

  let config;
  try {
    config = getConfig();
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    return EXIT_CONFIGURATION;
  }

  const resultsDir = path.resolve(root, config.resultsDir);
  const logsDir = path.join(resultsDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, RESULTS_DIR: resultsDir };
  // Robot Framework 7.5 uses PYTHONIOENCODING verbatim as a codec name when output is not a
  // terminal, so the valid Python form "utf-8:surrogateescape" crashes it. Keep the encoding only.
  if (env.PYTHONIOENCODING?.includes(':')) env.PYTHONIOENCODING = env.PYTHONIOENCODING.split(':')[0];
  const services: ManagedProcess[] = [];

  const stopAll = async () => {
    await Promise.all(services.splice(0).reverse().map((service) => stopService(service)));
  };
  let interrupted = false;
  const onSignal = () => {
    interrupted = true; // Robot receives the same Ctrl+C and stops gracefully; services are stopped in finally.
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    if (startDemoFlag && config.startDemoApp) {
      if (await isPortInUse('127.0.0.1', config.demoAppPort)) {
        throw new FrameworkError(ErrorCategory.Environment, `Port ${config.demoAppPort} is already in use; stop the other process or set DEMO_APP_PORT/START_DEMO_APP.`);
      }
      const demo = startNodeService('Demo app', path.join(root, 'dist', 'demo-app', 'server.js'), path.join(logsDir, 'demo-app.log'), env);
      services.push(demo);
      await waitUntilReady(demo, () => httpOk(`${config.apiBaseUrl}/health`), STARTUP_TIMEOUT_MS);
      console.log(`[orchestrator] Demo app ready at ${config.baseUrl}`);
    }

    if (startRemote) {
      const uri = `http://${config.remoteHost}:${config.remotePort}`;
      if (await isPortInUse(config.remoteHost, config.remotePort)) {
        throw new FrameworkError(ErrorCategory.Environment, `Remote server port ${config.remotePort} is already in use (a stale server?). Run 'npm run remote:stop' or change REMOTE_PORT.`);
      }
      const remote = startNodeService('API remote server', path.join(root, 'dist', 'src', 'remote', 'main.js'), path.join(logsDir, 'remote-server.log'), env);
      services.push(remote);
      await waitUntilReady(remote, () => remoteServerReady(uri), STARTUP_TIMEOUT_MS);
      console.log(`[orchestrator] API remote server ready at ${uri}`);
    }

    const python = robotPython(root);
    const robotArgs = buildRobotArgs(userArgs, { resultsDir, defaultDataSource: 'tests', excludedByDefault: 'intentional-failure' });
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
    console.log(`[orchestrator] Robot Framework finished with exit code ${code}. Service logs: ${logsDir}`);
    return code;
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    return error instanceof FrameworkError && error.category === ErrorCategory.Configuration ? EXIT_CONFIGURATION : EXIT_ENVIRONMENT;
  } finally {
    await stopAll();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(EXIT_ENVIRONMENT);
  },
);
