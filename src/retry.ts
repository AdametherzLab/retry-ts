import { AbortController } from 'node:events';
import type { AbortSignal } from 'node:events';
import type {
  JitterStrategy,
  RetryConfig,
  RetryContext,
  RetryResult,
} from './types.js';
import { RetryError } from './types.js';

/**
 * Executes an async operation with retry capabilities based on exponential backoff and jitter.
 * @param operation - Async function to execute. Receives AbortSignal for cancellation
 * @param config - Configuration for retry behavior
 * @returns Promise resolving to operation result with retry metadata
 * @throws {RetryError} When all attempts fail or operation is aborted/timed out
 * @example
 * const data = await retry(fetchData, { maxAttempts: 3, baseDelayMs: 100 });
 */
export async function retry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  config?: RetryConfig
): Promise<RetryResult<T>> {
  const resolvedConfig: Required<RetryConfig> = {
    maxAttempts: config?.maxAttempts ?? 3,
    baseDelayMs: config?.baseDelayMs ?? 1000,
    maxDelayMs: config?.maxDelayMs ?? 30000,
    timeoutMs: config?.timeoutMs ?? Infinity,
    jitterStrategy: config?.jitterStrategy ?? 'none',
    abortSignal: config?.abortSignal,
    shouldRetry: config?.shouldRetry ?? (() => true),
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
      if (elapsedMs >= resolvedConfig.timeoutMs) {
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

        if (attempt >= resolvedConfig.maxAttempts) break;

        const retryContext: RetryContext = {
          error,
          attempt,
          elapsedTimeMs: Date.now() - startTime,
          previousDelayMs,
        };
        const shouldRetry = await resolvedConfig.shouldRetry(retryContext);
        if (!shouldRetry) break;

        const baseDelay = Math.min(
          resolvedConfig.baseDelayMs * 2 ** (attempt - 1),
          resolvedConfig.maxDelayMs
        );
        const jittered = applyJitter(baseDelay, resolvedConfig.jitterStrategy);
        const remainingTime = resolvedConfig.timeoutMs - (Date.now() - startTime);
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

function applyJitter(delay: number, strategy: JitterStrategy): number {
  switch (strategy) {
    case 'none':
      return delay;
    case 'full':
      return Math.random() * delay;
    case 'equal':
      return delay * 0.5 + Math.random() * delay * 0.5;
    default:
      const exhaustiveCheck: never = strategy;
      throw new Error(`Invalid jitter strategy: ${exhaustiveCheck}`);
  }
}

function validateConfig(config: Required<RetryConfig>): void {
  if (config.maxAttempts < 1) throw new RangeError('maxAttempts must be ≥1');
  if (config.baseDelayMs < 0) throw new RangeError('baseDelayMs must be ≥0');
  if (config.maxDelayMs < 0) throw new RangeError('maxDelayMs must be ≥0');
  if (config.baseDelayMs > config.maxDelayMs) {
    throw new RangeError('baseDelayMs cannot exceed maxDelayMs');
  }
  if (config.timeoutMs < 0) throw new RangeError('timeoutMs must be ≥0');
}