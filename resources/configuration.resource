*** Settings ***
Documentation       Framework configuration, read from environment variables.
...
...                 The TypeScript orchestrator (`npm test`, `npm run robot -- ...`) loads `.env`,
...                 validates every value (see src/config/environmentConfig.ts) and passes the
...                 environment to Robot Framework. Secrets (API_TOKEN, APP_PASSWORD) are not read
...                 into Robot variables: the API token stays in the remote server and the password
...                 is typed with `Fill Secret    ...    %APP_PASSWORD`.


*** Variables ***
${BASE_URL}                 %{BASE_URL=}
${API_BASE_URL}             %{API_BASE_URL=}
${APP_USERNAME}             %{APP_USERNAME=}
${BROWSER}                  %{BROWSER=chromium}
${HEADLESS}                 %{HEADLESS=true}
${BROWSER_TIMEOUT}          %{BROWSER_TIMEOUT_MS=10000} ms
${NAVIGATION_TIMEOUT}       %{NAVIGATION_TIMEOUT_MS=15000} ms
${BROWSER_TRACING}          %{BROWSER_TRACING=false}
${REMOTE_URI}               http://%{REMOTE_HOST=127.0.0.1}:%{REMOTE_PORT=8270}


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
