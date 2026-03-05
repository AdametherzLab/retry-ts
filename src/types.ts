// REMOVED external import: import type { AbortSignal } from 'node:abort-controller';

/** Strategy for adding jitter to delay calculations */
export type JitterStrategy = 
  | 'none'   // No jitter
  | 'full'   // Random value between 0 and base delay
  | 'equal'; // Random value between baseDelay/2 and baseDelay

/** Configuration options for retry behavior */
export interface RetryConfig {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly timeoutMs?: number;
  readonly jitterStrategy?: JitterStrategy;
  readonly abortSignal?: AbortSignal;
  readonly shouldRetry?: (context: RetryContext) => boolean | Promise<boolean>;
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