/**
 * Server-rendered HTML for the demo application. Every interactive element has
 * an accessible label; `data-testid` attributes are provided for values that
 * have no natural accessible name.
 */
import { ROLES, type StoredUser } from './userStore.js';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
  body { font-family: system-ui, sans-serif; margin: 0; color: #1d2433; background: #f6f7f9; }
  header { display: flex; gap: 1rem; align-items: center; padding: .75rem 1.5rem; background: #1d2433; color: #fff; }
  header a { color: #fff; }
  header form { margin-left: auto; }
  main { max-width: 52rem; margin: 2rem auto; padding: 0 1rem; }
  label { display: block; margin-top: .75rem; font-weight: 600; }
  input[type=text], input[type=email], input[type=password], select { width: 100%; max-width: 24rem; padding: .4rem; }
  fieldset { margin-top: .75rem; max-width: 24rem; }
  fieldset label, .checkbox label { display: inline; font-weight: normal; }
  button { margin-top: 1rem; padding: .45rem 1rem; }
  .alert { padding: .6rem .8rem; border-radius: 4px; background: #fde8e8; color: #8a1c1c; }
  .notice { padding: .6rem .8rem; border-radius: 4px; background: #e6f4ea; color: #1e5631; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #dde1e7; }
  dt { font-weight: 600; margin-top: .5rem; }
`;

function layout(title: string, body: string, signedIn: boolean): string {
  const nav = signedIn
    ? `<header>
        <strong>User Admin</strong>
        <nav aria-label="Main"><a href="/users">Users</a> | <a href="/users/new">New user</a></nav>
        <form method="post" action="/logout"><button type="submit">Sign out</button></form>
      </header>`
    : '<header><strong>User Admin</strong></header>';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)} - User Admin</title><style>${STYLE}</style></head>
<body>${nav}<main>${body}</main></body>
</html>`;
}

export function loginPage(options: { error?: string; notice?: string; next?: string; username?: string } = {}): string {
  return layout('Sign in', `
    <h1>Sign in</h1>
    ${options.notice ? `<p class="notice" role="status" data-testid="login-notice">${escapeHtml(options.notice)}</p>` : ''}
    ${options.error ? `<p class="alert" role="alert" data-testid="login-error">${escapeHtml(options.error)}</p>` : ''}
    <form method="post" action="/login" novalidate>
      <input type="hidden" name="next" value="${escapeHtml(options.next ?? '/users')}">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" autocomplete="username" value="${escapeHtml(options.username ?? '')}">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password">
      <button type="submit">Sign in</button>
    </form>`, false);
}

export function usersPage(loadDelayMs: number): string {
  return layout('Users', `
    <h1>Users</h1>
    <p role="status" data-testid="users-loading">Loading users…</p>
    <table data-testid="users-table" aria-label="Users" hidden>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
      <tbody></tbody>
    </table>
    <p class="alert" role="alert" data-testid="users-error" hidden></p>
    <script>
      // Rows load asynchronously (after a configurable delay) so tests must wait for real UI state.
      setTimeout(async () => {
        const loading = document.querySelector('[data-testid=users-loading]');
        try {
          const response = await fetch('/api/users', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const users = await response.json();
          const tbody = document.querySelector('[data-testid=users-table] tbody');
          for (const user of users) {
            const row = tbody.insertRow();
            const link = document.createElement('a');
            link.href = '/users/' + encodeURIComponent(user.id);
            link.textContent = user.name;
            row.insertCell().append(link);
            row.insertCell().textContent = user.email;
            row.insertCell().textContent = user.role;
            row.insertCell().textContent = user.active ? 'Active' : 'Inactive';
          }
          document.querySelector('[data-testid=users-table]').hidden = false;
        } catch (error) {
          const box = document.querySelector('[data-testid=users-error]');
          box.textContent = 'Could not load users: ' + error.message;
          box.hidden = false;
        } finally {
          loading.remove();
        }
      }, ${Math.max(0, Math.floor(loadDelayMs))});
    </script>`, true);
}

export function userDetailPage(user: StoredUser, notice?: string): string {
  return layout(user.name, `
    ${notice ? `<p class="notice" role="status" data-testid="user-notice">${escapeHtml(notice)}</p>` : ''}
    <h1 data-testid="user-heading">${escapeHtml(user.name)}</h1>
    <dl>
      <dt>ID</dt><dd data-testid="user-id">${escapeHtml(user.id)}</dd>
      <dt>Email</dt><dd data-testid="user-email">${escapeHtml(user.email)}</dd>
      <dt>Role</dt><dd data-testid="user-role">${escapeHtml(user.role)}</dd>
      <dt>Status</dt><dd data-testid="user-status">${user.active ? 'Active' : 'Inactive'}</dd>
    </dl>
    <p><a href="/users">Back to users</a></p>`, true);
}

export function notFoundPage(message: string, signedIn: boolean): string {
  return layout('Not found', `<h1>Not found</h1><p class="alert" role="alert" data-testid="not-found">${escapeHtml(message)}</p>`, signedIn);
}

export interface NewUserFormValues {
  name?: string;
  email?: string;
  role?: string;
  status?: string;
}

export function newUserPage(values: NewUserFormValues = {}, errors: string[] = []): string {
  const role = values.role ?? 'viewer';
  const status = values.status ?? 'active';
  return layout('New user', `
    <h1>New user</h1>
    ${errors.length ? `<div class="alert" role="alert" data-testid="form-errors"><ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>` : ''}
    <form method="post" action="/users/new" id="new-user-form" aria-label="New user">
      <label for="name">Full name</label>
      <input type="text" id="name" name="name" required minlength="2" maxlength="100" value="${escapeHtml(values.name ?? '')}">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required value="${escapeHtml(values.email ?? '')}">
      <label for="role">Role</label>
      <select id="role" name="role">
        ${ROLES.map((r) => `<option value="${r}"${r === role ? ' selected' : ''}>${r[0]!.toUpperCase()}${r.slice(1)}</option>`).join('')}
      </select>
      <fieldset>
        <legend>Status</legend>
        <input type="radio" id="status-active" name="status" value="active"${status === 'active' ? ' checked' : ''}>
        <label for="status-active">Active</label>
        <input type="radio" id="status-inactive" name="status" value="inactive"${status === 'inactive' ? ' checked' : ''}>
        <label for="status-inactive">Inactive</label>
      </fieldset>
      <p class="checkbox">
        <input type="checkbox" id="confirm" name="confirm" value="yes" required>
        <label for="confirm">I confirm this is test data</label>
      </p>
      <button type="submit">Create user</button>
    </form>`, true);
}
