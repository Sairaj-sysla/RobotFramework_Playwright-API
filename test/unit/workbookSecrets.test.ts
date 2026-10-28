import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { projectRoot } from '../../src/config/configManager.js';
import { robotPython } from '../../scripts/processUtils.js';
import { workbookSecrets } from '../../scripts/workbookSecrets.js';

const CREATE = `
import sys
from openpyxl import Workbook
wb = Workbook()
ws = wb.active
ws.title = "LoginTestData"
ws.append(["TestCaseID", "Username", "Password"])
ws.append(["TC01", "admin", "first-Secret-1"])
ws.append(["TC02", "user", None])
other = wb.create_sheet("Other")
other.append(["password", "Note"])
other.append(["second-Secret-2", "not a secret"])
wb.save(sys.argv[1])
`;

describe('workbook secrets', () => {
  it('collects the Password column of every sheet, case-insensitively, and nothing else', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbook-'));
    try {
      const file = path.join(dir, 'data.xlsx');
      const created = spawnSync(robotPython(projectRoot()), ['-I', '-c', CREATE, file], { encoding: 'utf8' });
      assert.equal(created.status, 0, created.stderr);
      assert.deepEqual(workbookSecrets(dir, 'data.xlsx'), ['first-Secret-1', 'second-Secret-2']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns nothing when no workbook is configured or it does not exist', () => {
    assert.deepEqual(workbookSecrets(os.tmpdir(), ''), []);
    assert.deepEqual(workbookSecrets(os.tmpdir(), 'missing-workbook.xlsx'), []);
  });

  it('fails instead of skipping a workbook it cannot read', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbook-'));
    try {
      fs.writeFileSync(path.join(dir, 'broken.xlsx'), 'not a zip file');
      assert.throws(() => workbookSecrets(dir, 'broken.xlsx'), /could not read secret columns/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
