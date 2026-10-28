*** Settings ***
Documentation       Framework configuration, read from environment variables.
...
...                 The TypeScript orchestrator (`npm test`, `npm run robot -- ...`) loads `.env`
...                 (and `.env.<profile>` with `--env <profile>`), validates every value (see
...                 src/config/environmentConfig.ts) and passes the environment to Robot Framework.
...                 The secret APP_PASSWORD is not read into a Robot variable: it is typed with
...                 `Fill Secret    ...    %APP_PASSWORD`. Passwords read from Excel are Secret objects.
...                 Each suite validates the variables it needs in its suite setup.
...
...                 Timeouts: ``BROWSER_TIMEOUT`` for element waits and actions (set as the Browser
...                 default timeout), ``NAVIGATION_TIMEOUT`` for page loads and the post-login header.


*** Variables ***
${BASE_URL}                 %{BASE_URL=}
# OrangeHRM suite: login page (getEasyURL(); falls back to BASE_URL) and the Excel workbook with the login rows.
${EASY_URL}                 %{EASY_URL=}
${ORANGE_LOGIN_WORKBOOK}    %{ORANGE_LOGIN_WORKBOOK=}
${APP_USERNAME}             %{APP_USERNAME=}
${BROWSER}                  %{BROWSER=chromium}
${BROWSER_CHANNEL}          %{BROWSER_CHANNEL=}
${HEADLESS}                 %{HEADLESS=true}
${BROWSER_TIMEOUT}          %{BROWSER_TIMEOUT_MS=10000} ms
${NAVIGATION_TIMEOUT}       %{NAVIGATION_TIMEOUT_MS=30000} ms
${BROWSER_TRACING}          %{BROWSER_TRACING=false}


*** Keywords ***
Validate Required Configuration
    [Documentation]    Fails fast with a CONFIGURATION error if required variables are missing.
    ...    Values are checked inside an expression and never assigned to a variable, because
    ...    Robot logs assigned values and some of these variables are secrets.
    [Arguments]    @{names}
    FOR    ${name}    IN    @{names}
        IF    not os.environ.get($name, '').strip()
            Fail    [CONFIGURATION] Environment variable ${name} is not set. Run tests through the npm scripts (they load .env) or export it. See .env.example.
        END
    END
