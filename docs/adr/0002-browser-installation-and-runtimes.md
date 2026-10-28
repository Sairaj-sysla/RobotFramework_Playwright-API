# ADR 0002 — Browser Library installation route and Node.js runtimes

- Status: Accepted and adopted (proof of concept and main `.venv` on 2026-10-16: full suite 32/32
  on Batteries; CI workflow switched to `rfbrowser install --with-deps chromium` but not yet run)
- Context versions: Python 3.13.14, Robot Framework 7.5, robotframework-browser 20.6.0,
  robotframework-browser-batteries 20.6.0 (bundles Node.js v24.21.0 and Playwright 1.63.0),
  system Node.js 24.16.0, Windows 11 Pro 10.0.26200

## Context

Browser Library has two Python-side halves: the Robot library (`robotframework-browser`) and a
Node.js gRPC wrapper that drives Playwright. The wrapper can come from two places:

| Route | Install | Wrapper runs on | Browsers installed by |
|---|---|---|---|
| **Browser Batteries** | `pip install "robotframework-browser[bb]"` then `rfbrowser install chromium` | Node.js bundled in the `robotframework-browser-batteries` wheel (`BrowserBatteries/bin/node.exe`) | `rfbrowser install` |
| External Node.js | `pip install robotframework-browser` then `rfbrowser init chromium` | `node` found on `PATH`, with npm packages installed into `Browser/wrapper/node_modules` | `rfbrowser init` |

The decision is made in the installed library code, not configuration: `Browser/playwright.py`
imports `BrowserBatteries.start_grpc_server` when the package is present and otherwise spawns
`node` from `PATH` (`batteries_grpc_server()`, `_start_playwright_from_node`). `rfbrowser --help`
states that `rfbrowser init` must not be run when Batteries is installed, and `rfbrowser install`
must not be run without it.

The framework uses Node.js for more than Browser: the TypeScript build (`tsc`), the API remote
server, the demo application, the orchestrator and the TypeScript unit tests. Batteries does not
change that.

## Decision

1. **Batteries is the preferred Browser Library installation route** on platforms that have a
   Batteries wheel. Version 20.6.0 publishes wheels for `win_amd64`, `manylinux_2_28_x86_64`,
   `manylinux_2_28_aarch64`, `macosx_13_0_x86_64` and `macosx_13_0_arm64`, and requires
   Python ≥ 3.10. `robotframework-browser` and `robotframework-browser-batteries` are pinned to the
   same version (Batteries declares `robotframework-browser==20.6.0`).
2. **The external-Node route stays documented as the fallback** for platforms without a wheel
   (e.g. Windows on ARM, older glibc) and for teams that must audit or patch the npm tree.
3. **System Node.js ≥ 20.12 remains a framework requirement** for building and running the
   TypeScript services. Two Node runtimes therefore exist in a Batteries setup, and they never
   share modules:

   ```
   Robot (Python) ──gRPC──► BrowserBatteries/bin/node.exe (v24.21.0) ── Playwright ── browser
                                  └── require()s dist/src/playwright/browserKeywords.js
   Robot (Python) ──XML-RPC──► system node (v24.16.0) ── dist/src/remote/main.js (API keywords)
   npm / tsc / orchestrator / demo app ──► system node
   ```

## Validation (proof of concept, 2026-10-16)

A separate virtual environment (`robotframework==7.5`, `robotframework-browser[bb]==20.6.0`) ran
a three-test suite through the project's orchestrator with **system Node removed from `PATH` for
Robot** (the orchestrator and its services were started with an absolute `node.exe` path):

| Test | Result |
|---|---|
| Browser keyword: `New Browser` / `New Page` / `Get Title` on the demo app | PASS |
| Compiled TS extension: `Get Form Validation State` loaded via `jsextension=` | PASS — `playwright-log.txt` shows `Adding 2 keywords from JS Extension` executed by `BrowserBatteries\bin\wrapper` |
| TS API keyword through `Remote`: `Create API Session` + `Send API Request GET /health` | PASS |

Also verified:
- The project's real API suite (`--include api`, 19 tests, existing environment) passed with
  **zero Browser keywords** in `output.xml` and no `playwright-log.txt`: the Browser process never
  started.
- System browsers: `New Browser    chromium    channel=chrome` (Chrome 155.0.8059.40) and
  `channel=msedge` (Edge 155.0.4283.45) both launched and passed. The Playwright-managed Chromium
  is 153.0.8010.12.
- The custom extension has no runtime `require()` of npm packages (`playwright-core` is a
  types-only dev dependency), which is what makes it portable to the Batteries Node runtime.

## Consequences and risks

- **Windows path length.** The first PoC run failed with `spawn ...chrome-headless-shell.exe ENOENT`
  although the file existed: the executable path was 326 characters, because Playwright installs
  browsers under `site-packages/Browser/wrapper/node_modules/playwright-core/.local-browsers`.
  Process creation fails above 260 characters even with `LongPathsEnabled=1`. The run passed once
  `PLAYWRIGHT_BROWSERS_PATH` pointed to a shorter directory. Keep the project/venv path short, or
  set `PLAYWRIGHT_BROWSERS_PATH` (e.g. `%LOCALAPPDATA%\ms-playwright`) before `rfbrowser install`
  and for test runs.
- **Browsers live inside the `Browser` package**, not in the Batteries package, so recreating the
  venv deletes them unless `PLAYWRIGHT_BROWSERS_PATH` is used.
- **Extensions must stay dependency-free at runtime.** A future extension that `require()`s an npm
  package would resolve against the Batteries wrapper's `node_modules`, not the project's. This was
  not tested; bundle such dependencies into the extension instead.
- **Two Node versions** (bundled v24.21.0 vs system v24.16.0) can differ; the extension is compiled
  to ES2023, which both support.
- **`rfbrowser show-trace` under Batteries** supports only `--browser` (per its help text).
- **Offline installation** needs, per target platform: the Python wheels
  (`pip download -r requirements.txt` on a machine with the same OS/Python), the browser binaries
  (copy a populated `PLAYWRIGHT_BROWSERS_PATH`; `rfbrowser install` downloads from
  `cdn.playwright.dev`), and the npm packages (`npm ci` from a populated npm cache or internal
  registry). None of the offline paths has been executed yet.
