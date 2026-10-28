# Robot Framework + Playwright + TypeScript API automation framework

Keyword-driven test automation for web UI, REST API and combined API/UI workflows:

- **Robot Framework** runs the tests (`.robot` files) and produces the reports.
- **Browser library** drives Playwright for the UI, extended with two **TypeScript** keywords.
- The **API client and API keywords are TypeScript**, served to Robot Framework through Robot's
  standard remote library interface by a TypeScript XML-RPC server. No Python API code.
- A small **demo application** (TypeScript, in `demo-app/`) provides a UI and REST API that share
  data, so every suite – including the API→UI→API integration flow – runs locally and in CI without
  touching a shared environment.

> Status: the sample suites pass (32/32) against the bundled demo app on Windows 11. This is a
> working foundation, **not** a production-ready framework yet – see
> [Known limitations](#19-known-limitations) and [Before broader adoption](#20-future-improvements-and-before-broader-adoption).

---

## 1. Purpose

Provide a maintainable starting point for teams that write tests in Robot Framework but want browser
extensions and API logic in TypeScript, with typed code, unit tests, secure logging, categorised
failures and a single command for local and CI runs.

## 2. Architecture

```
                         npm test / npm run test:api / ...            (scripts/runTests.ts)
                                         │  loads .env, validates config, starts services,
                                         │  waits for readiness, runs Robot, stops services,
                                         │  exits with Robot's return code
           ┌─────────────────────────────┼──────────────────────────────┐
           ▼                             ▼                              ▼
  Demo app (Node, TS)          Robot Framework (Python)        API remote server (Node, TS)
  demo-app/server.js           tests/*.robot + resources/      src/remote/main.ts
  UI + /api, shared store            │             │           127.0.0.1:8270
           ▲                         │             │  XML-RPC     ▲
           │                         │             └──(Remote)────┘ src/api/apiKeywords.ts
           │                         │                              src/api/apiClient.ts ──HTTP──┐
           │              Browser library (gRPC)                                                │
           │                         ▼                                                          │
           │              Browser's Node process ── Playwright ── Chromium                      │
           │               + jsextension: dist/src/playwright/browserKeywords.js                │
           └───────────────────────── HTTP ◄──────────────────────────────────────────────────┘
```

How the pieces talk:

| From → To | Mechanism |
|---|---|
| Robot → Browser library | Python library import (`Library Browser jsextension=...`) |
| Browser library → Playwright | gRPC to Browser's own Node process |
| Browser → custom TS keywords | Browser `require()`s the compiled JS module into that Node process; `page`/`logger` are injected |
| Robot → TypeScript API keywords | Robot's built-in `Remote` library → XML-RPC → `src/remote/remoteServer.ts` |
| TS API keywords → application | `src/api/apiClient.ts` (Node's native `fetch`) |

The API path never involves Browser: API suites import only `resources/api.resource`. In a verified
API-only run, the output contains zero Browser keywords and Browser's Node process is never started.

Why a remote server and not something else is recorded in
[docs/adr/0001-typescript-api-integration.md](docs/adr/0001-typescript-api-integration.md)
(includes the evaluation of `robotremote`/`xmlrpc` npm packages and of a per-call process bridge).

## 3. Technology choices

| Component | Version (tested) | Why |
|---|---|---|
| Python | 3.13.14 | Robot Framework runtime |
| robotframework | 7.5 | Test runner, reports |
| robotframework-browser | 20.6.0 (bundles Playwright 1.63.0) | Playwright keywords, `jsextension` |
| Node.js | 24.16.0 (≥ 20.12 required) | TS runtime; built-in `fetch`, `process.loadEnvFile`, `node:test` |
| typescript | 6.0.3 | Mature line; 7.x (native compiler) can be evaluated later |
| fast-xml-parser | 5.11.2 | Actively maintained XML parser used by the XML-RPC codec (the only runtime npm dependency) |
| @types/node | 24.19.2 | Types for Node 24 |
| playwright-core | 1.63.0 | **Types only** for the browser extension; matches Browser's bundled Playwright |

Not used, deliberately: an HTTP library (native `fetch` covers it), `dotenv` (Node's
`process.loadEnvFile`), a test runner for TS (built-in `node:test`), SeleniumLibrary.

## 4. Folder structure

```
.github/workflows/robot-tests.yml   CI: smoke on push/PR, regression nightly, manual suite choice
demo-app/                           Application under test (UI + REST API, in-memory store)
docs/adr/                           Architecture decision record
resources/
  configuration.resource            Env-driven variables, required-config check
  common.resource                   Generic helpers (dictionary comparison, row lookup)
  web.resource                      Browser lifecycle, navigation, login, page helpers, failure diagnostics
  api.resource                      Remote import of TS API keywords, session setup/cleanup
scripts/
  runTests.ts                       Orchestrator (services + Robot + exit code)
  robotArgs.ts                      Robot command line assembly (options before data sources)
  processUtils.ts                   Child-process start/readiness/stop helpers
  checkEnv.ts / stopRemote.ts       Config validation; stop a standalone remote server
src/
  api/        apiClient.ts, apiKeywords.ts, apiTypes.ts, apiErrors.ts
  config/     environmentConfig.ts (schema + validation), configManager.ts (.env loading)
  playwright/ browserKeywords.ts   Custom Browser keywords (jsextension)
  remote/     xmlRpc.ts, keywordLibrary.ts, remoteServer.ts, main.ts
  testdata/   testDataFactory.ts
  utils/      errorHandler.ts, logger.ts, retryUtils.ts, sanitize.ts, fieldPath.ts
test/unit/                          TypeScript unit tests (node:test)
testdata/users.json                 Expected values and invalid inputs (Robot JSON variable file)
tests/
  web/          login.robot, user_form.robot
  api/          users_api.robot
  integration/  user_workflow.robot
  diagnostics/  intentional_failures.robot   (excluded by default)
dist/ results/ .venv/ node_modules/          generated, git-ignored
```

## 5. Prerequisites

- Windows 10/11 with PowerShell (Linux works as well; CI runs on Ubuntu)
- Python 3.10+ (tested 3.13) – `python --version`
- Node.js 20.12+ (needed for `process.loadEnvFile`; tested only with 24.16 – Browser's getting-started
  page states no minimum Node version) – `node --version`
- Git, VS Code (recommended extensions in `.vscode/extensions.json`: RobotCode, Python)

## 6–7. Setup on Windows (PowerShell) and dependency installation

```powershell
git clone <repo-url> robot-playwright-api
cd robot-playwright-api

# Python virtual environment + Robot Framework + Browser library
python -m venv .venv
.\.venv\Scripts\Activate.ps1           # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
python -m pip install --upgrade pip
python -m pip install -r requirements.txt -c requirements-lock.txt

# Browser library's Node dependencies + Playwright Chromium (~115 MB download)
rfbrowser init chromium

# Node / TypeScript dependencies (exact versions from package-lock.json)
npm ci

# Configuration (then edit .env: set API_TOKEN to 16+ random chars and APP_PASSWORD)
Copy-Item .env.example .env

# Compile and verify
npm run build
npm run env:check                    # validates config, prints it with secrets masked
robot --version                      # Robot Framework 7.5 (Python 3.13...)
npm run test:unit                    # 40 TypeScript unit tests
npm run test:smoke                   # 8 Robot smoke tests (web, API, integration)
```

To generate a random token: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.

`requirements.txt` pins the two direct Python packages; `requirements-lock.txt` is the `pip freeze`
of the tested environment and is used as a constraints file. `package-lock.json` pins npm packages.

## 8. Environment configuration

All configuration comes from environment variables; `.env` (git-ignored) is loaded by every TS
process. **Variables already set in the environment win over `.env`**, so CI secrets are never
overridden by a stray local file. Validation (`src/config/environmentConfig.ts`) runs before any
service starts and reports every problem at once, e.g.:

```
[CONFIGURATION] Invalid configuration:
  - BASE_URL must be an absolute http(s) URL, got 'not-a-url'
  - API_TIMEOUT_MS must be an integer between 100 and 300000, got 'abc'
```

| Variable | Default | Purpose |
|---|---|---|
| `TEST_ENV` | local | Environment name |
| `BASE_URL` | – (required) | UI base URL |
| `API_BASE_URL` | – (required) | API base URL |
| `API_TOKEN` | – (required, secret, ≥16 chars) | Bearer token, read only by the remote server |
| `APP_USERNAME` / `APP_PASSWORD` | – (required; password secret) | UI login |
| `BROWSER` | chromium | chromium / firefox / webkit (run `rfbrowser init` for others) |
| `HEADLESS` | true | Headed run: `HEADLESS=false` |
| `BROWSER_TIMEOUT_MS` | 10000 | Browser action/assertion timeout |
| `NAVIGATION_TIMEOUT_MS` | 15000 | Page loads and waits for asynchronously loaded page content (users table) |
| `BROWSER_TRACING` | false | `true` writes a Playwright trace zip per context |
| `API_TIMEOUT_MS` | 10000 | Per-request timeout |
| `API_RETRIES` | 1 | Extra attempts – **GET/HEAD/OPTIONS only**, on network errors and 502/503/504 |
| `LOG_LEVEL` | info | Framework process logs (`results/logs/*.log`) |
| `RESULTS_DIR` | results | Robot output directory |
| `REMOTE_HOST` / `REMOTE_PORT` | 127.0.0.1 / 8270 | API remote server bind address |
| `START_DEMO_APP` / `DEMO_APP_PORT` | true / 3000 | Bundled demo app (set `false` for a real environment) |
| `DEMO_UI_DELAY_MS` | 300 | Delay before the demo users table renders (exercises waits) |

- **Local:** `.env` from `.env.example`.
- **Test environment:** set `BASE_URL`, `API_BASE_URL`, credentials and `START_DEMO_APP=false`
  (the sample suites assume the demo app's pages and data; see limitations).
- **CI:** repository secrets `API_TOKEN`, `APP_USERNAME`, `APP_PASSWORD` (optional for the demo app –
  the workflow generates throw-away values when they are absent).

## 9. The TypeScript API integration

`src/remote/remoteServer.ts` implements the methods Robot's `Remote` client calls
(`get_library_information`, `run_keyword`, the per-keyword fallbacks and `stop_remote_server`); the
protocol was taken from the installed `robot/libraries/Remote.py`. Keywords are declared once in
`src/api/apiKeywords.ts` with typed parameters; Robot receives argument specs, types (so it converts
`int`, `bool`, `dict`) and documentation:

```powershell
npm run remote:start        # terminal 1 (foreground)
python -m robot.libdoc Remote::http://127.0.0.1:8270 list      # discover keywords
python -m robot.libdoc Remote::http://127.0.0.1:8270 results/api-keywords.html
npm run remote:stop
```

API keywords: `Create API Session`, `Close API Session`, `Verify API Is Available`,
`Send API Request`, `Get API Response Status`, `Get API Response Field`, `Verify API Status Code`,
`Verify API Response Field`, `Verify API Response Field Type`, `Generate Test User Data`,
`Create Test User`, `Get User By ID`, `Update Test User`, `Delete Test User`,
`Register Test User For Cleanup`, `Delete Created Test Users`.

Design points:
- **Sessions** are named (`session=default`) and hold the client, last response and the ids of
  records the session created. The token never passes through Robot: the server reads `API_TOKEN`.
- **Safe cleanup:** `Delete Test User` refuses ids the session did not create or register
  (`[TEST DATA] Refusing to delete user ...`); `Delete Created Test Users` deletes only tracked ids.
- **Returned values are sanitized** (Robot logs return values): sensitive headers and fields such as
  `password`, `token`, `apiKey` are replaced with `***REDACTED***`.
- **Lifecycle:** the orchestrator starts the server, waits for a real XML-RPC response (not just an
  open port), refuses to reuse a port that is already taken (stale server), and stops it afterwards.

## 10. Browser library custom extensions

`src/playwright/browserKeywords.ts` compiles to `dist/src/playwright/browserKeywords.js`, loaded by
`resources/web.resource` with `jsextension=`. Only gaps in Browser's keyword set were filled:

| Keyword | Value over built-ins |
|---|---|
| `Get Table Rows As Dicts    selector    timeout=10000` | Browser only offers cell/row index lookups; this returns whole tables as `[{Header: text}]` |
| `Get Form Validation State    selector    timeout=10000` | One call returns HTML5 validity for every field with language-independent `reasons` (`valueMissing`, `typeMismatch`, ...); never returns field values |

Browser derives the keyword name from the export name and the Robot signature from the compiled
function's parameters; `page` and `logger` are injected, so they come last. Console logs and page
errors are **not** re-implemented – Browser has `Get Console Log` and `Get Page Errors`.

Locator policy: accessible role/label (`Get Element By Role`, `Get Element By    Label`) first, then
`data-testid=...`, then `id=...`; CSS/XPath only when nothing else exists. Waits are state-based
(`Wait For Elements State`, assertion retries); there are no fixed sleeps.

## 11–13. Sample tests

**UI** (`tests/web/user_form.robot`):
```robotframework
Empty Form Is Blocked By Browser Validation
    [Tags]    smoke
    Submit New User Form
    Get Url    $=    /users/new
    ${state}=    Get Form Validation State    id=new-user-form
    Should Not Be True    ${state}[valid]
    Should Contain    ${state}[fields][email][reasons]    valueMissing
```

**API** (`tests/api/users_api.robot`):
```robotframework
Create User Returns 201 With The Stored User
    ${data}=    API.Generate Test User Data    role=editor
    ${response}=    API.Send API Request    POST    /users    ${data}    expected_status=201
    API.Register Test User For Cleanup    ${response}[body][id]
    API.Verify API Response Field    email    ${data}[email]
    API.Verify API Response Field Type    id    string
```

**API → UI → API** (`tests/integration/user_workflow.robot`): create a user through the TS API,
find it in the asynchronously rendered UI table, open its page and compare every displayed value,
fetch it through the API, update it through the API and verify the UI reflects it, delete it and
verify both the UI ("User not found.") and the API (404). A second test goes UI → API: create a user
through the form (text, dropdown, radio, checkbox) and verify the persisted record via the API.

Test inventory (32 + 3 intentional failures):

| Suite | Tests |
|---|---|
| web/login.robot (6) | valid login + table content; invalid password; empty credentials; protected-page redirect and return; navigation + history; sign out |
| web/user_form.robot (5) | empty form blocked; invalid email; unchecked confirmation; dropdown/radio applied; duplicate email server error with input kept |
| api/users_api.robot (19) | health (no auth); list/filter; POST 201; GET by id; PATCH; DELETE → 404; missing → 404; invalid payloads → 400 + details; malformed JSON → 400; no token → 401; unexpected status message; auth-failure hint; 500 handling; invalid JSON response; timeout; missing field; wrong type; connection failure; cleanup refuses untracked delete |
| integration/user_workflow.robot (2) | API→UI→API with update and delete; UI→API |
| diagnostics/intentional_failures.robot (3, excluded) | locator failure; UI assertion failure; API unexpected status |

## 14. Running tests

Every `npm run` command below except `remote:stop` compiles TypeScript first (npm `pre*` hooks).

| What | Command |
|---|---|
| All tests (except intentional failures) | `npm test` |
| Web only | `npm run test:web` |
| API only (no browser) | `npm run test:api` |
| Integration | `npm run test:integration` |
| Smoke / Regression | `npm run test:smoke` / `npm run test:regression` |
| A file | `npm run robot -- tests/web/login.robot` |
| One test | `npm run robot -- --test "Missing User Returns 404" tests/api/users_api.robot` |
| Any Robot options | `npm run robot -- --include api --exclude security --loglevel TRACE` |
| Failure diagnostics demo (exits 3) | `npm run test:failure-demo -- --outputdir results/failure-demo` |
| Compile | `npm run build` |
| TS unit tests | `npm run test:unit` |
| Start / stop API keyword server | `npm run remote:start` / `npm run remote:stop` |
| Start demo app alone | `npm run demo:start` |

Orchestrator flags: `--no-demo-app`, `--no-remote` (e.g. when you started them yourself).
Robot options must come before data sources; the orchestrator keeps that order and adds
`--outputdir results --loglevel DEBUG:INFO --exclude intentional-failure` unless you override them.

**Exit codes** are Robot's own: `0` all passed, `1–250` number of failed tests, `252` invalid
arguments, `253` interrupted. The orchestrator adds `252` for invalid configuration and `255` when a
service cannot start. Nothing is masked: a failing test fails `npm test`.

Running `robot` directly (e.g. from RobotCode in VS Code) works when the services are running and
the `.env` variables are in the environment. In PowerShell:

```powershell
# load .env into the current session (strips inline comments)
Get-Content .env | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  Set-Item "env:$($name.Trim())" (($value -replace '\s+#.*$', '').Trim()) }
npm run build
$demo = Start-Process node -ArgumentList 'dist/demo-app/server.js' -PassThru -WindowStyle Hidden
Start-Process node -ArgumentList 'dist/src/remote/main.js' -WindowStyle Hidden
.\.venv\Scripts\robot.exe --outputdir results tests/api tests/integration
npm run remote:stop; Stop-Process -Id $demo.Id
```

Alternatively start the services yourself and let the orchestrator skip them:
`npm run robot -- --no-demo-app --no-remote tests/api`.

## 15. Reports and diagnostics

After a run, in `results/` (or the `--outputdir` you pass):

| File | Content |
|---|---|
| `report.html` | Summary per suite/tag; open in a browser: `Invoke-Item results\report.html` |
| `log.html` | Keyword-level log: failing test and keyword are expanded and red |
| `output.xml` | Machine-readable results (`rebot` can merge/re-render) |
| `browser/screenshot/failure-N.png` | Screenshot embedded in the log for each failing Browser keyword |
| `browser/traces/trace_context=<id>.zip` | Only with `BROWSER_TRACING=true`: one Playwright trace per test context (actions grouped by Robot keyword, DOM snapshots, screencast, network, errors). The log shows the path in each test's setup (`trace file will be saved to ...`). Open with `rfbrowser show-trace <zip>`. `browser/traces/temp/` holds Browser's unpacked working files and can be ignored |
| `playwright-log.txt` | Browser library's Node/Playwright log |
| `logs/demo-app.log`, `logs/remote-server.log` | JSON-lines logs of the started services |

Failure messages start with a category so the likely cause is visible without reading code:

| Prefix | Meaning | Example |
|---|---|---|
| `[APPLICATION]` | The application responded incorrectly | `Expected HTTP 200 but got 404 Not Found for GET .../users/x. Response body: {"error":"User x not found"}` |
| `[API]` | The API call itself failed | `GET .../slow did not respond within 300 ms` |
| `[ENVIRONMENT]` | Service/dependency unavailable | `Could not connect for GET http://127.0.0.1:9/api/users: ECONNREFUSED` |
| `[CONFIGURATION]` | Missing/invalid settings | `Environment variable BASE_URL is not set` |
| `[TEST DATA]` | Test data problem | `Refusing to delete user '...': it was not created or registered by API session 'default'` |
| `[AUTOMATION]` | Framework/automation error | `API session 'x' does not exist` |

Browser keyword failures keep Playwright's own message (e.g. `TimeoutError: locator.click: Timeout
2000ms exceeded ... waiting for locator('data-testid=...')`); `Capture Browser Failure Diagnostics`
adds a screenshot, URL, title, page errors and console log. Created record ids are logged
(`Created test user id=...`), and API request/response details are logged at DEBUG (sanitized).

## 16. CI/CD (GitHub Actions)

`.github/workflows/robot-tests.yml`: Python 3.13 + Node 24 → `pip install` (constrained) →
`npm ci` → build → TS unit tests → `rfbrowser init --with-deps chromium` → credentials (masked;
secrets if present, otherwise random per run) → config validation → orchestrator → artifact upload
of `results/` with `if: always()` (14 days). Push/PR run `smoke`, the nightly schedule runs
`regression`, and *Run workflow* lets you choose `smoke`, `regression`, `api`, `web` or
`integration`. The job's status is Robot's exit code.

## 17. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `[CONFIGURATION] Invalid configuration: ...` | Fix `.env` or environment; `npm run env:check` |
| `[ENVIRONMENT] Remote server port 8270 is already in use` | A standalone server is running: `npm run remote:stop`, or change `REMOTE_PORT` |
| `Port 3000 is already in use` | Another app/demo instance; stop it or set `DEMO_APP_PORT` + URLs |
| `Importing library 'Remote' failed` / connection refused in API suites | Remote server not running – use the npm scripts or `npm run remote:start` |
| Browser import fails mentioning `browserKeywords.js`, or `Get Table Rows As Dicts` not found | TypeScript not compiled: `npm run build` |
| `Browser ... node dependencies not installed` / executable doesn't exist | `rfbrowser init chromium` (inside the venv) |
| `LookupError: unknown encoding: utf-8:surrogateescape` | Robot 7.5 uses `PYTHONIOENCODING` verbatim when output is piped; the orchestrator strips `:errors`, for direct `robot` runs set `PYTHONIOENCODING=utf-8` |
| `Activate.ps1 cannot be loaded` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `npm run robot -- --test "A B"` mangles the name | Fixed by running scripts through `pre*` hooks; don't chain `&&` in scripts that receive arguments |
| `Run Keyword And Expect Error    [API] ...` doesn't match | `[...]` is a glob character class; use `EQUALS:`/`STARTS:` prefixes |

## 18. Security considerations

- `.env` is git-ignored; `.env.example` contains placeholders only. CI uses masked secrets.
- `API_TOKEN` is read by the remote server only. `APP_PASSWORD` is typed with
  `Fill Secret    ...    %APP_PASSWORD` and never stored in a Robot variable.
- Robot logs assigned values, so the configuration check evaluates environment variables inside
  an expression instead of assigning them (this leak was found and fixed during validation).
- Verified: after a full run, neither the token nor the password occurs in any file under `results/`.
- Headers (`Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, ...) and body fields matching
  password/secret/token/api key/credential are redacted in logs, error messages and returned values.
- The remote server binds to `127.0.0.1` (warns if configured otherwise). It has no authentication:
  anyone who can reach the port can run the keywords (with the configured token). Keep it on loopback.
- Retries only for idempotent reads; writes are never retried. All HTTP calls have bounded timeouts.
- Cleanup deletes only records the test session created or registered.
- Playwright debug logs can contain filled secrets (Browser documents this); keep Browser's log level default.

## 19. Known limitations

- **Demo-app coupling:** the sample suites target the bundled demo app (its pages, seeded users and
  `/api/test-fixtures/*` error endpoints). Pointing them at another application requires new page
  keywords and data; the framework layers (remote server, API client, config, orchestrator) are generic.
- **No parallel execution:** sessions live in one server process; pabot would need a server per
  worker or worker-scoped session aliases.
- **Robot `[Timeout]` cannot interrupt a remote keyword**; HTTP calls are bounded by `API_TIMEOUT_MS`
  and the Remote import uses `timeout=120 s`.
- **The XML-RPC protocol code is project-owned** (no maintained npm alternative). It is covered by
  unit tests and the Robot suites, which must be re-run when upgrading Robot Framework.
- **Only Chromium was installed and tested.** Firefox/WebKit and headed mode are configurable but unverified.
- **Ctrl+C handling is not verified:** the orchestrator stops its services in a `finally` block,
  but interrupting a run was not tested.
- **CI workflow is unexecuted** in this repository (no remote yet). Commands were checked locally
  (`rfbrowser init --with-deps` exists, YAML parses), but the first GitHub run is the real test.
- Only HTML5 constraint validation and a server error list are covered for forms; no file uploads,
  iframes, downloads or multi-tab flows are exercised.
- Remote-keyword failures are reported to Robot as failures, not as Python exceptions with types,
  so `Run Keyword And Expect Error` must match on message text (which includes the category).

## 20. Future improvements and before broader adoption

Required before broader adoption:
1. Run the workflow on GitHub and fix whatever differs on Linux runners.
2. Replace the demo-app page keywords and data with keywords for the real application; add
   environment-specific data provisioning and confirm cleanup endpoints there.
3. Security review of the remote server (consider a shared-secret header if it must ever leave loopback).
4. Decide on parallelism (pabot) and implement per-worker servers if needed.
5. Agree on tag taxonomy, naming conventions and review rules for new keywords.
6. Run Firefox/WebKit if they are in scope.

Possible improvements: libdoc HTML for the API keywords generated in CI; JUnit/xUnit output
(`--xunit`) for CI test summaries; Robot listener to attach `remote-server.log` excerpts to failed
tests; TypeScript 7 evaluation; ESLint for the TS code; `robotidy`/`robocop` for `.robot` style.
