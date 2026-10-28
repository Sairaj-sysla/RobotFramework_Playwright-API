/**
 * Robot Framework remote library server implemented in TypeScript.
 *
 * Implements the XML-RPC methods consumed by robot/libraries/Remote.py:
 *   get_library_information, get_keyword_names, get_keyword_arguments,
 *   get_keyword_types, get_keyword_tags, get_keyword_documentation,
 *   run_keyword, stop_remote_server
 * run_keyword returns the standard result struct
 *   { status, return, output, error, traceback, continuable, fatal }.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { formatError } from '../utils/errorHandler.js';
import type { Logger } from '../utils/logger.js';
import { bindArguments, type KeywordLibrary, type RobotLogLevel } from './keywordLibrary.js';
import { encodeFault, encodeMethodResponse, parseMethodCall, XmlRpcParseError, type XmlRpcValue } from './xmlRpc.js';

const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

export interface RemoteServerOptions {
  host: string;
  port: number;
  /** Allow `stop_remote_server` to shut the process down. */
  allowStop: boolean;
  logger: Logger;
}

interface RunKeywordResult {
  status: 'PASS' | 'FAIL';
  return?: unknown;
  output: string;
  error?: string;
  traceback?: string;
  continuable?: boolean;
  fatal?: boolean;
}

export class RemoteServer {
  private server?: http.Server;
  private stopRequested?: () => void;
  readonly stopped: Promise<void>;

  constructor(private readonly library: KeywordLibrary, private readonly options: RemoteServerOptions) {
    this.stopped = new Promise((resolve) => {
      this.stopRequested = resolve;
    });
  }

  async start(): Promise<AddressInfo> {
    const server = http.createServer((req, res) => void this.handle(req, res));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port, this.options.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    this.options.logger.info('Remote server listening', {
      uri: `http://${address.address}:${address.port}`,
      keywords: this.library.names().length,
    });
    return address;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      this.server = undefined;
    }
    this.stopRequested?.();
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain' }).end('XML-RPC endpoint: use POST');
      return;
    }
    let body: string;
    try {
      body = await readBody(req);
    } catch (error) {
      res.writeHead(413, { 'Content-Type': 'text/plain' }).end((error as Error).message);
      return;
    }
    let xml: string;
    try {
      const call = parseMethodCall(body);
      xml = encodeMethodResponse(await this.dispatch(call.methodName, call.params));
    } catch (error) {
      const code = error instanceof XmlRpcParseError ? -32700 : 1;
      this.options.logger.warn('XML-RPC fault', { error: (error as Error).message });
      xml = encodeFault(code, (error as Error).message);
    }
    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(xml) });
    res.end(xml);
  }

  private async dispatch(method: string, params: XmlRpcValue[]): Promise<unknown> {
    const keywordName = () => {
      const name = params[0];
      if (typeof name !== 'string') throw new Error(`${method} requires a keyword name`);
      return name;
    };
    const keywordInfo = () => {
      const info = this.library.information()[keywordName()];
      if (!info) throw new Error(`No keyword with name '${keywordName()}' found.`);
      return info;
    };
    switch (method) {
      case 'get_library_information':
        return this.library.information();
      case 'get_keyword_names':
        return this.library.names();
      case 'get_keyword_arguments':
        return keywordInfo().args;
      case 'get_keyword_types':
        return keywordInfo().types;
      case 'get_keyword_tags':
        return keywordInfo().tags;
      case 'get_keyword_documentation': {
        const name = keywordName();
        if (name === '__intro__') return this.library.information().__intro__!.doc;
        if (name === '__init__') return '';
        return keywordInfo().doc;
      }
      case 'run_keyword':
        return this.runKeyword(keywordName(), params[1], params[2]);
      case 'stop_remote_server':
        if (!this.options.allowStop) return false;
        setImmediate(() => void this.stop());
        return true;
      default:
        throw new Error(`Unsupported XML-RPC method '${method}'`);
    }
  }

  private async runKeyword(name: string, rawArgs: XmlRpcValue | undefined, rawKwargs: XmlRpcValue | undefined): Promise<RunKeywordResult> {
    const output: string[] = [];
    const ctx = {
      log(message: string, level: RobotLogLevel = 'INFO') {
        output.push(`*${level}* ${message}`);
      },
    };
    const started = Date.now();
    try {
      const keyword = this.library.get(name);
      if (!keyword) throw new Error(`No keyword with name '${name}' found.`);
      const args = Array.isArray(rawArgs) ? rawArgs : [];
      const kwargs = rawKwargs && typeof rawKwargs === 'object' && !Array.isArray(rawKwargs) && !(rawKwargs instanceof Date) && !Buffer.isBuffer(rawKwargs)
        ? rawKwargs as Record<string, unknown>
        : {};
      const value = await keyword.run(bindArguments(keyword, args, kwargs), ctx);
      this.options.logger.debug('Keyword passed', { keyword: name, ms: Date.now() - started });
      // undefined/null are sent as <nil/>, which Robot receives as ${None}.
      return { status: 'PASS', return: value ?? null, output: joinOutput(output) };
    } catch (error) {
      const message = formatError(error);
      this.options.logger.info('Keyword failed', { keyword: name, ms: Date.now() - started, error: message });
      return {
        status: 'FAIL',
        output: joinOutput(output),
        error: message,
        traceback: error instanceof Error && error.stack ? error.stack : '',
        continuable: false,
        fatal: false,
      };
    }
  }
}

function joinOutput(lines: string[]): string {
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error(`Request exceeds ${MAX_REQUEST_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
