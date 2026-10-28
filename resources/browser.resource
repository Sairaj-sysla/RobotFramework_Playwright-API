*** Settings ***
Documentation       Browser (Playwright) lifecycle and failure diagnostics shared by every web suite,
...                 independent of the application under test. Page resources (e.g.
...                 ``projectbase_login.resource``) import this file and add only their locators and
...                 page keywords.
...
...                 The custom TypeScript keywords ``Get Table Rows As Dicts`` and
...                 ``Get Form Validation State`` are loaded from the compiled extension in dist/ (run
...                 ``npm run build`` first; the npm scripts do this).

Library             Browser
...                     jsextension=${CURDIR}/../dist/src/playwright/browserKeywords.js
...                     run_on_failure=Capture Browser Failure Diagnostics
Resource            configuration.resource


*** Keywords ***
Open Application Browser
    [Documentation]    Suite setup: validates the environment variables the suite needs
    ...    (``required_config``) and starts one browser for the suite. ``BROWSER_CHANNEL`` (e.g.
    ...    ``chrome``, ``msedge``) runs an installed system browser instead of Playwright's Chromium.
    [Arguments]    @{required_config}
    Validate Required Configuration    @{required_config}
    Set Browser Timeout    ${BROWSER_TIMEOUT}
    New Browser    ${BROWSER}    headless=${HEADLESS}    channel=${{ $BROWSER_CHANNEL or None }}

Open Fresh Application Context
    [Documentation]    Test setup: isolated context (cookies, storage) per test so tests never depend
    ...    on each other. The context is closed automatically at the end of the test.
    New Context    baseURL=${{ $BASE_URL or None }}    viewport={'width': 1280, 'height': 800}    tracing=${BROWSER_TRACING}
    New Page    about:blank

Close Application Browser
    [Documentation]    Suite teardown: closes every browser, context and page, even after failures.
    Close Browser    ALL

Capture Browser Failure Diagnostics
    [Documentation]    Runs automatically when a Browser keyword fails (``run_on_failure``): embeds a
    ...    screenshot and logs URL, title, page errors and console errors. Never fails itself.
    Run Keyword And Ignore Error    Take Screenshot    failure-{index}
    ${status}    ${url}=    Run Keyword And Ignore Error    Get Url
    ${status}    ${title}=    Run Keyword And Ignore Error    Get Title
    Log    [DIAGNOSTICS] Page at failure: url=${url} title=${title}    WARN
    ${status}    ${errors}=    Run Keyword And Ignore Error    Get Page Errors
    IF    $status == 'PASS' and $errors    Log    [DIAGNOSTICS] Page errors: ${errors}    WARN
    ${status}    ${console}=    Run Keyword And Ignore Error    Get Console Log
    IF    $status == 'PASS' and $console    Log    [DIAGNOSTICS] Console log: ${console}
