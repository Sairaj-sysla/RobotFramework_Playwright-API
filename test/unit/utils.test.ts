import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadEnvProfile } from '../../src/config/configManager.js';
import { parseConfig, summarizeConfig } from '../../src/config/environmentConfig.js';
import { ConfigurationError, formatError } from '../../src/utils/errorHandler.js';
import { REDACTED, isSensitivePath, previewBody, sanitizeBody, sanitizeHeaders } from '../../src/utils/sanitize.js';
import { buildRobotArgs, effectiveOutputDir, splitRobotArgs } from '../../scripts/robotArgs.js';

const VALID_ENV = {
  BASE_URL: 'https://app.example.test/',
  APP_USERNAME: 'qa',
  APP_PASSWORD: 'pw',
};

describe('configuration', () => {
  it('applies defaults and normalizes URLs', () => {
    const config = parseConfig(VALID_ENV);
    assert.equal(config.baseUrl, 'https://app.example.test');
    assert.equal(config.browser, 'chromium');
    assert.equal(config.headless, true);
    assert.equal(config.navigationTimeoutMs, 30_000);
    assert.equal(config.easyUrl, '');
  });

  it('leaves suite-specific settings optional and validates URLs that are given', () => {
    const config = parseConfig({});
    assert.equal(config.baseUrl, '');
    assert.equal(config.appPassword, '');
    assert.equal(parseConfig({ EASY_URL: 'https://orange.example.test/login/' }).easyUrl, 'https://orange.example.test/login');
    assert.throws(() => parseConfig({ EASY_URL: 'not a url' }), /EASY_URL must be an absolute http\(s\) URL/);
  });

  it('lists every problem in one configuration error', () => {
    assert.throws(
      () => parseConfig({ BASE_URL: 'ftp://x', BROWSER: 'opera', HEADLESS: 'maybe', NAVIGATION_TIMEOUT_MS: '-1' }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationError);
        for (const expected of ['BASE_URL must be an absolute http(s) URL',
          'BROWSER must be one of', 'HEADLESS must be true or false', 'NAVIGATION_TIMEOUT_MS must be an integer']) {
          assert.ok(error.message.includes(expected), `missing: ${expected}`);
        }
        assert.match(formatError(error), /^\[CONFIGURATION\]/);
        return true;
      },
    );
  });

  it('accepts a system browser channel only for chromium', () => {
    assert.equal(parseConfig(VALID_ENV).browserChannel, undefined);
    assert.equal(parseConfig({ ...VALID_ENV, BROWSER_CHANNEL: 'MSEdge' }).browserChannel, 'msedge');
    assert.throws(() => parseConfig({ ...VALID_ENV, BROWSER_CHANNEL: 'opera' }), /BROWSER_CHANNEL must be one of chrome/);
    assert.throws(() => parseConfig({ ...VALID_ENV, BROWSER: 'firefox', BROWSER_CHANNEL: 'chrome' }), /requires BROWSER=chromium/);
  });

  it('never exposes secrets in the summary', () => {
    const text = JSON.stringify(summarizeConfig(parseConfig({ ...VALID_ENV, APP_PASSWORD: 'Secret-Value-77' })));
    assert.ok(!text.includes('Secret-Value-77'));
    assert.ok(text.includes('***set***'));
  });
});

describe('sanitize', () => {
  it('recognizes sensitive dot paths by any segment', () => {
    for (const path of ['token', 'auth.accessToken', 'headers.x-api-key', 'headers.Authorization', 'user.password', 'items.0.secret']) {
      assert.ok(isSensitivePath(path), path);
    }
    for (const path of ['email', 'headers.accept', 'items.0.id', '$']) assert.ok(!isSensitivePath(path), path);
  });

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

describe('robot arguments', () => {
  it('splits options (with and without values) from data sources', () => {
    assert.deepEqual(splitRobotArgs(['--include', 'smoke', '--dryrun', '-X', '--outputdir=out', 'tests/web']), {
      options: ['--include', 'smoke', '--dryrun', '-X', '--outputdir=out'], dataSources: ['tests/web'],
    });
    assert.deepEqual(splitRobotArgs(['--nodryrun', '--test', 'A Test']).dataSources, []);
  });

  it('adds defaults before user options and the default data source last', () => {
    const args = buildRobotArgs(['--include', 'api', '--outputdir', 'custom'], { resultsDir: 'results', defaultDataSource: 'tests', excludedByDefault: ['intentional-failure', 'projectbase'] });
    assert.deepEqual(args, ['-m', 'robot', '--outputdir', 'results', '--loglevel', 'DEBUG:INFO', '--exclude', 'intentional-failure', '--exclude', 'projectbase', '--include', 'api', '--outputdir', 'custom', 'tests']);
  });

  it('finds the output directory Robot will use (last one wins, all syntaxes)', () => {
    assert.equal(effectiveOutputDir(['--include', 'api', 'tests'], 'results'), 'results');
    assert.equal(effectiveOutputDir(['--outputdir', 'a', '-d', 'b', 'tests'], 'results'), 'b');
    assert.equal(effectiveOutputDir(['--outputdir=c', '--dryrun'], 'results'), 'c');
    // a data source named like the option is not mistaken for it
    assert.equal(effectiveOutputDir(['--include', 'x', 'tests/--outputdir'], 'results'), 'results');
  });

  it('does not exclude intentional failures when they are asked for', () => {
    const args = buildRobotArgs(['--include', 'intentional-failure'], { resultsDir: 'r', defaultDataSource: 'tests', excludedByDefault: ['intentional-failure', 'projectbase'] });
    assert.deepEqual(args.filter((_, i) => args[i - 1] === '--exclude'), ['projectbase']);
    const projectbase = buildRobotArgs(['--include', 'ProjectBase'], { resultsDir: 'r', defaultDataSource: 'tests', excludedByDefault: ['intentional-failure', 'projectbase'] });
    assert.deepEqual(projectbase.filter((_, i) => projectbase[i - 1] === '--exclude'), ['intentional-failure']);
  });
});

describe('environment profiles', () => {
  const keys = ['TEST_ENV', 'PB_PROFILE_PROBE', 'PB_PROFILE_OVERRIDDEN'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const restore = () => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };

  it('loads .env.<TEST_ENV> without overriding variables that are already set', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
    try {
      fs.writeFileSync(path.join(root, '.env.sample-app'), 'PB_PROFILE_PROBE=from-profile\nPB_PROFILE_OVERRIDDEN=from-profile\n');
      process.env.TEST_ENV = 'sample-app';
      process.env.PB_PROFILE_OVERRIDDEN = 'from-environment';
      assert.equal(loadEnvProfile(root), path.join(root, '.env.sample-app'));
      assert.equal(process.env.PB_PROFILE_PROBE, 'from-profile');
      assert.equal(process.env.PB_PROFILE_OVERRIDDEN, 'from-environment');
    } finally {
      restore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('loads nothing for local/ci and rejects missing files and unsafe names', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
    try {
      for (const name of ['local', 'ci']) {
        process.env.TEST_ENV = name;
        assert.equal(loadEnvProfile(root), undefined);
      }
      process.env.TEST_ENV = 'projectbase';
      assert.throws(() => loadEnvProfile(root), /\.env\.projectbase does not exist\. Copy \.env\.projectbase\.example/);
      process.env.TEST_ENV = '../secrets';
      assert.throws(() => loadEnvProfile(root), ConfigurationError);
    } finally {
      restore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
