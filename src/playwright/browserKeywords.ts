/**
 * Custom Browser library keywords (Browser `jsextension`).
 *
 * Loaded with:  Library    Browser    jsextension=${ROOT}/dist/src/playwright/browserKeywords.js
 *
 * Browser derives keyword names from export names (getTableRowsAsDicts ->
 * "Get Table Rows As Dicts") and the Robot argument list from the compiled
 * function signature. Parameters named `page` and `logger` are injected by
 * Browser, so they must come last; defaults must be plain literals.
 *
 * Only keywords Browser does not already provide live here:
 *  - Get Table Rows As Dicts: Browser only offers cell/row index lookups.
 *  - Get Form Validation State: one call instead of a Get Property per field,
 *    and language-independent reasons (valueMissing, typeMismatch, ...).
 */
import type { Page } from 'playwright-core';

type RobotLogger = (message: string) => void;

function requireSelector(selector: unknown, keyword: string): string {
  if (typeof selector !== 'string' || selector.trim() === '') {
    throw new Error(`[AUTOMATION] ${keyword}: 'selector' must be a non-empty selector string.`);
  }
  return selector;
}

/** Robot passes extension arguments as strings unless given as ${numbers}. */
function toTimeoutMs(value: unknown, keyword: string): number {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 300_000) {
    throw new Error(`[AUTOMATION] ${keyword}: 'timeout' must be milliseconds between 0 and 300000, got '${String(value)}'.`);
  }
  return timeout;
}

async function waitForVisible(page: Page, selector: string, timeout: number, keyword: string) {
  const locator = page.locator(selector);
  try {
    await locator.waitFor({ state: 'visible', timeout });
  } catch (error) {
    throw new Error(`[AUTOMATION] ${keyword}: element '${selector}' was not visible within ${timeout} ms. ${(error as Error).message.split('\n')[0]}`);
  }
  return locator;
}

async function getTableRowsAsDicts(selector: string, timeout = 10000, page: Page, logger: RobotLogger) {
  const keyword = 'Get Table Rows As Dicts';
  const table = await waitForVisible(page, requireSelector(selector, keyword), toTimeoutMs(timeout, keyword), keyword);
  const rows = await table.evaluate((element) => {
    if (!(element instanceof HTMLTableElement)) {
      throw new Error(`[AUTOMATION] Get Table Rows As Dicts: selector matched <${element.tagName.toLowerCase()}>, not <table>.`);
    }
    const headerRow = element.tHead?.rows[0] ?? element.rows[0];
    const headers = Array.from(headerRow?.cells ?? []).map((cell, index) => cell.textContent?.trim() || `column_${index + 1}`);
    const bodyRows = element.tBodies.length
      ? Array.from(element.tBodies).flatMap((body) => Array.from(body.rows))
      : Array.from(element.rows).slice(1);
    return bodyRows.map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row.cells[index]?.textContent?.trim() ?? ''])),
    );
  });
  logger(`Read ${rows.length} row(s) from table '${selector}'.`);
  return rows;
}
getTableRowsAsDicts.rfdoc = `Returns the body rows of a visible HTML table as a list of dictionaries keyed by header text.

Waits up to \`timeout\` milliseconds for \`selector\` (Playwright selector syntax) to be visible.
Cell text is trimmed. Columns without header text are named column_1, column_2, ...

Example:
| \${rows} = | Get Table Rows As Dicts | css=table[data-testid=users-table] |
| Should Be Equal | \${rows}[0][Email] | ada@example.test |`;

async function getFormValidationState(selector: string, timeout = 10000, page: Page, logger: RobotLogger) {
  const keyword = 'Get Form Validation State';
  const form = await waitForVisible(page, requireSelector(selector, keyword), toTimeoutMs(timeout, keyword), keyword);
  const state = await form.evaluate((element) => {
    if (!(element instanceof HTMLFormElement)) {
      throw new Error(`[AUTOMATION] Get Form Validation State: selector matched <${element.tagName.toLowerCase()}>, not <form>.`);
    }
    const reasonKeys = [
      'valueMissing', 'typeMismatch', 'patternMismatch', 'tooLong', 'tooShort',
      'rangeUnderflow', 'rangeOverflow', 'stepMismatch', 'badInput', 'customError',
    ] as const;
    const fields: Record<string, { valid: boolean; message: string; reasons: string[] }> = {};
    for (const control of Array.from(element.elements)) {
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) continue;
      if (!control.name || !control.willValidate || fields[control.name]) continue;
      fields[control.name] = {
        valid: control.validity.valid,
        message: control.validationMessage,
        reasons: reasonKeys.filter((key) => control.validity[key]),
      };
    }
    return { valid: Object.values(fields).every((field) => field.valid), fields };
  });
  const invalid = Object.entries(state.fields).filter(([, field]) => !field.valid).map(([name, field]) => `${name} (${field.reasons.join(', ')})`);
  logger(invalid.length ? `Invalid fields: ${invalid.join('; ')}` : 'All form fields are valid.');
  return state;
}
getFormValidationState.rfdoc = `Returns the HTML constraint-validation state of a form without submitting it.

Result: \`valid\` (bool) and \`fields\`, a dictionary keyed by control name, each with \`valid\`, the browser's
\`message\` (browser- and locale-specific text) and \`reasons\` - language-independent ValidityState flags such as
valueMissing, typeMismatch or tooShort. Prefer asserting on \`reasons\`. Field values are not returned, so the
keyword is safe to use on forms with password fields.

Example:
| \${state} = | Get Form Validation State | id=new-user-form |
| Should Contain | \${state}[fields][email][reasons] | typeMismatch |`;

export { getTableRowsAsDicts, getFormValidationState };
