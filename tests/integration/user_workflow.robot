*** Settings ***
Documentation       End-to-end user workflows that cross the API and the UI of the same application:
...                 data created on one side must be visible and persisted on the other.

Resource            ../../resources/web.resource
Resource            ../../resources/api.resource

Suite Setup         Start Integration Suite
Suite Teardown      End Integration Suite
Test Setup          Open Fresh Application Context
Test Teardown       API.Delete Created Test Users

Test Tags           integration    regression


*** Test Cases ***
User Created Through The API Is Shown, Updated And Removed In The UI
    [Tags]    smoke
    # 1. Create through the TypeScript API client and capture the id
    ${user}=    API.Create Test User    role=editor
    # 2-3. Open the UI and find the record in the asynchronously loaded table
    Login With Configured Credentials
    ${rows}=    Read Users Table
    ${row}=    Find Row By Column Value    ${rows}    Email    ${user}[email]
    Dictionary Should Contain Values    ${row}
    ...    ${{{'Name': $user['name'], 'Role': 'editor', 'Status': 'Active'}}}    context=Users table row
    # 4-5. Navigate to the record and verify the displayed values
    ${link}=    Get Element By Role    link    name=${user}[name]    exact=True
    Click    ${link}
    Get Url    $=    /users/${user}[id]
    ${shown}=    Read User Detail Page
    User Should Have Values    ${shown}
    ...    id=${user}[id]    name=${user}[name]    email=${user}[email]    role=editor    status=Active
    # 6-7. Verify the persisted record through the API
    ${stored}=    API.Get User By ID    ${user}[id]
    Dictionaries Should Be Equal    ${stored}    ${user}
    # An API update is reflected in the UI
    API.Update Test User    ${user}[id]    ${{{'role': 'admin', 'active': False}}}
    Reload
    Get Text    data-testid=user-role    ==    admin
    Get Text    data-testid=user-status    ==    Inactive
    # 8. Clean up through the API and confirm the UI no longer shows the record
    API.Delete Test User    ${user}[id]
    Reload
    Get Text    data-testid=not-found    ==    User not found.
    API.Send API Request    GET    /users/${user}[id]    expected_status=404

User Created Through The UI Is Persisted In The API
    ${data}=    API.Generate Test User Data    role=admin
    Login With Configured Credentials
    Go To Application Page    /users/new
    Fill New User Form    ${data}[name]    ${data}[email]    role=admin    active=${False}
    Submit New User Form
    Get Text    data-testid=user-notice    ==    User created.
    ${shown}=    Read User Detail Page
    API.Register Test User For Cleanup    ${shown}[id]
    User Should Have Values    ${shown}    name=${data}[name]    email=${data}[email]    role=admin    status=Inactive
    ${stored}=    API.Get User By ID    ${shown}[id]
    User Should Have Values    ${stored}    name=${data}[name]    email=${data}[email]    role=admin    active=False
    ${response}=    API.Send API Request    GET    /users    params=${{{'email': $data['email']}}}    expected_status=200
    Length Should Be    ${response}[body]    1


*** Keywords ***
Start Integration Suite
    Start API Test Session
    Open Application Browser

End Integration Suite
    Close Application Browser
    End API Test Session
