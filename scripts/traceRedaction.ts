/**
 * Removes secrets from Playwright trace artifacts after a run.
 *
 * Playwright tracing records `fill` values, request bodies and raw resources, so
 * a password typed with Browser's `Fill Secret` (which only keeps it out of the
 * Robot log) still ends up in the trace. Playwright offers no redaction option,
 * so every trace zip is rewritten with secret values replaced, and Browser's
 * unpacked working copies (`browser/traces/temp`) are deleted.
 *
 * The zip handling covers what Playwright writes: stored or deflated entries,
 * optional data descriptors, no ZIP64. Entries are re-written deflated.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { REDACTED } from '../src/utils/sanitize.js';

interface ZipEntry {
  name: string;
  data: Buffer;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function readZip(zip: Buffer): ZipEntry[] {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip file (no end of central directory)');
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    if (method !== 0 && method !== 8) throw new Error(`unsupported compression method ${method} for ${name}`);
    entries.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

/** Every encoding in which a secret value can appear in trace JSON, URLs or form bodies. */
export function secretVariants(secret: string): string[] {
  const variants = new Set([
    secret,
    JSON.stringify(secret).slice(1, -1),
    encodeURIComponent(secret),
    new URLSearchParams({ s: secret }).toString().slice(2),
  ]);
  return [...variants].filter((variant) => variant.length > 0);
}

function replaceAll(data: Buffer, needles: Buffer[]): { data: Buffer; count: number } {
  let count = 0;
  let current = data;
  const replacement = Buffer.from(REDACTED);
  for (const needle of needles) {
    let index = current.indexOf(needle);
    if (index < 0) continue;
    const parts: Buffer[] = [];
    let start = 0;
    while (index >= 0) {
      parts.push(current.subarray(start, index), replacement);
      count++;
      start = index + needle.length;
      index = current.indexOf(needle, start);
    }
    parts.push(current.subarray(start));
    current = Buffer.concat(parts);
  }
  return { data: current, count };
}

/** Re-reads a zip from disk and fails unless it parses and contains none of the secret variants. */
function verifyRedacted(zipPath: string, needles: Buffer[]): void {
  for (const entry of readZip(fs.readFileSync(zipPath))) {
    if (needles.some((needle) => entry.data.includes(needle))) {
      throw new Error(`a configured secret is still present in ${path.basename(zipPath)}/${entry.name} after redaction`);
    }
  }
}

export interface RedactionResult {
  traces: number;
  replacements: number;
  removedTempDir: boolean;
}

/**
 * Redacts `secrets` from all trace zips under `<outputDir>/browser/traces` and
 * deletes the unpacked `temp` working directory. Secrets shorter than 4
 * characters are skipped (they would corrupt unrelated content).
 */
export function redactTraces(outputDir: string, secrets: string[]): RedactionResult {
  const tracesDir = path.join(outputDir, 'browser', 'traces');
  const result: RedactionResult = { traces: 0, replacements: 0, removedTempDir: false };
  if (!fs.existsSync(tracesDir)) return result;
  const needles = secrets
    .filter((secret) => secret.length >= 4)
    .flatMap(secretVariants)
    .sort((a, b) => b.length - a.length) // longest first so encodings are replaced whole
    .map((variant) => Buffer.from(variant, 'utf8'));
  for (const file of fs.readdirSync(tracesDir).filter((name) => name.endsWith('.zip'))) {
    const zipPath = path.join(tracesDir, file);
    let changed = 0;
    const entries = readZip(fs.readFileSync(zipPath)).map((entry) => {
      const { data, count } = replaceAll(entry.data, needles);
      changed += count;
      return { name: entry.name, data };
    });
    if (changed) fs.writeFileSync(zipPath, writeZip(entries));
    verifyRedacted(zipPath, needles);
    result.traces++;
    result.replacements += changed;
  }
  const tempDir = path.join(tracesDir, 'temp');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    result.removedTempDir = true;
  }
  return result;
}
