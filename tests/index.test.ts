import { describe, it, expect } from 'bun:test';
import { retry, RetryError } from '../src/index.ts';

describe('retry', () => {
  it('returns immediately on first successful attempt', async () => {
    let calls = 0;
    const successfulFn = () => { calls++; return Promise.resolve('data') };
    
    const result = await retry(successfulFn, { maxAttempts: 3 });
    
    expect(result).toBe('data');
    expect(calls).toBe(1);
  });

  it('retries correct number of times before success', async () => {
    let attempts = 0;
    const failingThenSuccess = () => {
      attempts++;
      return attempts === 3 ? Promise.resolve('ok') : Promise.reject('error');
    };

    const result = await retry(failingThenSuccess, { maxAttempts: 3 });
    
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('throws RetryError with attempt count after max retries', async () => {
    const alwaysFails = () => Promise.reject(new Error('nope'));
    
    await expect(retry(alwaysFails, { maxAttempts: 3 }))
      .rejects
      .toMatchObject({
        attempts: 3,
        message: 'Maximum retry attempts (3) exceeded',
      });
  });

  it('aborts retries immediately when signal is triggered', async () => {
    const controller = new AbortController();
    let calls = 0;
    const failingFn = () => {
      calls++;
      controller.abort();
      return Promise.reject(new Error('abort me'));
    };

    await expect(retry(failingFn, {
      maxAttempts: 5,
      signal: controller.signal
    })).rejects.toThrow('The operation was aborted');
    
    expect(calls).toBe(1);
  });

  it('applies exponential backoff with jitter strategy', async () => {
    let lastDelay = 0;
    const delays: number[] = [];
    const trackDelays = () => {
      const now = Date.now();
      if (lastDelay > 0) delays.push(now - lastDelay);
      lastDelay = now;
    };

    const failingFn = async () => {
      trackDelays();
      throw new Error('retry');
    };

    try {
      await retry(failingFn, {
        maxAttempts: 4,
        baseDelayMs: 100,
        jitter: 'none',
        onRetry: trackDelays
      });
    } catch (error) {
      // Expected error after 4 attempts
    }

    // First delay: 100ms, second: 200ms, third: 400ms
    expect(delays.slice(0, 3)).toEqual([100, 200, 400]);
  });
});