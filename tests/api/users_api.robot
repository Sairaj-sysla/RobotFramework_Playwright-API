*** Settings ***
Documentation       Users REST API, exercised through the TypeScript API keywords (no browser).

Resource            ../../resources/api.resource
Variables           ../../testdata/users.json

Suite Setup         Start API Test Session
Suite Teardown      End API Test Session

Test Tags           api    regression


*** Variables ***
${MISSING_ID}       00000000-0000-4000-8000-000000000000


*** Test Cases ***
Health Endpoint Is Available Without Authentication
    [Tags]    smoke
    API.Create API Session    anonymous    authenticated=False
    API.Send API Request    GET    /health    session=anonymous    expected_status=200
    API.Verify API Response Field    status    ok    session=anonymous
    [Teardown]    API.Close API Session    anonymous

List Users Filters By Email
    [Tags]    smoke
    ${response}=    API.Send API Request    GET    /users    params=${{{'email': $SEEDED_ADMIN['email']}}}
    API.Verify API Status Code    200
    API.Verify API Response Field Type    $    array
    Length Should Be    ${response}[body]    1
    API.Verify API Response Field    0.email    ${SEEDED_ADMIN}[email]
    API.Verify API Response Field    0.role    ${SEEDED_ADMIN}[role]
    API.Verify API Response Field    0.active    true

Create User Returns 201 With The Stored User
    [Tags]    smoke
    ${data}=    API.Generate Test User Data    role=editor
    ${response}=    API.Send API Request    POST    /users    ${data}    expected_status=201
    API.Register Test User For Cleanup    ${response}[body][id]
    API.Verify API Response Field    name    ${data}[name]
    API.Verify API Response Field    email    ${data}[email]
    API.Verify API Response Field    role    editor
    API.Verify API Response Field    active    ${True}
    API.Verify API Response Field Type    id    string
    API.Verify API Response Field Type    createdAt    string
    Should End With    ${response}[headers][location]    /api/users/${response}[body][id]

Get User By Id Returns The Created User
    ${created}=    API.Create Test User    role=viewer
    ${fetched}=    API.Get User By ID    ${created}[id]
    Dictionaries Should Be Equal    ${created}    ${fetched}

Patch Updates Only The Given Fields
    ${created}=    API.Create Test User
    ${updated}=    API.Update Test User    ${created}[id]    ${{{'role': 'admin', 'active': False}}}
    User Should Have Values    ${updated}
    ...    role=admin    active=False    name=${created}[name]    email=${created}[email]
    ${stored}=    API.Get User By ID    ${created}[id]
    Dictionaries Should Be Equal    ${updated}    ${stored}

Deleted User Is No Longer Found
    ${created}=    API.Create Test User
    API.Delete Test User    ${created}[id]
    API.Send API Request    GET    /users/${created}[id]    expected_status=404
    API.Verify API Response Field    error    User ${created}[id] not found

Missing User Returns 404
    [Tags]    smoke
    API.Send API Request    GET    /users/${MISSING_ID}
    API.Verify API Status Code    404
    ${status}=    API.Get API Response Status
    Should Be Equal    ${status}    ${404}

Invalid Payloads Are Rejected With 400 And Details
    FOR    ${case}    IN    @{INVALID_USER_PAYLOADS}
        API.Send API Request    POST    /users    ${case}[body]    expected_status=400
        ${details}=    API.Get API Response Field    details
        Should Contain    ${details}    ${case}[error]
        ...    msg=Case '${case}[description]': expected '${case}[error]' in ${details}
    END

Malformed JSON Request Body Is Rejected With 400
    API.Send API Request    POST    /users    {"name": "broken"    expected_status=400
    API.Verify API Response Field    error    Request body is not valid JSON

Requests Without A Token Are Rejected With 401
    [Tags]    security
    API.Create API Session    anonymous    authenticated=False
    API.Send API Request    GET    /users    session=anonymous
    API.Verify API Status Code    401    session=anonymous
    API.Verify API Response Field    error    Missing or invalid bearer token    session=anonymous
    [Teardown]    API.Close API Session    anonymous

Unexpected Status Fails With A Clear Application Error
    [Tags]    error-handling
    ${message}=    Run Keyword And Expect Error    *
    ...    API.Send API Request    GET    /users/${MISSING_ID}    expected_status=200
    Should Start With    ${message}    [APPLICATION] Expected HTTP 200 but got 404 Not Found for GET
    Should Contain    ${message}    User ${MISSING_ID} not found

Authentication Failure Includes A Configuration Hint
    [Tags]    error-handling    security
    API.Create API Session    anonymous    authenticated=False
    ${message}=    Run Keyword And Expect Error    *
    ...    API.Send API Request    GET    /users    session=anonymous    expected_status=200
    Should Contain    ${message}    got 401
    Should Contain    ${message}    check API_TOKEN
    [Teardown]    API.Close API Session    anonymous

Server Error Is Reported As An Application Failure
    [Tags]    error-handling
    ${message}=    Run Keyword And Expect Error    *
    ...    API.Send API Request    GET    /test-fixtures/server-error    expected_status=200
    Should Start With    ${message}    [APPLICATION] Expected HTTP 200 but got 500
    Should Contain    ${message}    Simulated internal server error

Invalid JSON Response Is Reported
    [Tags]    error-handling
    ${message}=    Run Keyword And Expect Error    *
    ...    API.Send API Request    GET    /test-fixtures/invalid-json
    Should Start With    ${message}    [APPLICATION]
    Should Contain    ${message}    invalid JSON body

Slow Response Fails With A Bounded Timeout
    [Tags]    error-handling
    ${message}=    Run Keyword And Expect Error    *
    ...    API.Send API Request    GET    /test-fixtures/slow    params=${{{'delayMs': 2000}}}    timeout_ms=300
    Should Start With    ${message}    [API] GET
    Should Contain    ${message}    did not respond within 300 ms

Missing Response Field Lists Available Fields
    [Tags]    error-handling
    API.Send API Request    GET    /health    expected_status=200
    ${message}=    Run Keyword And Expect Error    *    API.Get API Response Field    data.id
    Should Be Equal    ${message}
    ...    [APPLICATION] Field 'data' not found. Available fields: status in response of GET %{API_BASE_URL}/health.

Wrong Field Type Is Reported
    [Tags]    error-handling
    API.Send API Request    GET    /health    expected_status=200
    Run Keyword And Expect Error    EQUALS:[APPLICATION] Field 'status' should be integer but was string.
    ...    API.Verify API Response Field Type    status    integer

Connection Failure Is Reported As An Environment Problem
    [Tags]    error-handling
    API.Create API Session    offline    base_url=http://127.0.0.1:9/api    timeout_ms=2000
    ${message}=    Run Keyword And Expect Error    *
    ...    API.Send API Request    GET    /users    session=offline
    Should Start With    ${message}    [ENVIRONMENT] Could not connect for GET http://127.0.0.1:9/api/users
    [Teardown]    API.Close API Session    offline

Cleanup Refuses To Delete Users It Did Not Create
    [Tags]    security
    ${response}=    API.Send API Request    GET    /users    params=${{{'email': $SEEDED_ADMIN['email']}}}
    ${seeded_id}=    Set Variable    ${response}[body][0][id]
    Run Keyword And Expect Error    STARTS:[TEST DATA] Refusing to delete user
    ...    API.Delete Test User    ${seeded_id}
    API.Get User By ID    ${seeded_id}
