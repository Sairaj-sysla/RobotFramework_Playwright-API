/**
 * Collects the secret-column values (default: `Password`, matching libraries/ExcelTestData.py)
 * of an Excel test-data workbook, so they can be redacted from Playwright traces like
 * APP_PASSWORD. Reads the workbook with the Robot Python (openpyxl); values are returned to the
 * caller only and never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot } from '../src/config/configManager.js';
import { robotPython } from './processUtils.js';

const SCRIPT = `
import json, sys
from openpyxl import load_workbook
columns = {name.strip().casefold() for name in sys.argv[2].split(",") if name.strip()}
with open(sys.argv[1], "rb") as handle:
    wb = load_workbook(handle, read_only=True, data_only=True)
    values = set()
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        header = next(rows, None) or ()
        indexes = [i for i, h in enumerate(header) if h is not None and str(h).strip().casefold() in columns]
        for row in rows:
            for i in indexes:
                if i < len(row) and row[i] not in (None, ""):
                    values.add(str(row[i]))
    wb.close()
print(json.dumps(sorted(values)))
`;

/**
 * `workbook` is resolved against `root`. Returns [] when no workbook is configured or the file does
 * not exist; throws if it cannot be read.
 */
export function workbookSecrets(root: string, workbook: string, secretColumns = 'Password'): string[] {
  if (!workbook.trim()) return [];
  const file = path.resolve(root, workbook.trim());
  if (!fs.existsSync(file)) return [];
  const result = spawnSync(robotPython(projectRoot()), ['-I', '-c', SCRIPT, file, secretColumns], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`could not read secret columns (${secretColumns}) of ${file}: ${result.error?.message ?? result.stderr.trim().split('\n').pop()}`);
  }
  return JSON.parse(result.stdout) as string[];
}
