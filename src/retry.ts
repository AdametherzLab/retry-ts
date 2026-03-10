import type {
  JitterStrategy,
  RetryConfig,
  RetryContext,
  RetryResult,
  BackoffStrategy,
} from './types.js';
import { RetryError, matchesErrorFilter, computeBackoffDelay } from './types.js';

/**
 * Applies a jitter strategy to a given delay.
 * @param delay - The base delay in milliseconds (already capped by maxDelayMs from backoff calculation).
 * @param strategy - The jitter strategy to apply.
 * @param previousDelayMs - The actual delay that was used for the previous retry (for decorrelated jitter).
 * @param maxDelayMs - The maximum allowed delay in milliseconds (used for capping all strategies).
 * @returns The jittered delay in milliseconds, capped at maxDelayMs.
 */
export function applyJitter(
  delay: number,
  strategy: JitterStrategy,
  previousDelayMs: number,
  maxDelayMs: number
): number {
  let jitteredDelay: number;

  if (typeof strategy === 'function') {
    jitteredDelay = strategy(delay, previousDelayMs, maxDelayMs);
  } else {
    switch (strategy) {
      case 'none':
        jitteredDelay = delay;
        break;
      case 'full':
        jitteredDelay = Math.random() * delay;
        break;
      case 'equal':
        jitteredDelay = delay * 0.5 + Math.random() * delay * 0.5;
        break;
      case 'decorrelated':
        if (previousDelayMs <= 0) {
          jitteredDelay = Math.random() * delay;
        } else {
          const upperBound = Math.min(previousDelayMs * 3, maxDelayMs);
          const lowerBound = Math.min(delay, upperBound);
          jitteredDelay = lowerBound + Math.random() * (upperBound - lowerBound);
        }
        break;
      default:
        const exhaustiveCheck: never = strategy;
        throw new Error(`Invalid jitter strategy: ${exhaustiveCheck}`);
    }
  }

  return Math.min(jitteredDelay, maxDelayMs);
}

/**
 * Executes an async operation with retry capabilities based on configurable backoff and jitter.
 * @param operation - Async function to execute. Receives AbortSignal for cancellation
 * @param config - Configuration for retry behavior
 * @returns Promise resolving to operation result with retry metadata
 * @throws {RetryError} When all attempts fail or operation is aborted/timed out
 * @example
 * const data = await retry(fetchData, { maxAttempts: 3, baseDelayMs: 100 });
 * @example
 * // Use linear backoff with custom jitter
 * const data = await retry(fetchData, { 
 *   maxAttempts: 5,
 *   backoffStrategy: 'linear',
 *   jitterStrategy: (delay) => delay * 0.8 + Math.random() * delay * 0.4
 * });
 * @example
 * // Monitor retry progress
 * const data = await retry(fetchData, {
 *   maxAttempts: 3,
 *   onRetry: ({ attempt, delayMs, error }) => {
 *     console.log(`Attempt ${attempt} failed, retrying in ${delayMs}ms:`, error);
 *   }
 * });
 * @example
 * // Use Winston logger
 * import { createLogger } from 'winston';
 * const logger = createLogger();
 * const data = await retry(fetchData, { maxAttempts: 3, logger });
 */
export async function retry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  config?: RetryConfig
): Promise<RetryResult<T>> {
  const resolvedConfig: Required<Omit<RetryConfig, 'retryOn' | 'abortOn' | 'onRetry' | 'logger' | 'retryLogLevel' | 'logSuccess'>> & 
    Pick<RetryConfig, 'retryOn' | 'abortOn' | 'onRetry' | 'logger' | 'retryLogLevel' | 'logSuccess'> = {
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
    onRetry: config?.onRetry,
    logger: config?.logger,
    retryLogLevel: config?.retryLogLevel ?? 'warn',
    logSuccess: config?.logSuccess ?? false,
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
        
        // Log success if enabled
        if (resolvedConfig.logger?.info && resolvedConfig.logSuccess) {
          resolvedConfig.logger.info(`Operation succeeded after ${attempt} attempt(s)`, {
            attempts: attempt,
            elapsedTimeMs: Date.now() - startTime,
          });
        }
        
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
        const jittered = applyJitter(baseDelay, resolvedConfig.jitterStrategy!, previousDelayMs, resolvedConfig.maxDelayMs!);
        const remainingTime = resolvedConfig.timeoutMs! - (Date.now() - startTime);
        const actualDelay = Math.max(0, Math.min(jittered, remainingTime));

        // Invoke progress callback if provided
        if (resolvedConfig.onRetry) {
          await resolvedConfig.onRetry({
            ...retryContext,
            delayMs: actualDelay,
          });
        }

        // Log retry attempt if logger is provided
        if (resolvedConfig.logger) {
          const level = resolvedConfig.retryLogLevel!;
          const logFn = resolvedConfig.logger[level] ?? resolvedConfig.logger.info;
          if (logFn) {
            logFn(`Retry attempt ${attempt} failed, retrying in ${actualDelay}ms`, {
              attempt,
              error: lastError instanceof Error ? lastError.message : String(lastError),
              delayMs: actualDelay,
              elapsedTimeMs: Date.now() - startTime,
            });
          }
        }

        if (actualDelay > 0) {
          await new Promise(r => setTimeout(r, actualDelay));
          previousDelayMs = actualDelay;
        }

        attempt++;
      }
    }

    // Log final failure if logger is provided
    if (resolvedConfig.logger?.error) {
      resolvedConfig.logger.error(`Failed after ${attempt} attempts`, {
        attempts: attempt,
        error: lastError instanceof Error ? lastError.message : String(lastError),
        elapsedTimeMs: Date.now() - startTime,
      });
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

function validateConfig(config: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; timeoutMs: number }): void {
  if (config.maxAttempts < 1) throw new RangeError('maxAttempts must be ≥1');
  if (config.baseDelayMs < 0) throw new RangeError('baseDelayMs must be ≥0');
  if (config.maxDelayMs < 0) throw new RangeError('maxDelayMs must be ≥0');
  if (config.baseDelayMs > config.maxDelayMs) {
    throw new RangeError('baseDelayMs cannot exceed maxDelayMs');
  }
  if (config.timeoutMs < 0) throw new RangeError('timeoutMs must be ≥0');
}
