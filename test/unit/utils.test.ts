import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseUser } from '../../src/api/apiTypes.js';
import { parseConfig, summarizeConfig } from '../../src/config/environmentConfig.js';
import { buildUser, uniqueId } from '../../src/testdata/testDataFactory.js';
import { ConfigurationError, formatError, FrameworkError, ErrorCategory } from '../../src/utils/errorHandler.js';
import { FieldNotFoundError, getByPath, matchesJsonType, valuesMatch } from '../../src/utils/fieldPath.js';
import { withRetry } from '../../src/utils/retryUtils.js';
import { REDACTED, previewBody, sanitizeBody, sanitizeHeaders } from '../../src/utils/sanitize.js';
import { buildRobotArgs, splitRobotArgs } from '../../scripts/robotArgs.js';

const VALID_ENV = {
  BASE_URL: 'http://127.0.0.1:3000/',
  API_BASE_URL: 'http://127.0.0.1:3000/api',
  API_TOKEN: 'x'.repeat(32),
  APP_USERNAME: 'qa',
  APP_PASSWORD: 'pw',
};

describe('configuration', () => {
  it('applies defaults and normalizes URLs', () => {
    const config = parseConfig(VALID_ENV);
    assert.equal(config.baseUrl, 'http://127.0.0.1:3000');
    assert.equal(config.browser, 'chromium');
    assert.equal(config.headless, true);
    assert.equal(config.remoteHost, '127.0.0.1');
    assert.equal(config.apiRetries, 1);
  });

  it('lists every problem in one configuration error', () => {
    assert.throws(
      () => parseConfig({ BASE_URL: 'ftp://x', BROWSER: 'opera', HEADLESS: 'maybe', API_TIMEOUT_MS: '-1', API_TOKEN: 'short' }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationError);
        for (const expected of ['BASE_URL must be an absolute http(s) URL', 'API_BASE_URL is required', 'APP_USERNAME is required',
          'BROWSER must be one of', 'HEADLESS must be true or false', 'API_TIMEOUT_MS must be an integer', 'API_TOKEN must be at least 16']) {
          assert.ok(error.message.includes(expected), `missing: ${expected}`);
        }
        assert.match(formatError(error), /^\[CONFIGURATION\]/);
        return true;
      },
    );
  });

  it('never exposes secrets in the summary', () => {
    const text = JSON.stringify(summarizeConfig(parseConfig(VALID_ENV)));
    assert.ok(!text.includes(VALID_ENV.API_TOKEN));
    assert.ok(!text.includes('"pw"'));
  });
});

describe('sanitize', () => {
  it('redacts sensitive headers case-insensitively', () => {
    assert.deepEqual(sanitizeHeaders({ Authorization: 'Bearer x', 'Set-Cookie': 'sid=1', Accept: 'json' }),
      { Authorization: REDACTED, 'Set-Cookie': REDACTED, Accept: 'json' });
  });

  it('redacts sensitive fields at any depth without mutating input', () => {
    const input = { user: { name: 'a', password: 'p', apiKey: 'k' }, items: [{ access_token: 't' }] };
    assert.deepEqual(sanitizeBody(input), { user: { name: 'a', password: REDACTED, apiKey: REDACTED }, items: [{ access_token: REDACTED }] });
    assert.equal(input.user.password, 'p');
  });

  it('previews long bodies with a length marker', () => {
    assert.equal(previewBody(null), '<empty>');
    assert.match(previewBody('x'.repeat(600), 10), /^x{10}\.\.\. \(600 chars\)$/);
  });
});

describe('fieldPath', () => {
  const data = { user: { email: 'a@b.test', tags: ['x', 'y'], active: true, score: 1.5 }, count: 2 };

  it('reads nested fields and array indexes', () => {
    assert.equal(getByPath(data, 'user.tags.1'), 'y');
    assert.equal(getByPath(data, '$.count'), 2);
    assert.equal(getByPath(data, '$'), data);
  });

  it('explains missing fields', () => {
    assert.throws(() => getByPath(data, 'user.phone'), (e: unknown) => e instanceof FieldNotFoundError && /Available fields: email, tags, active, score/.test(e.message));
    assert.throws(() => getByPath(data, 'user.tags.5'), /out of range/);
    assert.throws(() => getByPath(data, 'count.x'), /Value at 'count' is integer/);
  });

  it('compares Robot string arguments with typed JSON values', () => {
    assert.ok(valuesMatch(true, 'true'));
    assert.ok(valuesMatch(2, '2'));
    assert.ok(!valuesMatch(2, '3'));
    assert.ok(valuesMatch({ a: 1, b: 2 }, { b: 2, a: 1 }));
    assert.ok(matchesJsonType(1, 'number') && matchesJsonType(1, 'integer') && !matchesJsonType(1.5, 'integer'));
  });
});

describe('withRetry', () => {
  it('retries only while shouldRetry allows and the budget lasts', async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => {
      calls++;
      throw new Error('x');
    }, { retries: 2, delayMs: 1, shouldRetry: () => true }));
    assert.equal(calls, 3);
    calls = 0;
    await assert.rejects(withRetry(async () => {
      calls++;
      throw new Error('fatal');
    }, { retries: 5, delayMs: 1, shouldRetry: () => false }));
    assert.equal(calls, 1);
  });

  it('returns the first successful result', async () => {
    assert.equal(await withRetry(async (attempt) => {
      if (attempt < 2) throw new Error('flaky');
      return attempt;
    }, { retries: 3, delayMs: 1, shouldRetry: () => true }), 2);
  });
});

describe('test data', () => {
  it('generates unique, marked users with reserved-domain emails', () => {
    const a = buildUser();
    const b = buildUser({ role: 'admin' });
    assert.notEqual(a.email, b.email);
    assert.match(a.email, /^rfqa-.+@example\.test$/);
    assert.equal(b.role, 'admin');
    assert.notEqual(uniqueId(), uniqueId());
  });

  it('rejects unknown roles', () => {
    assert.throws(() => buildUser({ role: 'owner' as never }), /Unknown role/);
  });

  it('validates user payloads from the API', () => {
    const user = { id: '1', name: 'n', email: 'e', role: 'viewer', active: true, createdAt: 't', updatedAt: 't' };
    assert.deepEqual(parseUser(user), user);
    assert.throws(() => parseUser({ ...user, role: 'owner', active: 'yes' }), /'role' should be one of.*'active' should be a boolean/);
    assert.throws(() => parseUser([]), (e: unknown) => e instanceof FrameworkError && e.category === ErrorCategory.Application);
  });
});

describe('robot arguments', () => {
  it('splits options (with and without values) from data sources', () => {
    assert.deepEqual(splitRobotArgs(['--include', 'smoke', '--dryrun', '-X', '--outputdir=out', 'tests/web']), {
      options: ['--include', 'smoke', '--dryrun', '-X', '--outputdir=out'], dataSources: ['tests/web'],
    });
    assert.deepEqual(splitRobotArgs(['--nodryrun', '--test', 'A Test']).dataSources, []);
  });

  it('adds defaults before user options and the default data source last', () => {
    const args = buildRobotArgs(['--include', 'api', '--outputdir', 'custom'], { resultsDir: 'results', defaultDataSource: 'tests', excludedByDefault: 'intentional-failure' });
    assert.deepEqual(args, ['-m', 'robot', '--outputdir', 'results', '--loglevel', 'DEBUG:INFO', '--exclude', 'intentional-failure', '--include', 'api', '--outputdir', 'custom', 'tests']);
  });

  it('does not exclude intentional failures when they are asked for', () => {
    const args = buildRobotArgs(['--include', 'intentional-failure'], { resultsDir: 'r', defaultDataSource: 'tests', excludedByDefault: 'intentional-failure' });
    assert.ok(!args.includes('--exclude'));
  });
});
