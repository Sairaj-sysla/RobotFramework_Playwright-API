*** Settings ***
Documentation       Browser (Playwright) layer: lifecycle, navigation, login and failure diagnostics.
...
...                 Standard interactions use Browser library keywords directly. The custom TypeScript
...                 keywords ``Get Table Rows As Dicts`` and ``Get Form Validation State`` are loaded
...                 from the compiled extension in dist/ (run ``npm run build`` first).
...
...                 Locator preference: accessible role/label (``Get Element By Role``/``Get Element By``),
...                 then ``data-testid=...``, then ``id=...``. CSS/XPath only when nothing else exists.

Library             Browser
...                     jsextension=${CURDIR}/../dist/src/playwright/browserKeywords.js
...                     run_on_failure=Capture Browser Failure Diagnostics
Resource            configuration.resource


*** Keywords ***
# ---------------------------------------------------------------- lifecycle

Open Application Browser
    [Documentation]    Suite setup: validates configuration and starts one browser for the suite.
    Validate Required Configuration    BASE_URL    APP_USERNAME    APP_PASSWORD
    Set Browser Timeout    ${BROWSER_TIMEOUT}
    New Browser    ${BROWSER}    headless=${HEADLESS}

Open Fresh Application Context
    [Documentation]    Test setup: isolated context (cookies, storage) per test so tests never depend
    ...    on each other. The context is closed automatically at the end of the test.
    New Context    baseURL=${BASE_URL}    viewport={'width': 1280, 'height': 800}    tracing=${BROWSER_TRACING}
    New Page    about:blank

Close Application Browser
    [Documentation]    Suite teardown: closes every browser, context and page, even after failures.
    Close Browser    ALL

Go To Application Page
    [Documentation]    Navigates to a path relative to BASE_URL and waits for the load event.
    [Arguments]    ${path}
    Go To    ${BASE_URL}${path}    timeout=${NAVIGATION_TIMEOUT}

# ---------------------------------------------------------------- login

Open Login Page
    Go To Application Page    /login
    Heading Should Be Visible    Sign in

Submit Login Form
    [Documentation]    Fills the login form. ``password_env`` names an environment variable, so the
    ...    password is typed with Fill Secret and never written to the Robot log.
    [Arguments]    ${username}    ${password_env}=APP_PASSWORD
    ${username_field}=    Get Element By    Label    Username    exact=True
    ${password_field}=    Get Element By    Label    Password    exact=True
    Fill Text    ${username_field}    ${username}
    IF    $password_env    Fill Secret    ${password_field}    %${password_env}
    ${sign_in}=    Get Element By Role    button    name=Sign in    exact=True
    Click    ${sign_in}

Login With Configured Credentials
    Open Login Page
    Submit Login Form    ${APP_USERNAME}
    Wait For Users Table

Login Error Should Be
    [Arguments]    ${expected}
    Get Text    data-testid=login-error    ==    ${expected}

# ---------------------------------------------------------------- application pages

Heading Should Be Visible
    [Documentation]    Waits until the page's level-1 heading with the given accessible name is visible.
    [Arguments]    ${name}
    ${heading}=    Get Element By Role    heading    name=${name}    level=1    exact=True
    Wait For Elements State    ${heading}    visible

Wait For Users Table
    [Documentation]    The users table renders asynchronously. Waits for the real UI state (table
    ...    visible, loading indicator gone) instead of sleeping.
    Wait For Elements State    data-testid=users-table    visible    timeout=${NAVIGATION_TIMEOUT}
    Wait For Elements State    data-testid=users-loading    detached
    Get Url    $=    /users

Read Users Table
    [Documentation]    Returns the users table rows as dictionaries (custom TypeScript keyword).
    Wait For Users Table
    ${rows}=    Get Table Rows As Dicts    data-testid=users-table
    RETURN    ${rows}

Open User Detail Page
    [Arguments]    ${user_id}
    Go To Application Page    /users/${user_id}
    Wait For Elements State    data-testid=user-heading    visible

Read User Detail Page
    [Documentation]    Returns the user shown on the detail page as a dictionary of strings.
    ${id}=    Get Text    data-testid=user-id
    ${name}=    Get Text    data-testid=user-heading
    ${email}=    Get Text    data-testid=user-email
    ${role}=    Get Text    data-testid=user-role
    ${status}=    Get Text    data-testid=user-status
    ${user}=    Create Dictionary    id=${id}    name=${name}    email=${email}    role=${role}    status=${status}
    RETURN    ${user}

Fill New User Form
    [Documentation]    Fills the new-user form: text fields, a dropdown, a radio group and a checkbox.
    [Arguments]    ${name}    ${email}    ${role}=viewer    ${active}=${True}    ${confirm}=${True}
    ${name_field}=    Get Element By    Label    Full name    exact=True
    ${email_field}=    Get Element By    Label    Email    exact=True
    Fill Text    ${name_field}    ${name}
    Fill Text    ${email_field}    ${email}
    Select Options By    id=role    value    ${role}
    ${status}=    Set Variable If    ${active}    Active    Inactive
    ${radio}=    Get Element By Role    radio    name=${status}    exact=True
    Check Checkbox    ${radio}
    ${confirm_box}=    Get Element By Role    checkbox    name=I confirm this is test data
    IF    ${confirm}    Check Checkbox    ${confirm_box}    ELSE    Uncheck Checkbox    ${confirm_box}

Submit New User Form
    ${create}=    Get Element By Role    button    name=Create user    exact=True
    Click    ${create}

# ---------------------------------------------------------------- diagnostics

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
