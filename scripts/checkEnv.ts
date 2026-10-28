/**
 * Validates configuration and prints it with secrets masked.
 *   node dist/scripts/checkEnv.js
 */
import { getConfig } from '../src/config/configManager.js';
import { summarizeConfig } from '../src/config/environmentConfig.js';
import { formatError } from '../src/utils/errorHandler.js';

try {
  console.log(JSON.stringify(summarizeConfig(getConfig()), null, 2));
  console.log('Configuration is valid.');
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(252);
}
