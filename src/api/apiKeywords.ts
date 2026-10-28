/**
 * Robot Framework API keywords served by the TypeScript remote server.
 *
 * State lives in named sessions inside the server process. Each session tracks
 * the records it created so cleanup only ever deletes the test's own data.
 */
import type { FrameworkConfig } from '../config/environmentConfig.js';
import type { KeywordContext, KeywordDefinition, KeywordParam } from '../remote/keywordLibrary.js';
import { buildUser, isUserRole } from '../testdata/testDataFactory.js';
import { ErrorCategory, FrameworkError, TestDataError } from '../utils/errorHandler.js';
import { FieldNotFoundError, getByPath, jsonType, matchesJsonType, valuesMatch } from '../utils/fieldPath.js';
import type { Logger } from '../utils/logger.js';
import { previewBody, sanitizeBody, sanitizeHeaders } from '../utils/sanitize.js';
import { ApiClient } from './apiClient.js';
import { ApiConnectionError, ApiStatusError } from './apiErrors.js';
import { parseHttpMethod, parseUser, type ApiResponse, type JsonValue, type QueryParams } from './apiTypes.js';

interface Session {
  alias: string;
  client: ApiClient;
  lastResponse?: ApiResponse;
  createdUserIds: Set<string>;
}

const USERS_PATH = '/users';
const SESSION: KeywordParam = { name: 'session', default: 'default', namedOnly: true, type: 'str' };

export function createApiKeywords(config: FrameworkConfig, logger: Logger): KeywordDefinition[] {
  const sessions = new Map<string, Session>();

  const getSession = (alias: unknown): Session => {
    const name = String(alias || 'default');
    const session = sessions.get(name);
    if (!session) {
      throw new FrameworkError(ErrorCategory.Automation, `API session '${name}' does not exist. Call 'Create API Session' first (open sessions: ${[...sessions.keys()].join(', ') || 'none'}).`);
    }
    return session;
  };

  const lastResponse = (session: Session): ApiResponse => {
    if (!session.lastResponse) {
      throw new FrameworkError(ErrorCategory.Automation, `API session '${session.alias}' has no response yet. Send a request first.`);
    }
    return session.lastResponse;
  };

  const record = (session: Session, response: ApiResponse, ctx: KeywordContext) => {
    session.lastResponse = response;
    ctx.log(`${response.method} ${response.url} -> ${response.status} ${response.statusText} (${response.durationMs} ms)`);
    ctx.log(`Response body: ${previewBody(response.body, 2000)}`, 'DEBUG');
  };

  /** Calls the API, always recording the response (also when the status check fails). */
  const call = async (session: Session, ctx: KeywordContext, req: Parameters<ApiClient['request']>[0]): Promise<ApiResponse> => {
    try {
      const response = await session.client.request(req);
      record(session, response, ctx);
      return response;
    } catch (error) {
      if (error instanceof ApiStatusError) record(session, error.response as ApiResponse, ctx);
      throw error;
    }
  };

  const toRobotResponse = (response: ApiResponse) => ({
    status: response.status,
    reason: response.statusText,
    headers: sanitizeHeaders(response.headers),
    body: sanitizeBody(response.body),
    elapsed_ms: response.durationMs,
    url: response.url,
  });

  const userPath = (userId: unknown) => {
    const id = String(userId ?? '').trim();
    if (!id) throw new TestDataError('A user id is required.');
    return `${USERS_PATH}/${encodeURIComponent(id)}`;
  };

  const optionalDict = (value: unknown, name: string): Record<string, unknown> | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new FrameworkError(ErrorCategory.Automation, `'${name}' must be a dictionary, got ${jsonType(value)}.`);
    }
    return value as Record<string, unknown>;
  };

  return [
    {
      name: 'Create API Session',
      doc: `Creates (or replaces) a named API session.

The bearer token is read from \`API_TOKEN\` on the server side, so it never appears in Robot logs.
Set \`authenticated=False\` to send requests without credentials. \`base_url\` defaults to \`API_BASE_URL\`.
Records tracked for cleanup by a replaced session are carried over. Returns the alias.`,
      params: [
        { name: 'alias', default: 'default', type: 'str' },
        { name: 'base_url', default: null, type: 'str | None' },
        { name: 'authenticated', default: true, type: 'bool' },
        { name: 'timeout_ms', default: null, type: 'int | None' },
      ],
      run: ({ alias, base_url, authenticated, timeout_ms }, ctx) => {
        const name = String(alias || 'default');
        const baseUrl = (base_url as string | null) ?? config.apiBaseUrl;
        const previous = sessions.get(name);
        sessions.set(name, {
          alias: name,
          client: new ApiClient({
            baseUrl,
            token: authenticated ? config.apiToken : undefined,
            timeoutMs: (timeout_ms as number | null) ?? config.apiTimeoutMs,
            retries: config.apiRetries,
            logger,
          }),
          createdUserIds: previous?.createdUserIds ?? new Set(),
        });
        ctx.log(`API session '${name}' -> ${baseUrl} (authenticated: ${Boolean(authenticated)}, timeout: ${(timeout_ms as number | null) ?? config.apiTimeoutMs} ms)`);
        return name;
      },
    },
    {
      name: 'Close API Session',
      doc: 'Closes a session. Logs a warning if it still tracks records that were not cleaned up.',
      params: [{ name: 'alias', default: 'default', type: 'str' }],
      run: ({ alias }, ctx) => {
        const name = String(alias || 'default');
        const session = sessions.get(name);
        if (session?.createdUserIds.size) {
          ctx.log(`Session '${name}' closed with ${session.createdUserIds.size} test user(s) not cleaned up: ${[...session.createdUserIds].join(', ')}`, 'WARN');
        }
        sessions.delete(name);
      },
    },
    {
      name: 'Verify API Is Available',
      doc: 'Fails with an ENVIRONMENT error unless `health_path` returns HTTP 200. Use in suite setup to fail fast.',
      params: [{ name: 'health_path', default: '/health', type: 'str' }, SESSION],
      run: async ({ health_path, session }, ctx) => {
        const s = getSession(session);
        try {
          await call(s, ctx, { method: 'GET', path: String(health_path), expectedStatus: 200 });
        } catch (error) {
          if (error instanceof ApiConnectionError) throw error;
          throw new FrameworkError(ErrorCategory.Environment, `API health check failed: ${(error as Error).message}`, { cause: error });
        }
      },
    },
    {
      name: 'Send API Request',
      doc: `Sends an HTTP request and returns a dictionary with \`status\`, \`reason\`, \`headers\`, \`body\`, \`elapsed_ms\` and \`url\`.

\`body\` may be a dictionary/list (sent as JSON) or a string (JSON text is sent as JSON, other text as-is).
When \`expected_status\` is given, any other status fails the keyword with the sanitized response body.
Sensitive headers and body fields in the returned value are redacted.`,
      params: [
        { name: 'method', type: 'str' },
        { name: 'path', type: 'str' },
        { name: 'body', default: null },
        { name: 'params', default: null, type: 'dict | None', namedOnly: true },
        { name: 'headers', default: null, type: 'dict | None', namedOnly: true },
        { name: 'expected_status', default: null, type: 'int | None', namedOnly: true },
        { name: 'timeout_ms', default: null, type: 'int | None', namedOnly: true },
        SESSION,
      ],
      run: async ({ method, path, body, params, headers, expected_status, timeout_ms, session }, ctx) => {
        const s = getSession(session);
        const requestHeaders = optionalDict(headers, 'headers') as Record<string, string> | undefined;
        let payload = body as JsonValue | undefined;
        if (typeof body === 'string') {
          try {
            payload = JSON.parse(body) as JsonValue;
          } catch {
            payload = body; // sent verbatim, e.g. to test malformed JSON handling
          }
        }
        const response = await call(s, ctx, {
          method: parseHttpMethod(String(method)),
          path: String(path),
          body: payload ?? undefined,
          query: optionalDict(params, 'params') as QueryParams | undefined,
          headers: typeof body === 'string' && typeof payload === 'string'
            ? { 'Content-Type': 'application/json', ...requestHeaders }
            : requestHeaders,
          timeoutMs: (timeout_ms as number | null) ?? undefined,
          expectedStatus: (expected_status as number | null) ?? undefined,
        });
        return toRobotResponse(response);
      },
    },
    {
      name: 'Get API Response Status',
      doc: 'Returns the HTTP status code of the last response in the session.',
      params: [SESSION],
      run: ({ session }) => lastResponse(getSession(session)).status,
    },
    {
      name: 'Get API Response Field',
      doc: 'Returns a field from the last JSON response using a dot path such as `email`, `items.0.id` or `$` for the whole body (sanitized).',
      params: [{ name: 'field_path', type: 'str' }, SESSION],
      run: ({ field_path, session }) => {
        const response = lastResponse(getSession(session));
        try {
          return sanitizeBody(getByPath(response.body, String(field_path)));
        } catch (error) {
          if (error instanceof FieldNotFoundError) throw new FrameworkError(ErrorCategory.Application, `${error.message} in response of ${response.method} ${response.url}.`);
          throw error;
        }
      },
    },
    {
      name: 'Verify API Status Code',
      doc: 'Fails unless the last response has the expected status. The failure message includes the sanitized response body.',
      params: [{ name: 'expected', type: 'int' }, SESSION],
      run: ({ expected, session }, ctx) => {
        const response = lastResponse(getSession(session));
        if (response.status !== expected) throw new ApiStatusError(response, [expected as number]);
        ctx.log(`Status ${response.status} as expected`);
      },
    },
    {
      name: 'Verify API Response Field',
      doc: `Fails unless the field at \`field_path\` equals \`expected\`.

Numbers and booleans in the response may be compared to their string form (\`42\`, \`true\`), so plain Robot arguments work.
Use \`Verify API Response Field Type\` to check for \`null\`.`,
      params: [{ name: 'field_path', type: 'str' }, { name: 'expected' }, SESSION],
      run: ({ field_path, expected, session }, ctx) => {
        const response = lastResponse(getSession(session));
        let actual: unknown;
        try {
          actual = getByPath(response.body, String(field_path));
        } catch (error) {
          if (error instanceof FieldNotFoundError) throw new FrameworkError(ErrorCategory.Application, `${error.message} in response of ${response.method} ${response.url}.`);
          throw error;
        }
        if (!valuesMatch(actual, expected)) {
          throw new FrameworkError(
            ErrorCategory.Application,
            `Field '${String(field_path)}' was ${previewBody(JSON.stringify(sanitizeBody(actual)), 200)} (${jsonType(actual)}) but expected ${JSON.stringify(expected)} in response of ${response.method} ${response.url}.`,
          );
        }
        ctx.log(`Field '${String(field_path)}' matches`);
      },
    },
    {
      name: 'Verify API Response Field Type',
      doc: 'Fails unless the field is of the given JSON type: `string`, `integer`, `number`, `boolean`, `array`, `object` or `null`.',
      params: [{ name: 'field_path', type: 'str' }, { name: 'expected_type', type: 'str' }, SESSION],
      run: ({ field_path, expected_type, session }) => {
        const response = lastResponse(getSession(session));
        let actual: unknown;
        try {
          actual = getByPath(response.body, String(field_path));
        } catch (error) {
          if (error instanceof FieldNotFoundError) throw new FrameworkError(ErrorCategory.Application, error.message);
          throw error;
        }
        if (!matchesJsonType(actual, String(expected_type))) {
          throw new FrameworkError(ErrorCategory.Application, `Field '${String(field_path)}' should be ${String(expected_type)} but was ${jsonType(actual)}.`);
        }
      },
    },
    {
      name: 'Generate Test User Data',
      doc: 'Returns unique user data (`name`, `email`, `role`, `active`) without calling the API. Name and email default to generated unique values.',
      params: [
        { name: 'name', default: null, type: 'str | None' },
        { name: 'email', default: null, type: 'str | None' },
        { name: 'role', default: 'viewer', type: 'str' },
        { name: 'active', default: true, type: 'bool' },
      ],
      run: ({ name, email, role, active }) => {
        if (!isUserRole(role)) throw new TestDataError(`Unknown role '${String(role)}'.`);
        return buildUser({ name: (name as string | null) ?? undefined, email: (email as string | null) ?? undefined, role, active: active as boolean });
      },
    },
    {
      name: 'Create Test User',
      doc: 'Creates a user through `POST /users` (expects 201), validates the returned user, tracks it for cleanup and returns it. Missing name/email are generated.',
      params: [
        { name: 'name', default: null, type: 'str | None' },
        { name: 'email', default: null, type: 'str | None' },
        { name: 'role', default: 'viewer', type: 'str' },
        { name: 'active', default: true, type: 'bool' },
        SESSION,
      ],
      run: async ({ name, email, role, active, session }, ctx) => {
        const s = getSession(session);
        if (!isUserRole(role)) throw new TestDataError(`Unknown role '${String(role)}'.`);
        const data = buildUser({ name: (name as string | null) ?? undefined, email: (email as string | null) ?? undefined, role, active: active as boolean });
        const response = await call(s, ctx, { method: 'POST', path: USERS_PATH, body: { ...data }, expectedStatus: 201 });
        const user = parseUser(response.body, 'POST /users response');
        s.createdUserIds.add(user.id);
        ctx.log(`Created test user id=${user.id} email=${user.email}`);
        return user;
      },
    },
    {
      name: 'Get User By ID',
      doc: 'Fetches a user through `GET /users/{id}` (expects 200) and returns the validated user.',
      params: [{ name: 'user_id', type: 'str' }, SESSION],
      run: async ({ user_id, session }, ctx) => {
        const response = await call(getSession(session), ctx, { method: 'GET', path: userPath(user_id), expectedStatus: 200 });
        return parseUser(response.body, `GET /users/${String(user_id)} response`);
      },
    },
    {
      name: 'Update Test User',
      doc: 'Partially updates a user through `PATCH /users/{id}` (expects 200) and returns the validated user.',
      params: [{ name: 'user_id', type: 'str' }, { name: 'changes', type: 'dict' }, SESSION],
      run: async ({ user_id, changes, session }, ctx) => {
        const response = await call(getSession(session), ctx, {
          method: 'PATCH', path: userPath(user_id), body: optionalDict(changes, 'changes') as JsonValue, expectedStatus: 200,
        });
        return parseUser(response.body, `PATCH /users/${String(user_id)} response`);
      },
    },
    {
      name: 'Delete Test User',
      doc: `Deletes a user through \`DELETE /users/{id}\` (expects 204).

Only users created or registered by this session are deleted, so a wrong id cannot remove unrelated data.
Pass \`allow_untracked=True\` to override deliberately.`,
      params: [{ name: 'user_id', type: 'str' }, { name: 'allow_untracked', default: false, type: 'bool', namedOnly: true }, SESSION],
      run: async ({ user_id, allow_untracked, session }, ctx) => {
        const s = getSession(session);
        const id = String(user_id);
        if (!s.createdUserIds.has(id) && !allow_untracked) {
          throw new TestDataError(`Refusing to delete user '${id}': it was not created or registered by API session '${s.alias}'.`);
        }
        await call(s, ctx, { method: 'DELETE', path: userPath(id), expectedStatus: 204 });
        s.createdUserIds.delete(id);
      },
    },
    {
      name: 'Register Test User For Cleanup',
      doc: 'Tracks a user created outside the API keywords (for example through the UI) so `Delete Created Test Users` removes it.',
      params: [{ name: 'user_id', type: 'str' }, SESSION],
      run: ({ user_id, session }, ctx) => {
        const id = String(user_id ?? '').trim();
        if (!id) throw new TestDataError('A user id is required.');
        getSession(session).createdUserIds.add(id);
        ctx.log(`Registered user ${id} for cleanup`);
      },
    },
    {
      name: 'Delete Created Test Users',
      doc: 'Deletes every user tracked by the session (404 counts as already deleted). Attempts all deletions before failing. Returns the number deleted.',
      params: [SESSION],
      run: async ({ session }, ctx) => {
        const s = getSession(session);
        const failures: string[] = [];
        let deleted = 0;
        for (const id of [...s.createdUserIds]) {
          try {
            const response = await call(s, ctx, { method: 'DELETE', path: userPath(id), expectedStatus: [204, 404] });
            if (response.status === 204) deleted++;
            s.createdUserIds.delete(id);
          } catch (error) {
            failures.push(`${id}: ${(error as Error).message}`);
          }
        }
        ctx.log(`Cleanup deleted ${deleted} test user(s)`);
        if (failures.length) {
          throw new FrameworkError(ErrorCategory.TestData, `Cleanup failed for ${failures.length} user(s): ${failures.join(' | ')}`);
        }
        return deleted;
      },
    },
  ];
}
