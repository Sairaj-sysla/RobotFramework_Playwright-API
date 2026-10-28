/**
 * Validates configuration and prints it with secrets masked, then reports the
 * toolchain Robot Framework will run on (Python, Robot, Browser, Batteries,
 * installed Playwright browsers).
 *   node dist/scripts/checkEnv.js
 *
 * Exit codes: 0 valid, 252 invalid configuration, 255 toolchain problem.
 */
import { spawnSync } from 'node:child_process';
import { getConfig, projectRoot } from '../src/config/configManager.js';
import { summarizeConfig } from '../src/config/environmentConfig.js';
import { formatError } from '../src/utils/errorHandler.js';
import { robotPython } from './processUtils.js';

// Runs inside the Robot Python. Prints JSON only; never prints environment values other than
// PLAYWRIGHT_BROWSERS_PATH (a directory, not a secret).
const PROBE = `
import importlib.metadata as md, importlib.util, json, os, platform, sys
def version(name):
    try:
        return md.version(name)
    except md.PackageNotFoundError:
        return None
info = {
    "python": platform.python_version(),
    "executable": sys.executable,
    "robotframework": version("robotframework"),
    "robotframework-browser": version("robotframework-browser"),
    "robotframework-browser-batteries": version("robotframework-browser-batteries"),
}
browsers = None
if importlib.util.find_spec("Browser"):
    from Browser.entry.constant import get_playwright_browser_path
    path = get_playwright_browser_path()
    browsers = {"path": str(path), "installed": sorted(p.name for p in path.iterdir()) if path.is_dir() else []}
info["playwrightBrowsers"] = browsers
print(json.dumps(info))
`;

interface Toolchain {
  python: string;
  executable: string;
  robotframework: string | null;
  'robotframework-browser': string | null;
  'robotframework-browser-batteries': string | null;
  playwrightBrowsers: { path: string; installed: string[] } | null;
}

function checkToolchain(): string[] {
  const python = robotPython(projectRoot());
  const result = spawnSync(python, ['-c', PROBE], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return [`Could not run Robot Framework's Python '${python}': ${result.error?.message ?? result.stderr.trim()}. Create .venv (see README) or set ROBOT_PYTHON.`];
  }
  const info = JSON.parse(result.stdout) as Toolchain;
  console.log(JSON.stringify({ toolchain: { ...info, node: process.version } }, null, 2));

  const problems: string[] = [];
  if (!info.robotframework) problems.push('robotframework is not installed in the Robot Python.');
  if (!info['robotframework-browser']) problems.push('robotframework-browser is not installed in the Robot Python.');
  if (info['robotframework-browser-batteries'] && info['robotframework-browser-batteries'] !== info['robotframework-browser']) {
    problems.push(`robotframework-browser ${info['robotframework-browser']} and robotframework-browser-batteries ${info['robotframework-browser-batteries']} must be the same version.`);
  }
  const installed = info.playwrightBrowsers?.installed ?? [];
  if (info['robotframework-browser'] && !installed.some((name) => name.startsWith('chromium'))) {
    const command = info['robotframework-browser-batteries'] ? 'rfbrowser install chromium' : 'rfbrowser init chromium';
    problems.push(`No Playwright Chromium found in ${info.playwrightBrowsers?.path}. Run '${command}' (system browsers via BROWSER_CHANNEL still work).`);
  }
  return problems;
}

try {
  console.log(JSON.stringify(summarizeConfig(getConfig()), null, 2));
  console.log('Configuration is valid.');
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(252);
}

const problems = checkToolchain();
if (problems.length) {
  process.stderr.write(`[ENVIRONMENT] Toolchain problems:\n  - ${problems.join('\n  - ')}\n`);
  process.exit(255);
}
console.log('Toolchain is ready.');
