*** Settings ***
Documentation       ProjectBase login page – Robot Framework version of the TypeScript ``LoginPage``
...                 page object.
...
...                 | *LoginPage.ts*              | *Keyword(s)*                                                |
...                 | ``navigateTo()``            | `Open Application`                                          |
...                 | ``validateUI()``            | `Validate Login UI`                                         |
...                 | ``login()``                 | `Enter Login Credentials`, `Submit Login Form`, `Verify Successful Login` |
...                 | reload fallback in ``login()`` | `Reload And Retry Login Verification`                   |
...                 | ``verifyLoginSuccessful()`` | `Verify Successful Login`                                   |
...
...                 ``BasePage``/``WaitUtils``/``ErrorHandler``/``logger``/``configManager`` map to
...                 Browser's state-based waits, ``browser.resource`` (browser lifecycle and failure
...                 diagnostics: screenshot, URL, title, page errors, console) and the framework's
...                 configuration (``BASE_URL``, ``APP_USERNAME``, ``APP_PASSWORD``,
...                 ``NAVIGATION_TIMEOUT_MS`` – the counterpart of ``Global_Timeout`` – and
...                 ``BROWSER_TIMEOUT_MS`` for element waits), loaded from the ``projectbase``
...                 environment profile.
...
...                 The password is typed with ``Fill Secret`` from an environment variable and is
...                 never stored in a Robot variable or logged.

Resource            browser.resource


*** Variables ***
# Locators from LoginPage.ts, unchanged (Browser treats the xpath= prefix as XPath).
${PB_USERNAME_INPUT}        xpath=//input[@type="email"]
${PB_PASSWORD_INPUT}        xpath=//input[@type="password"]
${PB_LOGIN_BUTTON}          xpath=//button[normalize-space()="LOGIN"]
${PB_HEADER}                xpath=//span[normalize-space()="ProjectBase 2.0"]


*** Keywords ***
Open Application
    [Documentation]    ``navigateTo()``: opens ``BASE_URL``, waiting for ``domcontentloaded`` within the
    ...    navigation timeout, then checks that the page is on the expected domain (the host of
    ...    ``BASE_URL``). A redirect to another domain (e.g. single sign-on) fails here.
    Log    Opening ProjectBase: ${BASE_URL}
    Go To    ${BASE_URL}    timeout=${NAVIGATION_TIMEOUT}    wait_until=domcontentloaded
    ${expected_host}=    Evaluate    urllib.parse.urlsplit($BASE_URL).hostname
    Get Url    contains    ${expected_host}
    ...    message=[APPLICATION] Expected to stay on ${expected_host} after opening ${BASE_URL}, but the page is on {value}.
    Log    Application opened on ${expected_host}

Validate Login UI
    [Documentation]    ``validateUI()``: username and password inputs are visible and the LOGIN button
    ...    is visible and enabled. Each wait uses the element timeout (``BROWSER_TIMEOUT_MS``).
    Wait For Elements State    ${PB_USERNAME_INPUT}    visible
    ...    message=[APPLICATION] Username input (${PB_USERNAME_INPUT}) is not visible.
    Wait For Elements State    ${PB_PASSWORD_INPUT}    visible
    ...    message=[APPLICATION] Password input (${PB_PASSWORD_INPUT}) is not visible.
    Wait For Elements State    ${PB_LOGIN_BUTTON}    visible
    ...    message=[APPLICATION] LOGIN button (${PB_LOGIN_BUTTON}) is not visible.
    Wait For Elements State    ${PB_LOGIN_BUTTON}    enabled
    ...    message=[APPLICATION] LOGIN button (${PB_LOGIN_BUTTON}) is visible but not enabled.
    Log    Login UI validated: username and password inputs visible, LOGIN button visible and enabled

Enter Login Credentials
    [Documentation]    Enters ``username`` and the password from the environment variable named by
    ...    ``password_env``. The password is typed with ``Fill Secret``, so its value never appears
    ...    in the log, report or failure messages.
    [Arguments]    ${username}=${APP_USERNAME}    ${password_env}=APP_PASSWORD
    Fill Text    ${PB_USERNAME_INPUT}    ${username}
    Fill Secret    ${PB_PASSWORD_INPUT}    %${password_env}
    Log    Credentials entered for ${username} (password from environment variable ${password_env}, not logged)

Submit Login Form
    [Documentation]    Clicks LOGIN once.
    Click    ${PB_LOGIN_BUTTON}
    Log    LOGIN clicked

Verify Successful Login
    [Documentation]    ``verifyLoginSuccessful()``: waits up to the navigation timeout for the
    ...    ``ProjectBase 2.0`` header. If it does not appear, the page is reloaded and the check is
    ...    repeated exactly once (`Reload And Retry Login Verification`), as in ``LoginPage.login()``.
    ...    The login form is never submitted again.
    TRY
        Wait For Elements State    ${PB_HEADER}    visible    timeout=${NAVIGATION_TIMEOUT}
        ...    message=[APPLICATION] 'ProjectBase 2.0' header (${PB_HEADER}) not visible within ${NAVIGATION_TIMEOUT} after login.
    EXCEPT    AS    ${first_error}
        Log    First login verification failed: ${first_error}    WARN
        Reload And Retry Login Verification
    END
    ${url}=    Get Url
    Log    Login successful: 'ProjectBase 2.0' header visible at ${url}

Reload And Retry Login Verification
    [Documentation]    Reloads the page once and waits again for the ``ProjectBase 2.0`` header. This
    ...    only helps when the login already succeeded but the page did not finish rendering (the
    ...    session survives the reload); a rejected login still fails here, with a message that says
    ...    the reload was tried. Credentials are not entered again.
    Log    Reloading the page and retrying the login verification once (credentials are not re-entered)    WARN
    Reload    timeout=${NAVIGATION_TIMEOUT}    waitUntil=domcontentloaded
    Wait For Elements State    ${PB_HEADER}    visible    timeout=${NAVIGATION_TIMEOUT}
    ...    message=[APPLICATION] Login verification failed: 'ProjectBase 2.0' header (${PB_HEADER}) not visible after login, and still not visible after one page reload. Check the credentials and the post-login page.
    Log    Login verification succeeded after the page reload
