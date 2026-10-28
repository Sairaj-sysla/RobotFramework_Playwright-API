*** Settings ***
Documentation       Deliberately failing tests that demonstrate failure diagnostics and a non-zero
...                 exit code. Excluded from normal runs; run with `npm run test:failure-demo`.

Resource            ../../resources/web.resource
Resource            ../../resources/api.resource

Suite Setup         Start Diagnostics Suite
Suite Teardown      End Diagnostics Suite
Test Setup          Open Fresh Application Context

Test Tags           intentional-failure


*** Test Cases ***
Locator Failure Captures Browser Diagnostics
    [Documentation]    Expected to fail: element does not exist. The log shows an [AUTOMATION]-style
    ...    Playwright timeout, a screenshot, and the page URL/title captured by run_on_failure.
    Login With Configured Credentials
    Click    data-testid=button-that-does-not-exist

UI Assertion Failure Shows Expected And Actual
    [Documentation]    Expected to fail: wrong expected heading text.
    Login With Configured Credentials
    Get Text    h1    ==    Dashboard

API Unexpected Status Shows Sanitized Response
    [Documentation]    Expected to fail: the user does not exist, so the API returns 404, not 200.
    [Setup]    NONE
    API.Send API Request    GET    /users/no-such-user    expected_status=200


*** Keywords ***
Start Diagnostics Suite
    Start API Test Session
    Open Application Browser
    Set Browser Timeout    2 s

End Diagnostics Suite
    Close Application Browser
    End API Test Session
