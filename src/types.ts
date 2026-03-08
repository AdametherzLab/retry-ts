/** Strategy for adding jitter to delay calculations */
export type JitterStrategy = 
  | 'none'   // No jitter
  | 'full'   // Random value between 0 and base delay
  | 'equal'; // Random value between baseDelay/2 and baseDelay

/** Error class constructor type for matching */
export type ErrorConstructor = new (...args: any[]) => Error;

/** Predicate function for error filtering */
export type ErrorPredicate = (error: unknown) => boolean;

/** Error filter — can be a single error class, predicate, or array of either */
export type ErrorFilter = ErrorConstructor | ErrorPredicate | Array<ErrorConstructor | ErrorPredicate>;

/** Configuration options for retry behavior */
export interface RetryConfig {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly timeoutMs?: number;
  readonly jitterStrategy?: JitterStrategy;
  readonly abortSignal?: AbortSignal;
  readonly shouldRetry?: (context: RetryContext) => boolean | Promise<boolean>;
  /**
   * Only retry when the error matches this filter.
   * If an error does NOT match, it fails immediately without further retries.
   * Can be an Error subclass, a predicate function, or an array of either.
   * @example
   * // Retry only on network errors
   * retryOn: [TypeError, (e) => e instanceof Error && e.message.includes('ECONNRESET')]
   */
  readonly retryOn?: ErrorFilter;
  /**
   * Immediately abort (no retry) when the error matches this filter.
   * Takes precedence over retryOn and shouldRetry.
   * Can be an Error subclass, a predicate function, or an array of either.
   * @example
   * // Never retry auth errors
   * abortOn: [AuthenticationError, (e) => e instanceof Error && e.message.includes('403')]
   */
  readonly abortOn?: ErrorFilter;
}

/** Context provided to shouldRetry predicate */
export interface RetryContext {
  readonly error: unknown;
  readonly attempt: number;
  readonly elapsedTimeMs: number;
  readonly previousDelayMs: number;
}

/** Successful result with retry metadata */
export interface RetryResult<T> {
  readonly value: T;
  readonly attempts: number;
  readonly elapsedTimeMs: number;
}

/** Error thrown when all retry attempts fail */
export class RetryError extends Error {
  public readonly cause: unknown;
  public readonly attempts: number;
  public readonly elapsedTimeMs: number;

  constructor(message: string, options: {
    cause: unknown;
    attempts: number;
    elapsedTimeMs: number;
  }) {
    super(message);
    this.name = 'RetryError';
    this.cause = options.cause;
    this.attempts = options.attempts;
    this.elapsedTimeMs = options.elapsedTimeMs;
  }
}

/**
 * Tests whether an error matches an ErrorFilter.
 * @param error - The error to test
 * @param filter - The filter to match against
 * @returns true if the error matches the filter
 */
export function matchesErrorFilter(error: unknown, filter: ErrorFilter): boolean {
  const filters = Array.isArray(filter) ? filter : [filter];
  return filters.some(f => {
    if (typeof f === 'function' && f.prototype instanceof Error) {
      return error instanceof (f as ErrorConstructor);
    }
    return (f as ErrorPredicate)(error);
  });
}
