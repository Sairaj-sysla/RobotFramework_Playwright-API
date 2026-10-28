/**
 * Entry point: serves the TypeScript API keywords to Robot Framework.
 *   node dist/src/remote/main.js
 */
import { createApiKeywords } from '../api/apiKeywords.js';
import { getConfig } from '../config/configManager.js';
import { summarizeConfig } from '../config/environmentConfig.js';
import { formatError } from '../utils/errorHandler.js';
import { createLogger } from '../utils/logger.js';
import { KeywordLibrary } from './keywordLibrary.js';
import { RemoteServer } from './remoteServer.js';

const LIBRARY_DOC = `TypeScript API keywords served over the Robot Framework remote interface.

Import with \`Library    Remote    http://127.0.0.1:8270    WITH NAME    API\`.
Credentials come from the server's environment and are never passed through Robot.`;

async function main(): Promise<void> {
  const config = getConfig();
  const logger = createLogger('api-remote-server', config.logLevel);
  logger.debug('Configuration loaded', summarizeConfig(config));
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.remoteHost)) {
    logger.warn('Remote server is bound to a non-loopback address; keywords can be called by other hosts', { host: config.remoteHost });
  }
  const server = new RemoteServer(new KeywordLibrary(LIBRARY_DOC, createApiKeywords(config, logger)), {
    host: config.remoteHost,
    port: config.remotePort,
    allowStop: true,
    logger,
  });
  await server.start();
  const shutdown = () => void server.stop();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await server.stopped;
  logger.info('Remote server stopped');
}

main().catch((error: unknown) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
});
