import { describe, it, expect, mock } from 'bun:test';
import { retry, RetryError, computeBackoffDelay } from '../src/index.ts';
import { applyJitter } from '../src/retry.ts';

describe('progress/status callback', () => {
  it('calls onRetry after each failed attempt with correct context', async () => {
    const onRetry = mock((ctx) => {
      expect(ctx.attempt).toBeGreaterThan(0);
      expect(ctx.error).toBeInstanceOf(Error);
      expect(ctx.elapsedTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof ctx.delayMs).toBe('number');
    });

    let callCount = 0;
    try {
      await retry(
        async () => {
          callCount++;
          throw new Error(`fail ${callCount}`);
        },
        {
          maxAttempts: 3,
          baseDelayMs: 10,
          backoffStrategy: 'fixed',
          jitterStrategy: 'none',
          onRetry,
        }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RetryError);
    }

    expect(callCount).toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    
    // First call should be after attempt 1
    expect(onRetry.mock.calls[0][0].attempt).toBe(1);
    expect(onRetry.mock.calls[0][0].error.message).toBe('fail 1');
    expect(onRetry.mock.calls[0][0].delayMs).toBe(10);
    
    // Second call should be after attempt 2
    expect(onRetry.mock.calls[1][0].attempt).toBe(2);
    expect(onRetry.mock.calls[1][0].error.message).toBe('fail 2');
    expect(onRetry.mock.calls[1][0].delayMs).toBe(10);
  });

  it('does not call onRetry when operation succeeds on first attempt', async () => {
    const onRetry = mock(() => {});
    
    const result = await retry(
      async () => 'success',
      {
        maxAttempts: 3,
        onRetry,
      }
    );

    expect(result.value).toBe('success');
    expect(result.attempts).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('awaits async onRetry callback before proceeding', async () => {
    let callbackCompleted = false;
    const onRetry = mock(async (ctx) => {
      await new Promise(resolve => setTimeout(resolve, 20));
      callbackCompleted = true;
    });

    let attemptCount = 0;
    try {
      await retry(
        async () => {
          attemptCount++;
          if (attemptCount === 1) {
            throw new Error('first fail');
          }
          // Check that callback completed before second attempt
          expect(callbackCompleted).toBe(true);
          return 'success';
        },
        {
          maxAttempts: 3,
          baseDelayMs: 5,
          backoffStrategy: 'fixed',
          jitterStrategy: 'none',
          onRetry,
        }
      );
    } catch (error) {
      // Should not reach here
      expect(true).toBe(false);
    }

    expect(attemptCount).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(callbackCompleted).toBe(true);
  });

  it('provides correct delayMs with exponential backoff', async () => {
    const delays: number[] = [];
    const onRetry = mock((ctx) => {
      delays.push(ctx.delayMs);
    });

    try {
      await retry(
        async () => {
          throw new Error('fail');
        },
        {
          maxAttempts: 4,
          baseDelayMs: 100,
          backoffStrategy: 'exponential',
          jitterStrategy: 'none',
          onRetry,
        }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RetryError);
    }

    expect(onRetry).toHaveBeenCalledTimes(3);
    // Attempt 1: delay = 100 * 2^0 = 100
    expect(delays[0]).toBe(100);
    // Attempt 2: delay = 100 * 2^1 = 200
    expect(delays[1]).toBe(200);
    // Attempt 3: delay = 100 * 2^2 = 400
    expect(delays[2]).toBe(400);
  });

  it('includes previousDelayMs in callback context', async () => {
    const contexts: Array<{ attempt: number; previousDelayMs: number; delayMs: number }> = [];
    const onRetry = mock((ctx) => {
      contexts.push({
        attempt: ctx.attempt,
        previousDelayMs: ctx.previousDelayMs,
        delayMs: ctx.delayMs,
      });
    });

    try {
      await retry(
        async () => {
          throw new Error('fail');
        },
        {
          maxAttempts: 3,
          baseDelayMs: 50,
          backoffStrategy: 'fixed',
          jitterStrategy: 'none',
          onRetry,
        }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RetryError);
    }

    expect(contexts).toHaveLength(2);
    // First retry: previousDelayMs should be 0 (no previous delay)
    expect(contexts[0].attempt).toBe(1);
    expect(contexts[0].previousDelayMs).toBe(0);
    expect(contexts[0].delayMs).toBe(50);
    
    // Second retry: previousDelayMs should be 50 (from first retry)
    expect(contexts[1].attempt).toBe(2);
    expect(contexts[1].previousDelayMs).toBe(50);
    expect(contexts[1].delayMs).toBe(50);
  });

  it('does not call onRetry when shouldRetry returns false', async () => {
    const onRetry = mock(() => {});
    
    try {
      await retry(
        async () => {
          throw new Error('fail');
        },
        {
          maxAttempts: 5,
          shouldRetry: (ctx) => ctx.attempt < 2, // Only retry once
          onRetry,
        }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RetryError);
    }

    // onRetry should only be called once (after attempt 1, before attempt 2)
    // When attempt 2 fails, shouldRetry returns false, so we don't retry and don't call onRetry
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('custom jitter functions', () => {
  it('applies custom jitter function', () => {
    const customJitter = mock((delay: number) => delay * 1.5);
    const result = applyJitter(100, customJitter, 0, 1000);
    
    expect(customJitter).toHaveBeenCalledWith(100, 0, 1000);
    expect(result).toBe(150);
  });

  it('caps custom jitter results at maxDelayMs', () => {
    const customJitter = mock((delay: number) => delay + 500);
    const result = applyJitter(100, customJitter, 0, 300);
    
    expect(result).toBe(300);
  });

  it('integrates with retry flow', async () => {
    const customJitter = mock((delay: number) => delay * 2);
    const delays: number[] = [];
    
    // Mock setTimeout to capture delays
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = ((callback: (...args: any[]) => void, ms?: number) => {
      if (typeof ms === 'number') delays.push(ms);
      return originalSetTimeout(callback, ms);
    }) as any;

    try {
      await retry(
        async () => {
          throw new Error('fail');
        },
        {
          maxAttempts: 3,
          baseDelayMs: 10,
          jitterStrategy: customJitter,
          backoffStrategy: 'fixed',
        }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RetryError);
    } finally {
      global.setTimeout = originalSetTimeout;
    }

    // First delay: 10ms * 2 = 20ms (attempt 1)
    // Second delay: 10ms * 2 = 20ms (attempt 2)
    expect(delays).toEqual([20, 20]);
    expect(customJitter).toHaveBeenCalledTimes(2);
  });
});

describe('logger integration', () => {
  it('logs retry attempts at warn level by default', async () => {
    const logger = {
      warn: mock(() => {}),
      error: mock(() => {}),
    };
    
    try {
      await retry(
        async () => { throw new Error('fail'); },
        { maxAttempts: 3, baseDelayMs: 10, backoffStrategy: 'fixed', jitterStrategy: 'none', logger }
      );
    } catch (e) {
      // expected
    }
    
    expect(logger.warn).toHaveBeenCalledTimes(2); // attempts 1 and 2
    expect(logger.warn.mock.calls[0][0]).toContain('Retry attempt 1 failed');
    expect(logger.warn.mock.calls[0][1]).toMatchObject({ attempt: 1, delayMs: 10 });
    expect(logger.warn.mock.calls[1][0]).toContain('Retry attempt 2 failed');
    expect(logger.warn.mock.calls[1][1]).toMatchObject({ attempt: 2, delayMs: 10 });
  });

  it('logs final failure at error level', async () => {
    const logger = {
      error: mock(() => {}),
    };
    
    try {
      await retry(
        async () => { throw new Error('final fail'); },
        { maxAttempts: 2, baseDelayMs: 10, backoffStrategy: 'fixed', jitterStrategy: 'none', logger }
      );
    } catch (e) {
      expect(e).toBeInstanceOf(RetryError);
    }
    
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain('Failed after 2 attempts');
    expect(logger.error.mock.calls[0][1]).toMatchObject({ attempts: 2, error: 'final fail' });
  });

  it('respects retryLogLevel configuration', async () => {
    const logger = {
      info: mock(() => {}),
      warn: mock(() => {}),
    };
    
    try {
      await retry(
        async () => { throw new Error('fail'); },
        { maxAttempts: 2, baseDelayMs: 10, backoffStrategy: 'fixed', jitterStrategy: 'none', logger, retryLogLevel: 'info' }
      );
    } catch (e) {
      // expected
    }
    
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0][0]).toContain('Retry attempt 1 failed');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs success when logSuccess is enabled', async () => {
    const logger = {
      info: mock(() => {}),
    };
    
    const result = await retry(
      async () => 'success',
      { maxAttempts: 3, logger, logSuccess: true }
    );
    
    expect(result.value).toBe('success');
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0][0]).toContain('succeeded');
    expect(logger.info.mock.calls[0][1]).toMatchObject({ attempts: 1 });
  });

  it('works alongside onRetry callback', async () => {
    const logger = { warn: mock(() => {}) };
    const onRetry = mock(() => {});
    
    try {
      await retry(
        async () => { throw new Error('fail'); },
        { maxAttempts: 2, baseDelayMs: 10, backoffStrategy: 'fixed', jitterStrategy: 'none', logger, onRetry }
      );
    } catch (e) {}
    
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('falls back to info if specified log level is not available on logger', async () => {
    const logger = {
      info: mock(() => {}),
    };
    
    try {
      await retry(
        async () => { throw new Error('fail'); },
        { maxAttempts: 2, baseDelayMs: 10, backoffStrategy: 'fixed', jitterStrategy: 'none', logger, retryLogLevel: 'warn' }
      );
    } catch (e) {}
    
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('does not log success when logSuccess is false (default)', async () => {
    const logger = {
      info: mock(() => {}),
    };
    
    await retry(
      async () => 'success',
      { maxAttempts: 3, logger }
    );
    
    expect(logger.info).not.toHaveBeenCalled();
  });
});
