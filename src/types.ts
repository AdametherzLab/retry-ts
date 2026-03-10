/** Strategy for adding jitter to delay calculations */
export type JitterStrategy = 
  | 'none'   // No jitter
  | 'full'   // Random value between 0 and base delay
  | 'equal'  // Random value between baseDelay/2 and baseDelay
  | 'decorrelated'
  | ((delay: number, previousDelayMs: number, maxDelayMs: number) => number);

/** Built-in backoff strategy names */
export type BackoffStrategyName = 'exponential' | 'linear' | 'fixed';

/** Custom backoff function: receives attempt number (1-based) and baseDelayMs, returns delay in ms */
export type BackoffFunction = (attempt: number, baseDelayMs: number) => number;

/** Error class constructor type for matching */
export type ErrorConstructor = new (...args: any[]) => Error;

/** Predicate function for error filtering */
export type ErrorPredicate = (error: unknown) => boolean;

/** Error filter — can be a single error class, predicate, or array of either */
export type ErrorFilter = ErrorConstructor | ErrorPredicate | Array<ErrorConstructor | ErrorPredicate>;

/** Context provided to shouldRetry predicate and onRetry callback */
export interface RetryContext {
  readonly error: unknown;
  readonly attempt: number;
  readonly elapsedTimeMs: number;
  readonly previousDelayMs: number;
}

/** Context provided to onRetry callback including upcoming delay */
export interface RetryCallbackContext extends RetryContext {
  /** The delay in milliseconds before the next retry attempt */
  readonly delayMs: number;
}

/** Configuration options for retry behavior */
export interface RetryConfig {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly timeoutMs?: number;
  /** 
   * Jitter strategy for spreading out retry delays:
   * - 'none': No randomization
   * - 'full': Uniform random between 0 and calculated delay
   * - 'equal': Random between delay/2 and delay
   * - 'decorrelated': Random between the calculated base delay and previous actual delay * 3 (capped at maxDelayMs).
   *                   On the first retry, it behaves like 'full' jitter.
   * - Custom function: (delay, previousDelayMs, maxDelayMs) => number
   * @default 'none'
   */
  readonly jitterStrategy?: JitterStrategy;
  /**
   * Backoff strategy for computing delay between retries.
   * - `'exponential'` (default): delay = baseDelayMs * 2^(attempt-1)
   * - `'linear'`: delay = baseDelayMs * attempt
   * - `'fixed'`: delay = baseDelayMs (constant)
   * - `(attempt, baseDelayMs) => number`: custom function returning delay in ms
   * @default 'exponential'
   */
  readonly backoffStrategy?: BackoffStrategy;
  readonly abortSignal?: AbortSignal;
  readonly shouldRetry?: (context: RetryContext) => boolean | Promise<boolean>;
  /**
   * Callback invoked after each failed attempt, before waiting for the next retry.
   * Receives context about the failure and the delay before the next attempt.
   * Useful for logging, monitoring, or updating UI with retry progress.
   * @example
   * onRetry: ({ attempt, error, delayMs }) => {
   *   console.log(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`);
   * }
   */
  readonly onRetry?: (context: RetryCallbackContext) => void | Promise<void>;
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
    // If it's not an ErrorConstructor, it must be an ErrorPredicate
    return (f as ErrorPredicate)(error);
  });
}

/**
 * Computes the raw backoff delay (before jitter and maxDelayMs capping) for a given attempt.
 * @param strategy - The backoff strategy to use
 * @param attempt - The current attempt number (1-based)
 * @param baseDelayMs - The base delay in milliseconds
 * @returns The computed delay in milliseconds
 */
export function computeBackoffDelay(
  strategy: BackoffStrategy,
  attempt: number,
  baseDelayMs: number
): number {
  if (typeof strategy === 'function') {
    return strategy(attempt, baseDelayMs);
  }
  switch (strategy) {
    case 'exponential':
      return baseDelayMs * 2 ** (attempt - 1);
    case 'linear':
      return baseDelayMs * attempt;
    case 'fixed':
      return baseDelayMs;
    default:
      const _exhaustive: never = strategy;
      throw new Error(`Invalid backoff strategy: ${_exhaustive}`);
  }
}

/** Backoff strategy type */
export type BackoffStrategy = BackoffStrategyName | BackoffFunction;
