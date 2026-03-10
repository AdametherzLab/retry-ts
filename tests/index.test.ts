import { describe, it, expect, mock } from 'bun:test';
import { retry, RetryError, computeBackoffDelay } from '../src/index.ts';
import { applyJitter } from '../src/retry.ts';

describe('retry function', () => {
  it('should succeed on first attempt', async () => {
    const result = await retry(async () => 'success');
    expect(result.value).toBe('success');
    expect(result.attempts).toBe(1);
  });

  it('should retry 3 times before failing', async () => {
    let attempts = 0;
    try {
      await retry(
        async () => {
          attempts++;
          throw new Error('Failed');
        },
        { maxAttempts: 3 }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RetryError);
      expect(attempts).toBe(3);
    }
  });

  it('should respect custom backoff strategy', async () => {
    const delays: number[] = [];
    try {
      await retry(
        async () => {
          throw new Error('Failed');
        },
        {
          maxAttempts: 3,
          baseDelayMs: 100,
          backoffStrategy: 'linear',
          onRetry: ({ delayMs }) => delays.push(delayMs)
        }
      );
    } catch {} // eslint-disable-line no-empty
    
    // Linear backoff: 100, 200
    expect(delays).toEqual([100, 200]);
  });
});

describe('jitter strategies', () => {
  const testJitter = (
    strategy: JitterStrategy,
    expected: number[],
    previousDelayMs = 0
  ) => {
    const baseDelay = 1000;
    const maxDelay = 2000;
    const result = applyJitter(baseDelay, strategy, previousDelayMs, maxDelay);
    expect(result).toBeGreaterThanOrEqual(expected[0]);
    expect(result).toBeLessThanOrEqual(expected[1]);
    expect(result).toBeLessThanOrEqual(maxDelay);
  };

  it('none strategy', () => {
    testJitter('none', [1000, 1000]);
  });

  it('full strategy', () => {
    testJitter('full', [0, 1000]);
  });

  it('equal strategy', () => {
    testJitter('equal', [500, 1000]);
  });

  it('decorrelated strategy (first attempt)', () => {
    testJitter('decorrelated', [0, 1000]);
  });

  it('decorrelated strategy (subsequent attempt)', () => {
    testJitter('decorrelated', [1000, 3000], 500);
  });
});

describe('configurable retry conditions', () => {
  it('retries based on error message', async () => {
    let attempts = 0;
    try {
      await retry(
        async () => {
          attempts++;
          throw new Error(attempts === 1 ? 'retry me' : 'fail');
        },
        {
          maxAttempts: 3,
          shouldRetry: ({ error }) => 
            error instanceof Error && error.message.includes('retry me'),
        }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RetryError);
      expect(attempts).toBe(2);
    }
  });

  it('retries based on error type', async () => {
    class RetryableError extends Error {}
    class NonRetryableError extends Error {}

    let attempts = 0;
    try {
      await retry(
        async () => {
          attempts++;
          if (attempts === 1) throw new RetryableError();
          throw new NonRetryableError();
        },
        {
          maxAttempts: 3,
          shouldRetry: ({ error }) => error instanceof RetryableError,
        }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RetryError);
      expect(error.cause).toBeInstanceOf(NonRetryableError);
      expect(attempts).toBe(2);
    }
  });

  it('uses async shouldRetry function', async () => {
    let attempts = 0;
    try {
      await retry(
        async () => {
          attempts++;
          throw new Error('retry me');
        },
        {
          maxAttempts: 3,
          shouldRetry: async ({ error }) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return error instanceof Error && error.message.includes('retry me');
          },
        }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RetryError);
      expect(attempts).toBe(3);
    }
  });
});

describe('error handling', () => {
  it('should throw original error if non-retryable', async () => {
    class NonRetryableError extends Error {}
    
    await expect(() =>
      retry(
        async () => {
          throw new NonRetryableError();
        },
        {
          maxAttempts: 3,
          retryOn: [Error],
          abortOn: [NonRetryableError]
        }
      )
    ).rejects.toThrow(NonRetryableError);
  });
});

describe('computeBackoffDelay', () => {
  it('should calculate exponential backoff', () => {
    expect(computeBackoffDelay('exponential', 1, 100)).toBe(100);
    expect(computeBackoffDelay('exponential', 2, 100)).toBe(200);
    expect(computeBackoffDelay('exponential', 3, 100)).toBe(400);
  });

  it('should calculate linear backoff', () => {
    expect(computeBackoffDelay('linear', 1, 100)).toBe(100);
    expect(computeBackoffDelay('linear', 2, 100)).toBe(200);
    expect(computeBackoffDelay('linear', 3, 100)).toBe(300);
  });

  it('should use fixed backoff', () => {
    expect(computeBackoffDelay('fixed', 1, 100)).toBe(100);
    expect(computeBackoffDelay('fixed', 5, 100)).toBe(100);
  });
});
