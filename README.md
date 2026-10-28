# UI automation – Robot Framework + Browser (Playwright)

Robot Framework tests using **Browser Library** (Playwright), converted from TypeScript Playwright
frameworks:

- **ProjectBase login** – from the `LoginPage` page object.
- **OrangeHRM login with Excel test data** – from ABM-India `orange.spec.ts`
  (`REG_TS_or_TC01 - Login using row data`), reading the same `.xlsx` workbook.

A small TypeScript orchestrator loads and validates configuration, runs Robot Framework and
removes passwords from Playwright traces afterwards.

## Contents

1. [Quick start](#1-quick-start)
2. [Folder structure](#2-folder-structure)
3. [Technology and versions](#3-technology-and-versions)
4. [Installation](#4-installation)
5. [Configuration and credentials](#5-configuration-and-credentials)
6. [Running tests](#6-running-tests)
7. [The login test](#7-the-login-test)
   - [OrangeHRM login with Excel test data](#7a-orangehrm-login-with-excel-test-data)
8. [Playwright → Robot Framework mapping](#8-playwright--robot-framework-mapping)
9. [Reports, screenshots and traces](#9-reports-screenshots-and-traces)
10. [Adding tests](#10-adding-tests)
11. [CI/CD (GitHub Actions)](#11-cicd-github-actions)
12. [Troubleshooting](#12-troubleshooting)
13. [Known limitations](#13-known-limitations)

## 1. Quick start

```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt -c requirements-lock.txt
rfbrowser install chromium            # NOT 'rfbrowser init' (Browser Batteries, see section 4)
npm ci
Copy-Item .env.example .env           # ProjectBase: BASE_URL, APP_USERNAME, APP_PASSWORD; OrangeHRM: EASY_URL, ORANGE_LOGIN_WORKBOOK
npm test                              # results\report.html, results\log.html
```

## 2. Folder structure

```text
.github/workflows/robot-tests.yml   CI: ProjectBase suite on push/PR, nightly, manual (secrets required)
docs/adr/                           0001 TypeScript API integration (superseded), 0002 browser installation
docs/phase-1-feasibility.md         Historical feasibility report and verification log
resources/
  configuration.resource            Env-driven variables (URL, browser, headless, timeouts, tracing), required-config check
  browser.resource                  Browser library import, browser lifecycle, failure diagnostics (any application)
  projectbase_login.resource        ProjectBase login page: locators + page keywords
  orangehrm_login.resource          OrangeHRM login page: locators (from Orange.ts) + page keywords
libraries/
  ExcelTestData.py                  Get Test Data By Row / Clear Test Data Cache (openpyxl); secret columns as Secret
tests/
  web/projectbase_login.robot       ProjectBase login tests
  web/orangehrm_login.robot         OrangeHRM login using Excel row data (tags regression, smoke)
src/
  config/                           configManager (.env + profile loading), environmentConfig (schema, validation)
  playwright/browserKeywords.ts     Custom Browser keywords loaded with jsextension= (Get Table Rows As Dicts, Get Form Validation State)
  utils/                            errorHandler (error categories), logger, sanitize
scripts/
  runTests.ts                       Orchestrator: config validation, Robot run, trace redaction, exit code
  robotArgs.ts                      Robot command line assembly (options before data sources)
  processUtils.ts                   Locates the Robot Python (.venv or ROBOT_PYTHON)
  traceRedaction.ts / redactTraces.ts  Password redaction in Playwright trace zips; CLI for direct runs
  workbookSecrets.ts                Password-column values of ORANGE_LOGIN_WORKBOOK, for trace redaction
  checkEnv.ts                       Config (secrets masked) + toolchain check
test/unit/                          TypeScript unit tests (node:test) for config, arguments, redaction, workbook secrets
.env.example                        Configuration template (placeholders only)
.env.projectbase.example            Optional second-environment profile template (--env projectbase)
requirements.txt / requirements-lock.txt   Python dependencies / tested pinned set
results/                            Generated reports and artifacts (git-ignored)
```

## 3. Technology and versions

| Component | Version (tested) |
|---|---|
| Python | 3.13.14 (3.10+ supported by Robot Framework 7.5) |
| robotframework | 7.5 |
| robotframework-browser | 20.6.0 (Playwright 1.63.0) |
| robotframework-browser-batteries | 20.6.0 (bundles Node.js for Browser Library) |
| openpyxl (+ et-xmlfile) | 3.1.5 (2.0.0) – reads the Excel test data |
| Node.js (system) | 24.16.0 (≥ 20.12 required) – TypeScript build and orchestrator |
| typescript / @types/node / playwright-core | 6.0.3 / 24.19.2 / 1.63.0 (types for the jsextension) |
| Chromium (Playwright) | 153.0.8010.12 |

**Why Browser Library and not SeleniumLibrary:** the original tests are Playwright, and Browser
Library runs on Playwright, so the waiting behaviour (auto-wait, state-based waits), XPath
locators, tracing and browser set are the same. SeleniumLibrary would add WebDriver management and
different wait semantics with no benefit. Only one browser library is installed.

## 4. Installation

Prerequisites: Python 3.10+, Node.js 20.12+, Git. On Windows keep the project in a short path or
set `PLAYWRIGHT_BROWSERS_PATH` to a short folder (browsers under a deep path exceed the
260-character limit; see ADR 0002).

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1           # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
python -m pip install --upgrade pip
python -m pip install -r requirements.txt -c requirements-lock.txt   # includes robotframework-browser[bb]
rfbrowser install chromium             # Playwright Chromium (~700 MB)
npm ci                                 # TypeScript toolchain (exact versions from package-lock.json)
npm run env:check                      # config (password masked) + Python/Robot/Browser/Chromium check
```

**Browser initialization:** this project installs Browser Library through **Browser Batteries**
(`robotframework-browser[bb]`), which ships the Playwright wrapper and its own Node.js. With
Batteries the command is `rfbrowser install chromium`; `rfbrowser init` is only for Browser
Library *without* Batteries (`pip install robotframework-browser==20.6.0`, then
`rfbrowser init chromium`, needs Node.js on PATH). Do not mix the two routes in one venv.

System Chrome or Edge instead of Playwright's Chromium: `BROWSER_CHANNEL=chrome` or `msedge`
(with `BROWSER=chromium`).

## 5. Configuration and credentials

All settings are environment variables, centralized in `resources/configuration.resource` and
validated by `src/config/environmentConfig.ts` before Robot starts:

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | – (ProjectBase: required) | ProjectBase URL; also the OrangeHRM fallback when `EASY_URL` is empty |
| `APP_USERNAME` | – (ProjectBase: required) | ProjectBase login account |
| `APP_PASSWORD` | – (ProjectBase: required, secret) | ProjectBase password; typed with `Fill Secret`, never logged |
| `EASY_URL` | – | OrangeHRM login page (`getEasyURL()`); empty = `BASE_URL` |
| `ORANGE_LOGIN_WORKBOOK` | – (OrangeHRM: required) | Excel workbook with the `LoginTestData` sheet; relative to the project root or absolute |
| `BROWSER` | `chromium` | `chromium`, `firefox`, `webkit` |
| `BROWSER_CHANNEL` | – | `chrome`, `msedge`, ... (installed browser) |
| `HEADLESS` | `true` | `false` = headed (visible browser) |
| `BROWSER_TIMEOUT_MS` | `10000` | Element waits and actions (Browser default timeout) |
| `NAVIGATION_TIMEOUT_MS` | `30000` | Page loads and the post-login header wait (`Global_Timeout`) |
| `BROWSER_TRACING` | `false` | `true` = Playwright trace per test |
| `RESULTS_DIR` | `results` | Output directory |
| `TEST_ENV` | `local` | Profile name; `--env <name>` loads `.env.<name>` |

Each suite's setup validates the variables it needs and fails with `[CONFIGURATION] Environment
variable X is not set` otherwise, so the OrangeHRM suite does not need ProjectBase credentials and
vice versa.

**Local credentials:** copy `.env.example` to `.env` (git-ignored by `.gitignore`: `.env` and
`.env.*` except `*.example`) and fill in the three required values. Precedence: real environment
variables > `.env.<profile>` > `.env`. No extra dependency is used (`process.loadEnvFile`).

Never commit real credentials. The password is not stored in a Robot variable: `Fill Secret`
reads it from `%APP_PASSWORD`, so it is absent from `output.xml`/`log.html`/`report.html`, and the
orchestrator redacts it from Playwright traces after every `npm` run. The username is logged.

> Upgrading from the old demo framework: an existing `.env` still contains demo values
> (`BASE_URL=http://127.0.0.1:3000`, `API_TOKEN`, `REMOTE_*`, `START_DEMO_APP`). Set `BASE_URL`,
> `APP_USERNAME` and `APP_PASSWORD` for ProjectBase; the obsolete keys are ignored and can be deleted.

## 6. Running tests

```powershell
npm test                                   # all tests (builds TypeScript first)
npm run test:projectbase                   # ProjectBase suite only
npm run test:orangehrm                     # OrangeHRM Excel login only
npm test -- --exclude negative             # skip the invalid-password test
npm test -- --test "Login Successfully"    # one test
npm test -- --env staging                  # use .env.staging on top of .env
$env:HEADLESS='false'; npm test            # headed
$env:BROWSER_TRACING='true'; npm test      # with Playwright traces
npm run test:unit                          # TypeScript unit tests
```

Running `robot` directly (e.g. RobotCode in VS Code) works when the variables are in the
environment; run `npm run build` once first (the jsextension), and `npm run traces:redact` after a
traced run:

```powershell
robot --outputdir results tests/web/projectbase_login.robot
```

Exit codes: `0` all passed, `1–250` number of failed tests, `252` invalid configuration or Robot
arguments, `253` interrupted, `255` Robot could not start or trace redaction failed.

## 7. The login test

`tests/web/projectbase_login.robot`:

| Test | Steps |
|---|---|
| `Validate Login UI` | `Open Application`, `Validate Login UI` |
| `Login Successfully` | `Open Application`, `Validate Login UI`, `Enter Login Credentials`, `Submit Login Form`, `Verify Successful Login` |
| `Invalid Password Does Not Log In` (tag `negative`) | wrong password (random, via an environment variable) → no header within the navigation timeout, login form still shown |

`resources/projectbase_login.resource` keywords:

| Keyword | Behaviour |
|---|---|
| `Open Application` | `Go To ${BASE_URL}` (`domcontentloaded`, navigation timeout); fails if redirected to another host |
| `Validate Login UI` | username and password inputs visible; LOGIN visible and enabled |
| `Enter Login Credentials` | `Fill Text` username; `Fill Secret` password from `%APP_PASSWORD` (or the env var given as `password_env`) |
| `Submit Login Form` | clicks LOGIN once |
| `Verify Successful Login` | waits for the `ProjectBase 2.0` header (navigation timeout); on failure (TRY/EXCEPT) calls `Reload And Retry Login Verification` |
| `Reload And Retry Login Verification` | reloads once and waits again; fails with `[APPLICATION] Login verification failed: ... still not visible after one page reload ...` |

Locators, unchanged from `LoginPage.ts` (Browser's `xpath=` prefix):

```text
${PB_USERNAME_INPUT}   xpath=//input[@type="email"]
${PB_PASSWORD_INPUT}   xpath=//input[@type="password"]
${PB_LOGIN_BUTTON}     xpath=//button[normalize-space()="LOGIN"]
${PB_HEADER}           xpath=//span[normalize-space()="ProjectBase 2.0"]
```

**The retry is a reload, not a second login.** Credentials are entered and LOGIN is clicked
exactly once. The reload only helps when the login succeeded but the page did not finish
rendering (the session survives the reload); a rejected login still fails. Both the first failure
and the reload are logged as WARN. A test-level `[Timeout]` is not caught by the TRY.

**Status:** not yet run against ProjectBase (no URL/credentials were available). Verified on
2026-10-19: dry run; and all keywords against a throwaway local mock page using the same locators
(not ProjectBase) – normal login (3/3), header only after reload (pass, one fill/click/reload),
header never shown (fails with the message above), invalid password, password absent from all
outputs and redacted traces.

## 7a. OrangeHRM login with Excel test data

`tests/web/orangehrm_login.robot` → `Login Using Row Data` (tags `regression`, `smoke`,
`REG_TS_or_TC01`), converted from ABM-India `test/demoApplication/orange.spec.ts`:

```robotframework
Login Using Row Data
    [Tags]    regression    smoke    REG_TS_or_TC01
    Log    ${TC_ID_1} - Login using Get Test Data By Row
    ${data}=    Get Test Data By Row    ${ORANGE_LOGIN_WORKBOOK}    2    ${ORANGE_LOGIN_SHEET}    Username    Password
    Open Application
    Enter Login Credentials    ${data}
    Submit Login Form
    Verify Successful Login    store_as=LoggedInUser
    Log    ${TC_ID_1} - Login successful with row data (LoggedInUser = '${LoggedInUser}')
```

| `orange.spec.ts` | Robot Framework |
|---|---|
| `testDataManager.getTestDataByRow(ORANGE_LOGIN_WORKBOOK, 2, "LoginTestData")` | `Get Test Data By Row` (`libraries/ExcelTestData.py`) |
| `ORANGE_LOGIN_WORKBOOK = "excelDataFiles/Sample_TestData.xlsx"` (under ABM-India `testdata/`) | `ORANGE_LOGIN_WORKBOOK` env var pointing at the same file (not copied) |
| `configManager.getEasyURL() ?? configManager.getBaseURL()` | `Resolve Application URL`: `EASY_URL`, else `BASE_URL` |
| `basePage.navigateTo(url)` (domcontentloaded + load, `timeouts.navigation`) | `Open Application`: `Go To ... timeout=${NAVIGATION_TIMEOUT} wait_until=load` |
| `basePage.fill(el.username / el.password, ...)` | `Enter Login Credentials`: `Fill Text` / `Fill Secret` (password never logged) |
| `basePage.click(el.loginButton)` | `Submit Login Form`: `Click` |
| `waitForElementIsVisible(el.admin)`, `storeText(el.admin, "LoggedInUser")` (`Runtime.set`) | `Verify Successful Login`: wait (navigation timeout), `Get Text` (first match, trimmed), `Set Suite Variable ${LoggedInUser}` |
| `log.info` / `log.step` / `log.pass` | `Log` in each keyword and the test; the success message is logged last |
| `TestDataManager.clearCache()` in `afterAll` | `Clear Test Data Cache` in the suite teardown |

**Excel semantics (same as `getTestDataByRow`):** `row` is the physical 1-based row and row 1
holds the headers, so row 2 is the first data row (`REG_TS_or_TC01`, user `admin`). `sheet` is a
name, a 0-based index (`${0}`), or omitted for the first sheet. Empty cells become `''`. Workbooks
are read once, cached per file (reloaded when the file changes), and the file handle is closed
right after reading. Differences on purpose: the `Password` column comes back as a Robot Framework
`Secret` (shown as `<secret>` in the log), required columns are checked, and row 1 cannot be
requested. Errors start with `[TEST DATA]`: file not found, unreadable file, sheet or sheet index
not found, column not found, column empty, row not found or empty.

**Locators** are from ABM-India `src/pages/Element/Orange.ts`. Checked against the live demo on
2026-10-19, two matched nothing and were corrected minimally:

| Element | `Orange.ts` | Used here | Why |
|---|---|---|---|
| username | `//*[@placeholder='']` | `//*[@placeholder='Username']` | the input's placeholder is `Username`; the original matched 0 elements |
| password | `//*[@placeholder='Password']` | unchanged | 1 match |
| loginButton | `//*[@type='submit']` | unchanged | 1 match |
| admin | `//*[text()='admin']` | `//*[text()='Admin']` | the original matched 0 elements; `Admin` (the admin menu item) matches 1 |

So `${LoggedInUser}` holds `Admin` (the menu text), not the user's display name. The ABM-India logs
show the original `admin` locator already failing on 2026-06-22.

**Status (2026-10-19):** passed against the live OrangeHRM demo – the first run with the default
timeouts (10 s element, 15 s navigation from `.env`), and 2 of 3 runs with 20 s / 45 s. Every
failure was the public demo not rendering the dashboard after a successful login (blank page, title
`Loading ...`); the test then failed with `[APPLICATION] Login was not successful: Admin element ...
is not visible`. The password was found in no result file, including the redacted traces.

## 8. Playwright → Robot Framework mapping

| Playwright (`LoginPage.ts` and framework) | Robot Framework here |
|---|---|
| `page.goto(baseURL)` | `Go To    ${BASE_URL}    timeout=${NAVIGATION_TIMEOUT}    wait_until=domcontentloaded` |
| `locator.isVisible()` / `expect(locator).toBeVisible()` | `Wait For Elements State    <locator>    visible    [timeout=...]` |
| `expect(locator).toBeEnabled()` | `Wait For Elements State    <locator>    enabled` |
| `locator.fill(username)` | `Fill Text` |
| `locator.fill(password)` | `Fill Secret    <locator>    %APP_PASSWORD` (value never logged) |
| `locator.click()` | `Click` |
| `page.reload()` | `Reload    timeout=${NAVIGATION_TIMEOUT}    waitUntil=domcontentloaded` |
| `try/catch` around the header wait | `TRY` / `EXCEPT    AS    ${error}` |
| `test` fixtures / hooks | `Suite Setup`/`Suite Teardown` (browser), `Test Setup` (fresh context per test) in `browser.resource` |
| `BasePage`, `WaitUtils` | Browser's auto-waiting and state waits; shared keywords in `browser.resource` |
| `Global_Timeout` | `NAVIGATION_TIMEOUT_MS`; element waits `BROWSER_TIMEOUT_MS` |
| `configManager` | `.env` + `configuration.resource`, validated by `src/config` |
| `ErrorHandler` | `message=[APPLICATION] ...` on assertions; `Capture Browser Failure Diagnostics` |
| `logger` | Robot `Log` (INFO/WARN) in `log.html` |
| Playwright HTML report, screenshots, traces | `report.html`/`log.html`/`output.xml`, failure screenshots, optional traces (section 9) |

## 9. Reports, screenshots and traces

In `results/` (or the `--outputdir` you pass):

| File | Content |
|---|---|
| `report.html` | Summary per suite and tag |
| `log.html` | Keyword-level log with every step, retry warnings and failure details |
| `output.xml` | Machine-readable results (`rebot` can merge/re-render) |
| `browser/screenshot/failure-N.png` | Screenshot for each failing Browser keyword, embedded in the log |
| `browser/traces/*.zip` | With `BROWSER_TRACING=true`: one Playwright trace per test, with `APP_PASSWORD` and the workbook's Password column redacted. Open with `rfbrowser show-trace <zip>` |
| `playwright-log.txt` | Browser Library's Playwright log |

On every failing Browser keyword `Capture Browser Failure Diagnostics` adds the screenshot,
`[DIAGNOSTICS] Page at failure: url=... title=...`, uncaught page errors and console messages.
Error prefixes: `[APPLICATION]` (the application behaved wrongly), `[CONFIGURATION]` (missing or
invalid settings), `[TEST DATA]` (Excel workbook problems), `[ENVIRONMENT]` (toolchain), `[SECURITY]` (trace redaction failed).

## 10. Adding tests

1. **Page keywords** go in a resource per page (`resources/<page>.resource`): locators in
   `*** Variables ***`, keywords that use them, `Resource    browser.resource` in the settings.
   Add `message=[APPLICATION] ...` to assertions so failures explain themselves.
2. **Tests** go in `tests/web/<feature>.robot`, importing the page resources, with
   `Suite Setup    Open Application Browser`, `Suite Teardown    Close Application Browser`,
   `Test Setup    Open Fresh Application Context` and `Test Tags    web    projectbase`.
3. Reuse `Open Application` and the login keywords for tests that need a signed-in user.
4. Never put secrets in `.robot` files or Robot variables; use `Fill Secret    ...    %ENV_VAR`.
5. New settings: add them to `environmentConfig.ts`, `configuration.resource` and `.env.example`.

## 11. CI/CD (GitHub Actions)

`.github/workflows/robot-tests.yml` runs on push to `main`, pull requests, weekdays 02:00 UTC and
manually. It installs the pinned dependencies, builds and unit-tests the TypeScript, installs
Chromium, then runs the ProjectBase suite and uploads `results/`.

Required repository secrets: `PROJECTBASE_BASE_URL`, `PROJECTBASE_USERNAME`,
`PROJECTBASE_PASSWORD` (the job fails with a clear error if they are missing, e.g. on fork PRs).
Automatic runs exclude the `negative` tag (one failed login per run could lock the account) and
the `orangehrm` tag (its workbook lives outside this repository);
manual runs can include it and enable tracing. Runs are serialized (shared test account).

## 12. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `[CONFIGURATION] Invalid configuration: ...` | Fix `.env` or the environment; `npm run env:check` |
| `[CONFIGURATION] TEST_ENV=x but .env.x does not exist` | Create the profile file or drop `--env` |
| `Expected to stay on <host> after opening <url>` | `BASE_URL` redirects to another domain (e.g. SSO) |
| `Username input (...) is not visible` | Wrong `BASE_URL`, page not loaded, or locator changed |
| `Login verification failed: ... after one page reload` | Wrong credentials, account locked, or the post-login page changed; check the screenshot in `log.html` |
| Browser import fails mentioning `browserKeywords.js` | TypeScript not compiled: `npm run build` |
| Executable doesn't exist / node dependencies not installed | `rfbrowser install chromium` inside the venv (Batteries) |
| `spawn ...chrome-headless-shell.exe ENOENT` although the file exists | Windows 260-character path limit: shorter project path or `PLAYWRIGHT_BROWSERS_PATH` |
| `LookupError: unknown encoding: utf-8:surrogateescape` | For direct `robot` runs set `PYTHONIOENCODING=utf-8` |
| `Activate.ps1 cannot be loaded` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

## 13. Known limitations

- **Not yet run against ProjectBase**; only against a local mock page with the same locators.
- The OrangeHRM test depends on the public demo site, which is sometimes very slow (see 7a), and on
  a workbook outside this repository (`ORANGE_LOGIN_WORKBOOK`), so it is not part of CI.
- The invalid-password test does not assert ProjectBase's error message (text/locator must be taken
  from the live page) and makes one failed login per run.
- CI has never run on GitHub (no commits pushed yet).
- Only Chromium was used; Firefox/WebKit are configurable but untested.
- Traces from direct `robot` runs are redacted only after `npm run traces:redact`.
- No parallel execution is configured.
