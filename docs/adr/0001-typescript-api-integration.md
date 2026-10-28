# ADR 0001 — Exposing TypeScript API keywords to Robot Framework

- Status: Superseded on 2026-10-19 – the API layer (remote server, API keywords, demo app) was removed
  when the framework became ProjectBase UI-only. Kept as a historical record.
- Originally accepted (validated by an executable spike on 2026-10-14)
- Context versions: Robot Framework 7.5, robotframework-browser 20.6.0 (Playwright 1.63.0), Node.js 24.16, Python 3.13

## Context

Test scenarios live in `.robot` files and Robot Framework runs on Python. The API client and
API keyword implementation must be TypeScript, not Python. Browser automation is handled by
Browser Library, which already runs a Node.js/Playwright process and loads JavaScript
extensions (`jsextension=`), but that process is tied to a browser session and is not a good
host for API keywords that must run without a browser.

## Options considered

### A. TypeScript remote library (Robot Framework remote interface over XML-RPC) — **chosen**

Robot's standard `Remote` library (`robot/libraries/Remote.py`) talks XML-RPC to a server that
implements `get_library_information` (one round-trip for all metadata; RF ≥ 4) or the
per-keyword `get_keyword_*` methods, and `run_keyword(name, args, kwargs)` returning
`{status, return, output, error, traceback, continuable, fatal}`. The protocol was taken from the
installed Remote.py source rather than assumed.

Existing npm implementations were evaluated and rejected:

| Package | Latest | Last publish | Assessment |
|---|---|---|---|
| `robotremote` | 1.5.1 | 2022-12 | Unmaintained for ~4 years; predates `get_library_information`; no argument types; depends on `xmlrpc`. |
| `xmlrpc` | 1.3.2 | 2016 | Unmaintained; would be the core of a long-lived dependency. |

Instead, the framework contains a small, tested XML-RPC codec (`src/remote/xmlRpc.ts`) that uses
the actively maintained `fast-xml-parser` only for XML parsing, plus a keyword server
(`src/remote/remoteServer.ts`, ~200 lines).

### B. Process bridge (Robot `Process` library runs `node script.js` per call, JSON over stdout)

- Measured ~280 ms Node start-up per call on the development machine (10 runs: 2.8 s).
- No in-memory state between calls: sessions, last response and created-record tracking for
  cleanup would need a file or other side channel.
- Keyword names, arguments and docs would not be discoverable (one generic "Run Node" keyword),
  so libdoc and editor completion would not work.
- Return values arrive as strings and must be parsed with additional Robot keywords.

### C. Browser Library JS extension for API keywords

Rejected: API keywords would depend on the Browser library process and an imported Browser
library, contradicting the requirement that API tests run without browser infrastructure.

## Decision

Use option A. API suites import only `Remote    http://127.0.0.1:8270`. Browser suites import
`Browser    jsextension=dist/src/playwright/browserKeywords.js` for the two custom browser
keywords. The two Node processes are independent.

## Validation (spike)

A throwaway keyword set was served from the compiled server and exercised by a `.robot` suite
(5 tests, all passed, rc=0) covering: discovery through `get_library_information`, Robot-side
argument conversion from served types (`int`, `bool`, `dict` literal), named-only arguments,
`None` → `<nil/>` → `${None}`, nested lists/dicts and 64-bit integers, keyword log output in the
Robot log, failure messages containing XML special characters, `libdoc` generation, and
`stop_remote_server`. One defect was found and fixed: `libdoc` requests `__init__`
documentation, so library information must contain an `__init__` entry.

## Consequences

- One extra process to manage. `scripts/runTests.ts` starts it (and the demo app), waits for a
  real XML-RPC readiness response, runs Robot, propagates Robot's exit code and always stops
  child processes. The server binds to `127.0.0.1` by default.
- Server state (sessions, tracked test records) is process-wide. Suites run sequentially with
  plain `robot`. Parallel execution with pabot would need one server per worker or session
  aliases that include the worker id; this is not implemented.
- Robot's keyword `[Timeout]` cannot interrupt a running remote call; every HTTP call therefore
  has its own bounded timeout (`API_TIMEOUT_MS`).
- The Remote client converts `None` arguments to empty strings; the binder treats `''` as "not
  given" for parameters whose default is `None`.
- Return values are logged by Robot at INFO level, so the API keywords return sanitized
  headers/bodies (see `src/utils/sanitize.ts`). Auth tokens never pass through Robot: the server
  reads `API_TOKEN` from its own environment.
- The protocol code is owned by this project, so `test/unit/remote.test.ts` (XML-RPC codec, keyword binding, request guard) and the Robot
  suites act as its compatibility tests when Robot Framework is upgraded.

## Local and CI usage

Locally and in CI the same command (`npm test`, or `npm run test:api` etc.) builds TypeScript,
starts the services, runs Robot and stops the services. The remote server can also be started
on its own (`npm run remote:start`) for running `robot` directly from VS Code.
