import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { readZip, redactTraces, secretVariants, writeZip } from '../../scripts/traceRedaction.js';

const SECRET = 'p@ss w/rd"&+';

describe('trace redaction', () => {
  it('round-trips zip entries, including binary and UTF-8 names', () => {
    const entries = [
      { name: 'trace.trace', data: Buffer.from('{"a":1}\n') },
      { name: 'screencast/päge.jpeg', data: Buffer.from([0, 255, 1, 254, 0]) },
      { name: 'empty.txt', data: Buffer.alloc(0) },
    ];
    assert.deepEqual(readZip(writeZip(entries)), entries);
  });

  it('covers the plain, JSON, URI and form encodings of a secret', () => {
    assert.deepEqual(new Set(secretVariants(SECRET)), new Set([
      SECRET, 'p@ss w/rd\\"&+', 'p%40ss%20w%2Frd%22%26%2B', 'p%40ss+w%2Frd%22%26%2B',
    ]));
  });

  it('redacts every encoding in all trace zips and removes the temp directory', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-'));
    const traces = path.join(out, 'browser', 'traces');
    fs.mkdirSync(path.join(traces, 'temp'), { recursive: true });
    fs.writeFileSync(path.join(traces, 'temp', 'raw.trace'), SECRET);
    const trace = JSON.stringify({ method: 'fill', params: { value: SECRET } });
    const form = `username=qa&password=${new URLSearchParams({ s: SECRET }).toString().slice(2)}`;
    fs.writeFileSync(path.join(traces, 'trace_context=1.zip'), writeZip([
      { name: 'trace.trace', data: Buffer.from(trace) },
      { name: 'resources/body.dat', data: Buffer.from(form) },
      { name: 'clean.json', data: Buffer.from('{"nothing":"secret"}') },
    ]));

    const result = redactTraces(out, [SECRET, 'abc' /* too short: ignored */]);

    assert.deepEqual(result, { traces: 1, replacements: 2, removedTempDir: true });
    const entries = readZip(fs.readFileSync(path.join(traces, 'trace_context=1.zip')));
    const all = Buffer.concat(entries.map((entry) => entry.data)).toString();
    for (const variant of secretVariants(SECRET)) assert.ok(!all.includes(variant), `still contains ${variant}`);
    assert.match(entries[0]!.data.toString(), /"value":"\*\*\*REDACTED\*\*\*"/);
    assert.equal(entries[2]!.data.toString(), '{"nothing":"secret"}');
    assert.ok(!fs.existsSync(path.join(traces, 'temp')));
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('fails instead of skipping a trace file it cannot read', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-'));
    const traces = path.join(out, 'browser', 'traces');
    fs.mkdirSync(traces, { recursive: true });
    fs.writeFileSync(path.join(traces, 'broken.zip'), `not a zip but contains ${SECRET}`);
    assert.throws(() => redactTraces(out, [SECRET]), /not a zip file/);
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('does nothing when there are no traces', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-'));
    assert.deepEqual(redactTraces(out, [SECRET]), { traces: 0, replacements: 0, removedTempDir: false });
    fs.rmSync(out, { recursive: true, force: true });
  });
});
