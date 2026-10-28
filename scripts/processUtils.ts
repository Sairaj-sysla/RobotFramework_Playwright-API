/**
 * Child-process helpers for the test orchestrator: start a Node service with its
 * output captured to a log file, wait for a readiness probe, stop it reliably.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { ErrorCategory, FrameworkError } from '../src/utils/errorHandler.js';

export interface ManagedProcess {
  name: string;
  child: ChildProcess;
  logFile: string;
  exited: Promise<number | null>;
}

export function startNodeService(name: string, script: string, logFile: string, env: NodeJS.ProcessEnv): ManagedProcess {
  const log = fs.openSync(logFile, 'w');
  const child = spawn(process.execPath, [script], { env, stdio: ['ignore', log, log], windowsHide: true });
  fs.closeSync(log); // the child holds its own handle
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', () => resolve(-1));
  });
  return { name, child, logFile, exited };
}

export async function stopService(service: ManagedProcess, graceMs = 5000): Promise<void> {
  if (service.child.exitCode !== null || service.child.signalCode !== null) return;
  service.child.kill('SIGTERM');
  const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), graceMs).unref());
  if ((await Promise.race([service.exited, timer])) === 'timeout') {
    service.child.kill('SIGKILL');
    await service.exited;
  }
}

export function tailFile(file: string, lines = 20): string {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '<no log output>';
  }
}

/** Polls `probe` until it returns true, the service exits, or the timeout elapses. */
export async function waitUntilReady(service: ManagedProcess, probe: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exitCode: number | null | undefined;
  void service.exited.then((code) => {
    exitCode = code;
  });
  while (Date.now() < deadline) {
    if (exitCode !== undefined) {
      throw new FrameworkError(ErrorCategory.Environment,
        `${service.name} exited during start-up (code ${exitCode}). Log ${service.logFile}:\n${tailFile(service.logFile)}`);
    }
    if (await probe().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new FrameworkError(ErrorCategory.Environment,
    `${service.name} was not ready within ${timeoutMs} ms. Log ${service.logFile}:\n${tailFile(service.logFile)}`);
}

export function isPortInUse(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

export async function httpOk(url: string, init?: RequestInit): Promise<boolean> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(2000) });
  return response.ok;
}

/** Readiness probe for the remote server: a real XML-RPC call, not just an open port. */
export function remoteServerReady(uri: string): Promise<boolean> {
  return httpOk(uri, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: '<?xml version="1.0"?><methodCall><methodName>get_keyword_names</methodName><params/></methodCall>',
  });
}
