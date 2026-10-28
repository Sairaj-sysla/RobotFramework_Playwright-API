/**
 * Redacts the configured secrets (APP_PASSWORD and the Password column of ORANGE_LOGIN_WORKBOOK) from the Playwright trace zips of a
 * results directory. The orchestrator does this automatically; use this after running `robot`
 * directly with tracing enabled.
 *   npm run traces:redact -- [outputDir]        (default: RESULTS_DIR)
 *
 * Exit codes: 0 redacted (or nothing to do), 252 invalid configuration, 255 redaction failed.
 */
import path from 'node:path';
import { getConfig, projectRoot } from '../src/config/configManager.js';
import { formatError } from '../src/utils/errorHandler.js';
import { redactTraces } from './traceRedaction.js';
import { workbookSecrets } from './workbookSecrets.js';

let config;
try {
  config = getConfig();
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(252);
}

const outputDir = path.resolve(projectRoot(), process.argv[2] ?? config.resultsDir);
try {
  const result = redactTraces(outputDir, [config.appPassword, ...workbookSecrets(projectRoot(), config.orangeLoginWorkbook)]);
  console.log(`Redacted ${result.replacements} secret occurrence(s) in ${result.traces} trace file(s) under ${outputDir}; removed unpacked trace temp files: ${result.removedTempDir}`);
} catch (error) {
  process.stderr.write(`[SECURITY] Could not redact secrets from Playwright traces in ${outputDir}: ${(error as Error).message}. Treat the traces as sensitive.\n`);
  process.exit(255);
}
