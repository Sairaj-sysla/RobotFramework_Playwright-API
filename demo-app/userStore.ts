/**
 * In-memory user store and input validation for the demo application.
 * Shared by the REST API and the server-rendered UI, so data created through
 * one is visible through the other.
 */
import { randomUUID } from 'node:crypto';

export const ROLES = ['viewer', 'editor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type UserInput = Pick<StoredUser, 'name' | 'email' | 'role' | 'active'>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ValidationResult {
  errors: string[];
  value: Partial<UserInput>;
}

/** Validates a create (`partial=false`) or patch (`partial=true`) payload. */
export function validateUserInput(input: unknown, partial: boolean): ValidationResult {
  const errors: string[] = [];
  const value: Partial<UserInput> = {};
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: ['Request body must be a JSON object'], value };
  }
  const data = input as Record<string, unknown>;
  const allowed = new Set(['name', 'email', 'role', 'active']);
  for (const key of Object.keys(data)) if (!allowed.has(key)) errors.push(`Unknown field '${key}'`);

  if ('name' in data || !partial) {
    if (typeof data.name !== 'string' || data.name.trim().length < 2 || data.name.trim().length > 100) {
      errors.push('name must be a string of 2-100 characters');
    } else value.name = data.name.trim();
  }
  if ('email' in data || !partial) {
    if (typeof data.email !== 'string' || !EMAIL_PATTERN.test(data.email.trim())) {
      errors.push('email must be a valid email address');
    } else value.email = data.email.trim().toLowerCase();
  }
  if ('role' in data) {
    if (!ROLES.includes(data.role as Role)) errors.push(`role must be one of ${ROLES.join(', ')}`);
    else value.role = data.role as Role;
  } else if (!partial) value.role = 'viewer';
  if ('active' in data) {
    if (typeof data.active !== 'boolean') errors.push('active must be a boolean');
    else value.active = data.active;
  } else if (!partial) value.active = true;
  return { errors, value };
}

export class DuplicateEmailError extends Error {}

export class UserStore {
  private readonly users = new Map<string, StoredUser>();

  list(filter: { email?: string } = {}): StoredUser[] {
    const email = filter.email?.toLowerCase();
    return [...this.users.values()]
      .filter((user) => !email || user.email === email)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): StoredUser | undefined {
    return this.users.get(id);
  }

  create(input: UserInput): StoredUser {
    this.assertEmailFree(input.email);
    const now = new Date().toISOString();
    const user: StoredUser = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.users.set(user.id, user);
    return user;
  }

  update(id: string, changes: Partial<UserInput>): StoredUser | undefined {
    const existing = this.users.get(id);
    if (!existing) return undefined;
    if (changes.email && changes.email !== existing.email) this.assertEmailFree(changes.email);
    const updated: StoredUser = { ...existing, ...changes, updatedAt: new Date().toISOString() };
    this.users.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.users.delete(id);
  }

  private assertEmailFree(email: string): void {
    if ([...this.users.values()].some((user) => user.email === email)) {
      throw new DuplicateEmailError(`A user with email ${email} already exists`);
    }
  }
}
