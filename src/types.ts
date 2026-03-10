/** Configuration options for retry behavior */
export interface RetryConfig {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly timeoutMs?: number;
  readonly jitterStrategy?: JitterStrategy;
  readonly backoffStrategy?: BackoffStrategy;
  readonly abortSignal?: AbortSignal;
  /**
   * Custom predicate to determine if a retry should occur. Receives context with
   * error details, attempt count, and timing information. Return false to abort retries.
   * @example
   * // Retry only on 429 errors
   * shouldRetry: ({ error }) => error instanceof MyError && error.code === 429
   * @example
   * // Retry first 3 attempts regardless of error
   * shouldRetry: ({ attempt }) => attempt <= 3
   */
  readonly shouldRetry?: (context: RetryContext) => boolean | Promise<boolean>;
  readonly retryOn?: ErrorFilter;
  readonly abortOn?: ErrorFilter;
  readonly onRetry?: (context: RetryCallbackContext) => void | Promise<void>;
  readonly logger?: RetryLogger;
  readonly retryLogLevel?: LogLevel;
  readonly logSuccess?: boolean;
}

/** Context provided to shouldRetry predicate */
export interface RetryContext {
  /** Error that caused the retry */
  readonly error: unknown;
  /** Current attempt number (1-indexed) */
  readonly attempt: number;
  /** Milliseconds elapsed since first attempt */
  readonly elapsedTimeMs: number;
  /** Previous actual delay used (after jitter) */
  readonly previousDelayMs: number;
}

/** Context provided to onRetry callback */
export interface RetryCallbackContext extends RetryContext {
  /** Delay in milliseconds before next attempt */
  readonly delayMs: number;
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

export function matchesErrorFilter(error: unknown, filter: ErrorFilter): boolean {
  const filters = Array.isArray(filter) ? filter : [filter];
  return filters.some(f => {
    switch (typeof f) {
      case 'function':
        return error instanceof f;
      case 'object':
        return f(error);
      default:
        return false;
    }
  });
}

export function computeBackoffDelay(
  strategy: BackoffStrategy,
  attempt: number,
  baseDelayMs: number
): number {
  algorithm: switch (strategy) {
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
