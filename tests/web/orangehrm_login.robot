*** Settings ***
Documentation       Basic OrangeHRM login test (test id REG_TS_or_TC01) in a visible Chromium browser.
...
...                 Credentials come from environment variables (never written in this file):
...                 ORANGE_USERNAME and ORANGE_PASSWORD.
...
...                 Run from the project root:    robot --outputdir results tests/web/orangehrm_login.robot

Library             Browser

Test Tags           web    orangehrm    regression    smoke    REG_TS_or_TC01


*** Variables ***
${BASE_URL}         https://opensource-demo.orangehrmlive.com/web/index.php/auth/login
${USERNAME}         xpath=//*[@placeholder='Username']
${PASSWORD}         xpath=//*[@placeholder='Password']
${LOGIN_BUTTON}     xpath=//*[@type='submit']
${ADMIN}            xpath=//*[text()='Admin']
${TIMEOUT}          15s
# Visible browser by default; run headless with:  --variable HEADLESS:True
${HEADLESS}         ${FALSE}


*** Test Cases ***
Login To OrangeHRM
    [Documentation]    Logs in to OrangeHRM and checks that the Admin menu is shown.
    # 1. Open a Chromium browser (visible unless HEADLESS is set to True)
    Set Browser Timeout    ${TIMEOUT}
    New Browser    chromium    headless=${HEADLESS}
    # 2. Open the OrangeHRM login page
    New Page    ${BASE_URL}
    # 3-5. Check the login form
    Wait For Elements State    ${USERNAME}    visible
    Wait For Elements State    ${PASSWORD}    visible
    Wait For Elements State    ${LOGIN_BUTTON}    enabled
    # 6-8. Log in (Fill Secret reads the password from the environment and never logs it)
    Fill Text    ${USERNAME}    %{ORANGE_USERNAME}
    Fill Secret    ${PASSWORD}    %ORANGE_PASSWORD
    Click    ${LOGIN_BUTTON}
    # 9-10. Check that the login worked
    Wait For Elements State    ${ADMIN}    visible
    Log    Login successful: Admin menu is visible
    [Teardown]    Close Browser
