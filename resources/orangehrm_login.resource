*** Settings ***
Documentation       OrangeHRM login page – Robot Framework version of the TypeScript ``Orange`` locators
...               
...                 page load and the post-login Admin element (``timeouts.navigation``/``timeouts.wait``),
...                 ``BROWSER_TIMEOUT_MS`` for element actions (``timeouts.action``).

Resource            browser.resource
Library             ../libraries/ExcelTestData.py


*** Variables ***
# Locators from Orange.ts. Two were corrected after checking the live OrangeHRM demo on 2026-10-19:
#   username: original //*[@placeholder=''] matched nothing; the input's placeholder is 'Username'.
#   admin:    original //*[text()='admin'] matched nothing; the 'Admin' menu item reads 'Admin'.
${ORANGE_USERNAME_INPUT}        xpath=//*[@placeholder='Username']
${ORANGE_PASSWORD_INPUT}        xpath=//*[@placeholder='Password']
${ORANGE_LOGIN_BUTTON}          xpath=//*[@type='submit']
${ORANGE_ADMIN}                 xpath=//*[text()='Admin']
# Worksheet with the login rows (headers: TestCaseID | Username | Password).
${ORANGE_LOGIN_SHEET}           LoginTestData


*** Keywords ***
Resolve Application URL
    [Documentation]    ``configManager.getEasyURL() ?? configManager.getBaseURL()``: ``EASY_URL`` when it
    ...    is set, otherwise ``BASE_URL``.
    VAR    ${url}    ${{ $EASY_URL or $BASE_URL }}
    IF    not $url
        Fail    [CONFIGURATION] Neither EASY_URL nor BASE_URL is set. Set EASY_URL to the OrangeHRM login page (see .env.example).
    END
    RETURN    ${url}

Open Application
    [Documentation]    ``basePage.navigateTo(url)``: opens the resolved URL and waits for the ``load``
    ...    event within the navigation timeout.
    ${url}=    Resolve Application URL
    Log    Navigate to OrangeHRM: ${url}
    Go To    ${url}    timeout=${NAVIGATION_TIMEOUT}    wait_until=load
    Log    Navigated to ${url}

Enter Login Credentials
    [Documentation]    Fills the username and password from a test-data row (``Get Test Data By Row``).
    ...    The password is a ``Secret`` and typed with ``Fill Secret``, so it is never logged.
    [Arguments]    ${data}
    Log    Login as: ${data}[Username]
    Fill Text    ${ORANGE_USERNAME_INPUT}    ${data}[Username]
    Fill Secret    ${ORANGE_PASSWORD_INPUT}    ${data}[Password]

Submit Login Form
    [Documentation]    Clicks the LOGIN (submit) button.
    Click    ${ORANGE_LOGIN_BUTTON}
    Log    LOGIN clicked

Verify Successful Login
    [Documentation]    ``waitForElementIsVisible(el.admin)`` and ``storeText(el.admin, key)``: waits for
    ...    the Admin element, reads its trimmed text (first match, as ``.first()`` did) and stores it
    ...    as the suite variable named by ``store_as`` (e.g. ``${LoggedInUser}``). Returns the text.
    ...    The wait uses the navigation timeout: the element appears only after the post-login page
    ...    has rendered, which can take longer than an element action on the OrangeHRM demo.
    [Arguments]    ${store_as}=LoggedInUser
    Wait For Elements State    ${ORANGE_ADMIN} >> nth=0    visible    timeout=${NAVIGATION_TIMEOUT}
    ...    message=[APPLICATION] Login was not successful: Admin element (${ORANGE_ADMIN}) is not visible.
    ${text}=    Get Text    ${ORANGE_ADMIN} >> nth=0
    ${text}=    Evaluate    $text.strip()
    Set Suite Variable    \${${store_as}}    ${text}
    Log    Stored ${store_as} = '${text}'
    RETURN    ${text}
