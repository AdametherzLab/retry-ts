import type {
  JitterStrategy,
  RetryConfig,
  RetryContext,
  RetryResult,
  BackoffStrategy,
} from './types.js';
import { RetryError, matchesErrorFilter, computeBackoffDelay } from './types.js';

/**
 * Executes an async operation with retry capabilities based on configurable backoff and jitter.
 * @param operation - Async function to execute. Receives AbortSignal for cancellation
 * @param config - Configuration for retry behavior
 * @returns Promise resolving to operation result with retry metadata
 * @throws {RetryError} When all attempts fail or operation is aborted/timed out
 * @example
 * const data = await retry(fetchData, { maxAttempts: 3, baseDelayMs: 100 });
 * @example
 * // Use linear backoff with decorrelated jitter
 * const data = await retry(fetchData, { 
 *   maxAttempts: 5,
 *   backoffStrategy: 'linear',
 *   jitterStrategy: 'decorrelated'
 * });
 */
export async function retry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  config?: RetryConfig
): Promise<RetryResult<T>> {
  const resolvedConfig: Required<Omit<RetryConfig, 'retryOn' | 'abortOn'>> & Pick<RetryConfig, 'retryOn' | 'abortOn'> = {
    maxAttempts: config?.maxAttempts ?? 3,
    baseDelayMs: config?.baseDelayMs ?? 1000,
    maxDelayMs: config?.maxDelayMs ?? 30000,
    timeoutMs: config?.timeoutMs ?? Infinity,
    jitterStrategy: config?.jitterStrategy ?? 'none',
    backoffStrategy: config?.backoffStrategy ?? 'exponential',
    abortSignal: config?.abortSignal,
    shouldRetry: config?.shouldRetry ?? (() => true),
    retryOn: config?.retryOn,
    abortOn: config?.abortOn,
  };

  validateConfig(resolvedConfig);

  const startTime = Date.now();
  let attempt = 1;
  let lastError: unknown;
  let previousDelayMs = 0;
  const controller = new AbortController();

  const handleAbort = () => controller.abort();
  resolvedConfig.abortSignal?.addEventListener('abort', handleAbort);

  try {
    while (attempt <= resolvedConfig.maxAttempts) {
      if (resolvedConfig.abortSignal?.aborted) {
        throw new RetryError('Operation aborted via external signal', {
          cause: lastError ?? new Error('Aborted'),
          attempts: attempt - 1,
          elapsedTimeMs: Date.now() - startTime,
        });
      }

      const elapsedMs = Date.now() - startTime;
      if (elapsedMs >= resolvedConfig.timeoutMs!) {
        throw new RetryError(`Timeout after ${resolvedConfig.timeoutMs}ms`, {
          cause: lastError ?? new Error('Timeout'),
          attempts: attempt - 1,
          elapsedTimeMs: elapsedMs,
        });
      }

      try {
        const value = await operation(controller.signal);
        return { value, attempts: attempt, elapsedTimeMs: Date.now() - startTime };
      } catch (error) {
        lastError = error;

        // abortOn takes highest precedence — immediately fail
        if (resolvedConfig.abortOn && matchesErrorFilter(error, resolvedConfig.abortOn)) {
          throw new RetryError(`Aborted due to non-retryable error on attempt ${attempt}`, {
            cause: error,
            attempts: attempt,
            elapsedTimeMs: Date.now() - startTime,
          });
        }

        // retryOn — if set, error must match to be retried
        if (resolvedConfig.retryOn && !matchesErrorFilter(error, resolvedConfig.retryOn)) {
          throw new RetryError(`Error not retryable on attempt ${attempt}`, {
            cause: error,
            attempts: attempt,
            elapsedTimeMs: Date.now() - startTime,
          });
        }

        if (attempt >= resolvedConfig.maxAttempts) break;

        const retryContext: RetryContext = {
          error,
          attempt,
          elapsedTimeMs: Date.now() - startTime,
          previousDelayMs,
        };
        const shouldRetry = await resolvedConfig.shouldRetry!(retryContext);
        if (!shouldRetry) break;

        const baseDelayUncapped = computeBackoffDelay(
          resolvedConfig.backoffStrategy!,
          attempt,
          resolvedConfig.baseDelayMs!
        );
        // Cap the base delay before applying jitter
        const baseDelay = Math.min(baseDelayUncapped, resolvedConfig.maxDelayMs!); 
        const jittered = applyJitter(baseDelay, resolvedConfig.jitterStrategy!, previousDelayMs, resolvedConfig.maxDelayMs!); // Pass maxDelayMs to jitter for decorrelated strategy
        const remainingTime = resolvedConfig.timeoutMs! - (Date.now() - startTime);
        const actualDelay = Math.max(0, Math.min(jittered, remainingTime));

        if (actualDelay > 0) {
          await new Promise(r => setTimeout(r, actualDelay));
          previousDelayMs = actualDelay;
        }

        attempt++;
      }
    }

    throw new RetryError(`Failed after ${resolvedConfig.maxAttempts} attempts`, {
      cause: lastError,
      attempts: attempt,
      elapsedTimeMs: Date.now() - startTime,
    });
  } finally {
    resolvedConfig.abortSignal?.removeEventListener('abort', handleAbort);
  }
}

/**
 * Applies a jitter strategy to a given delay.
 * @param delay - The base delay in milliseconds (already capped by maxDelayMs from backoff calculation).
 * @param strategy - The jitter strategy to apply.
 * @param previousDelayMs - The actual delay that was used for the previous retry (for decorrelated jitter).
 * @param maxDelayMs - The maximum allowed delay in milliseconds (used for decorrelated jitter's upper bound).
 * @returns The jittered delay in milliseconds.
 */
export function applyJitter(
  delay: number,
  strategy: JitterStrategy,
  previousDelayMs: number,
  maxDelayMs: number
): number {
  switch (strategy) {
    case 'none':
      return delay;
    case 'full':
      return Math.random() * delay;
    case 'equal':
      return delay * 0.5 + Math.random() * delay * 0.5;
    case 'decorrelated':
      // For the first retry (previousDelayMs is 0), behave like full jitter within the current delay.
      if (previousDelayMs <= 0) {
        return Math.random() * delay;
      } else {
        // The next delay is a random value between the current base delay and previousDelay * 3,
        // capped by maxDelayMs.
        const lowerBound = delay; // The current calculated base delay
        const upperBound = Math.min(previousDelayMs * 3, maxDelayMs);
        
        // Ensure lowerBound is not greater than upperBound to avoid negative range for Math.random
        // If baseDelay is very high and previousDelay was very low, lowerBound could be > upperBound.
        // In such cases, we should just return the lowerBound (or upperBound if it's smaller).
        if (lowerBound >= upperBound) {
          return lowerBound; // Or upperBound, whichever is smaller or desired behavior.
                            // For decorrelated, it should generally be between base and prev*3. If base is higher, use base.
        }
        return lowerBound + Math.random() * (upperBound - lowerBound);
      }
    default:
      const exhaustiveCheck: never = strategy;
      throw new Error(`Invalid jitter strategy: ${exhaustiveCheck}`);
  }
}

function validateConfig(config: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; timeoutMs: number }): void {
  if (config.maxAttempts < 1) throw new RangeError('maxAttempts must be ≥1');
  if (config.baseDelayMs < 0) throw new RangeError('baseDelayMs must be ≥0');
  if (config.maxDelayMs < 0) throw new RangeError('maxDelayMs must be ≥0');
  if (config.baseDelayMs > config.maxDelayMs) {
    throw new RangeError('baseDelayMs cannot exceed maxDelayMs');
  }
  if (config.timeoutMs < 0) throw new RangeError('timeoutMs must be ≥0');
}
