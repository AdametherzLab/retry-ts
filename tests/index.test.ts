import { describe, it, expect, mock } from 'bun:test';
import { retry, RetryError, computeBackoffDelay } from '../src/index.ts';
import { applyJitter } from '../src/retry.ts';

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

// Existing test cases remain unchanged below...
