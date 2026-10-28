# Phase 1 — Feasibility report (2026-10-16)

The repository already contained a working framework (32 Robot tests and 45 unit tests reported
passing on 2026-10-14). Phase 1 therefore verified the architecture against the requirements and
proved the one route that had not been tried: Browser Batteries. Decisions are in
[ADR 0001](adr/0001-typescript-api-integration.md) (TypeScript API via XML-RPC remote library) and
[ADR 0002](adr/0002-browser-installation-and-runtimes.md) (Batteries and the two Node runtimes).

## Environment (inspected)

| Component | Version | Source |
|---|---|---|
| Windows | 11 Pro 10.0.26200, `LongPathsEnabled=1` | registry |
| Python | 3.13.14 | `.venv` |
| Robot Framework | 7.5 | `.venv` |
| robotframework-browser | 20.6.0 (Playwright 1.63.0) | `.venv`, external-Node route |
| robotframework-browser-batteries | 20.6.0 (bundled Node v24.21.0) | PoC venv only |
| Node.js / npm | 24.16.0 / 11.13.0 | system |
| TypeScript | 6.0.3 | `node_modules` |
| Chromium (Playwright) | 153.0.8010.12 | `rfbrowser install` / `init` |
| Chrome / Edge (system) | 155.0.8059.40 / 155.0.4283.45 | `Program Files` |

## Proof of concept results

| Requirement | Evidence | Result |
|---|---|---|
| Robot executes a Browser keyword | PoC under Batteries, system Node not on `PATH` | PASS |
| Compiled TS extension loads into Browser | `Get Form Validation State` under Batteries | PASS |
| Robot discovers and invokes a TS API keyword | `Create API Session`, `Send API Request` via `Remote` | PASS |
| API keyword runs a real request without a browser | `--include api`: 19/19 passed, 0 Browser keywords, no Playwright log | PASS |
| XML-RPC methods match the installed client | `remoteServer.ts` implements every method `robot/libraries/Remote.py` 7.5 calls: `get_library_information`, `get_keyword_names/arguments/types/tags/documentation`, `run_keyword` (+ `stop_remote_server`) | Verified by reading both |
| System Chrome / Edge | `channel=chrome`, `channel=msedge` | PASS |

## Risks and limitations found

1. Windows `MAX_PATH`: browsers installed under a deep venv cannot be launched (reproduced).
   Mitigation: short paths or `PLAYWRIGHT_BROWSERS_PATH`.
2. Two Node runtimes (bundled and system) with independent versions.
3. Remote server is unauthenticated and process-wide; parallel runs need per-worker servers.
4. Robot `[Timeout]` cannot interrupt a remote call (HTTP timeouts bound it instead).
5. Trace redaction protects only configured values and only for orchestrated runs.
6. CI workflow has never run (remote exists, no commits pushed). Switched to Batteries in Phase 2.
7. Offline installation is documented but not executed.

## Gaps against the remaining phases

| Phase | Gap |
|---|---|
| 2 | **Done 2026-10-16:** `.venv`, `requirements*.txt`, README and CI switched to Batteries; edit-user UI added; API returns 409 on duplicate email (was 500); `BROWSER_CHANNEL` config; `env:check` reports the toolchain. |
| 3 | **Done 2026-10-16:** demo pages + 18 web tests for search/filter (keyboard), empty table, headers, CSV download/upload, confirm dialogs, edit/delete, new tab, iframe, phone viewport, focus order, titles; UI-only cleanup verified after a failing test; headed run verified. |
| 4 | **Done 2026-10-16:** 17 new API tests (PUT, all methods/headers/query via echo fixture, retry on 503 for reads only, non-JSON responses, 409, search/role filters); fixed sensitive-field leaks in `Get API Response Field` and `Verify API Response Field` failure messages; libdoc discovery and `stop_remote_server` verified. |
| 5 | **Done 2026-10-16:** Workflow A covers all 13 steps (table + API after update, table/details/API after delete); 2 new consistency tests; random-order full run left only seeded data; cleanup verified after a failing integration test. |
| 6 | **Done 2026-10-16:** remote server rejects browser/DNS-rebinding requests (Origin, Content-Type, Host checks) and non-loopback binding needs opt-in; trace redaction re-verifies each zip, failed redaction exits 255 (verified), redacted trace opened in the trace viewer; `traces:redact` for direct runs; page errors/console captured on failure; sanitized API request logging. |
| 7 | **Done 2026-10-16 except:** tags audited; all selections and orchestrator failure paths verified; output dirs separated; CI improved (tracing input, summary, API no-browser check) and checked locally. **Open:** CI not run on GitHub (repo empty), Ctrl+C not verified (automation could not deliver it), pabot evaluated and not supported. |
| 8 | **Done 2026-10-16:** clean reinstall/build/typecheck, 51 unit tests, full traced run 69/69, API-only 36/36 with no browser process, Edge 29/29, failure demo exit 4, trace + secrets scans clean; README/ADR corrected (API test guide, tag table, next steps). |
