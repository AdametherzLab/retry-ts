import { CircuitBreaker } from './circuit.js';

/** Configuration options for retry behavior */
export interface RetryConfig {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly timeoutMs?: number;
  readonly jitterStrategy?: JitterStrategy;
  readonly backoffStrategy?: BackoffStrategy;
  readonly abortSignal?: AbortSignal;
  readonly shouldRetry?: (context: RetryContext) => boolean | Promise<boolean>;
  readonly retryOn?: ErrorFilter;
  readonly abortOn?: ErrorFilter;
  readonly onRetry?: (context: RetryCallbackContext) => void | Promise<void>;
  readonly logger?: RetryLogger;
  readonly retryLogLevel?: LogLevel;
  readonly logSuccess?: boolean;
  /**
   * An optional CircuitBreaker instance to integrate with the retry mechanism.
   * If provided, the retry function will consult the circuit breaker before each attempt
   * and update its state based on success or failure.
   */
  readonly circuitBreaker?: CircuitBreaker;
}

export type JitterStrategy =
  | 'none'
  | 'full'
  | 'equal'
  | 'decorrelated'
  | ((delay: number, previousDelayMs: number, maxDelayMs: number) => number);

export type BackoffStrategy =
  | BackoffStrategyName
  | BackoffFunction;

export type BackoffStrategyName =
  | 'exponential'
  | 'linear'
  | 'fixed';

export type BackoffFunction = (attempt: number, baseDelayMs: number) => number;

export type ErrorFilter = ErrorConstructor | ErrorPredicate | Array<ErrorConstructor | ErrorPredicate>;

export type ErrorConstructor = new (...args: any[]) => Error;

export type ErrorPredicate = (error: unknown) => boolean;

/** Context provided to the `shouldRetry` callback. */
export interface RetryContext {
  /** The error that occurred in the last attempt. */
  readonly error: unknown;
  /** The current attempt number (1-indexed). */
  readonly attempt: number;
  /** The total elapsed time in milliseconds since the first attempt started. */
  readonly elapsedTimeMs: number;
  /** The delay in milliseconds that was used before the current attempt. */
  readonly previousDelayMs: number;
}

/** Context provided to the `onRetry` callback. */
export interface RetryCallbackContext extends RetryContext {
  /** The calculated delay in milliseconds before the next retry attempt. */
  readonly delayMs: number;
}

/** Result of a successful retry operation. */
export interface RetryResult<T> {
  /** The value returned by the successful operation. */
  readonly value: T;
  /** The number of attempts it took to succeed. */
  readonly attempts: number;
  /** The total elapsed time in milliseconds from the start of the first attempt to the successful completion. */
  readonly elapsedTimeMs: number;
}

export interface RetryLogger {
  debug?: LogMethod;
  info?: LogMethod;
  warn?: LogMethod;
  error?: LogMethod;
}

export type LogMethod = (message: string, meta?: object) => void;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class RetryError extends Error {
  readonly attempts: number;
  readonly elapsedTimeMs: number;
  readonly cause: unknown;

  constructor(
    message: string,
    options: {
      cause: unknown;
      attempts: number;
      elapsedTimeMs: number;
    }
  ) {
    super(message);
    this.name = 'RetryError';
    this.cause = options.cause;
    this.attempts = options.attempts;
    this.elapsedTimeMs = options.elapsedTimeMs;

    if (this.cause instanceof Error) {
      this.stack += '\nCaused by: ' + this.cause.stack;
    }
  }
}

/**
 * Checks if an error matches a given filter.
 * @param error - The error to check.
 * @param filter - The filter to apply. Can be an ErrorConstructor, a predicate function, or an array of either.
 * @returns True if the error matches the filter, false otherwise.
 */
export function matchesErrorFilter(error: unknown, filter: ErrorFilter): boolean {
  const filters = Array.isArray(filter) ? filter : [filter];
  return filters.some(f => {
    if (typeof f === 'function' && f.prototype instanceof Error) {
      // This is an ErrorConstructor
      return error instanceof (f as ErrorConstructor);
    } else if (typeof f === 'function') {
      // This is an ErrorPredicate function
      return (f as ErrorPredicate)(error);
    }
    return false;
  });
}

/**
 * Computes the backoff delay based on the specified strategy.
 * @param strategy - The backoff strategy to use.
 * @param attempt - The current attempt number (1-indexed).
 * @param baseDelayMs - The base delay in milliseconds.
 * @returns The calculated delay in milliseconds.
 * @throws {Error} If an invalid backoff strategy is provided.
 */
export function computeBackoffDelay(
  strategy: BackoffStrategy,
  attempt: number,
  baseDelayMs: number
): number {
  switch (strategy) {
    case 'exponential':
      return baseDelayMs * Math.pow(2, attempt - 1);
    case 'linear':
      return baseDelayMs * attempt;
    case 'fixed':
      return baseDelayMs;
    default:
      if (typeof strategy === 'function') {
        return strategy(attempt, baseDelayMs);
      }
      const exhaustiveCheck: never = strategy;
      throw new Error(`Invalid backoff strategy: ${exhaustiveCheck}`);
  }
}
