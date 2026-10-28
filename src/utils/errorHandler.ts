/**
 * Failure categories shown at the start of every framework error message so a
 * tester can tell from the Robot log alone where to start investigating.
 */
export enum ErrorCategory {
  /** The application under test behaved incorrectly (wrong data, wrong status). */
  Application = 'APPLICATION',
  /** Problem in automation code or locators rather than in the application. */
  Automation = 'AUTOMATION',
  /** The API could not be called successfully (transport, timeout, invalid response). */
  Api = 'API',
  /** Test data was missing, malformed or not in the expected state. */
  TestData = 'TEST DATA',
  /** A required service, process or dependency was unavailable. */
  Environment = 'ENVIRONMENT',
  /** Configuration values are missing or invalid. */
  Configuration = 'CONFIGURATION',
}

export class FrameworkError extends Error {
  override name = 'FrameworkError';

  constructor(
    readonly category: ErrorCategory,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }

  /** Message as shown in Robot Framework, e.g. `[API] Request timed out ...`. */
  override toString(): string {
    return `[${this.category}] ${this.message}`;
  }
}

export class ConfigurationError extends FrameworkError {
  override name = 'ConfigurationError';
  constructor(message: string) {
    super(ErrorCategory.Configuration, message);
  }
}

export class TestDataError extends FrameworkError {
  override name = 'TestDataError';
  constructor(message: string) {
    super(ErrorCategory.TestData, message);
  }
}

/** Formats any thrown value for display in a Robot Framework failure message. */
export function formatError(error: unknown): string {
  if (error instanceof FrameworkError) return error.toString();
  if (error instanceof Error) return `[${ErrorCategory.Automation}] ${error.name}: ${error.message}`;
  return `[${ErrorCategory.Automation}] ${String(error)}`;
}
