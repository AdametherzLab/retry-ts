import { describe, it, expect, mock } from 'bun:test';
import { retry, RetryError, computeBackoffDelay, CircuitBreaker } from '../src/index.ts';
import { applyJitter } from '../src/retry.ts';

describe('Circuit Breaker', () => {
  it('should block requests when circuit is open', () => {
    const breaker = new CircuitBreaker(2, 1000);
    breaker.onFailure(new Error('fail'));
    breaker.onFailure(new Error('fail'));
    
    expect(breaker.checkState()).toBe('block');
    expect(breaker.getState()).toBe('open');
  });

  it('should allow requests when circuit is closed', () => {
    const breaker = new CircuitBreaker(2, 1000);
    expect(breaker.checkState()).toBe('allow');
    expect(breaker.getState()).toBe('closed');
  });

  it('should transition to half-open after reset timeout', async () => {
    const breaker = new CircuitBreaker(2, 10);
    breaker.onFailure(new Error('fail'));
    breaker.onFailure(new Error('fail'));
    expect(breaker.getState()).toBe('open');
    
    await new Promise(r => setTimeout(r, 20));
    expect(breaker.checkState()).toBe('allow');
    expect(breaker.getState()).toBe('half-open');
  });
});

describe('Backoff Strategies', () => {
  it('should use exponential backoff by default', async () => {
    const op = mock(async () => { throw new Error('fail'); });
    const onRetry = mock();
    
    try {
      await retry(op, {
        maxAttempts: 3,
        jitterStrategy: 'none',
        onRetry,
      });
    } catch (e) {}

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0].delayMs).toBe(1000);
    expect(onRetry.mock.calls[1][0].delayMs).toBe(2000);
  });

  it('should allow custom backoff functions', async () => {
    const customBackoff = mock((attempt: number, baseDelayMs: number) => attempt * baseDelayMs);
    const op = mock(async () => { throw new Error('fail'); });
    const onRetry = mock();

    try {
      await retry(op, {
        maxAttempts: 3,
        baseDelayMs: 100,
        backoffStrategy: customBackoff,
        jitterStrategy: 'none',
        onRetry,
      });
    } catch (e) {}

    expect(customBackoff).toHaveBeenCalledTimes(2);
    expect(customBackoff.mock.calls[0][0]).toBe(1);
    expect(customBackoff.mock.calls[0][1]).toBe(100);
    expect(onRetry.mock.calls[0][0].delayMs).toBe(100);
    expect(onRetry.mock.calls[1][0].delayMs).toBe(200);
  });

  it('should handle maxDelayMs cap with custom strategies', async () => {
    const aggressiveBackoff = (attempt: number) => 1000 * (attempt ** 3);
    const op = mock(async () => { throw new Error('fail'); });
    const onRetry = mock();

    try {
      await retry(op, {
        maxAttempts: 4,
        backoffStrategy: aggressiveBackoff,
        maxDelayMs: 5000,
        jitterStrategy: 'none',
        onRetry,
      });
    } catch (e) {}

    expect(onRetry.mock.calls[0][0].delayMs).toBe(1000);
    expect(onRetry.mock.calls[1][0].delayMs).toBe(5000);
    expect(onRetry.mock.calls[2][0].delayMs).toBe(5000);
  });

  it('should support linear backoff strategy', () => {
    expect(computeBackoffDelay('linear', 1, 100)).toBe(100);
    expect(computeBackoffDelay('linear', 2, 100)).toBe(200);
    expect(computeBackoffDelay('linear', 3, 100)).toBe(300);
  });

  it('should support fixed backoff strategy', () => {
    expect(computeBackoffDelay('fixed', 1, 100)).toBe(100);
    expect(computeBackoffDelay('fixed', 5, 100)).toBe(100);
  });
});

describe('Jitter Strategies', () => {
  it('should apply no jitter when strategy is none', () => {
    const result = applyJitter(1000, 'none', 0, 5000);
    expect(result).toBe(1000);
  });

  it('should apply full jitter', () => {
    const result = applyJitter(1000, 'full', 0, 5000);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1000);
  });

  it('should apply equal jitter', () => {
    const result = applyJitter(1000, 'equal', 0, 5000);
    expect(result).toBeGreaterThanOrEqual(500);
    expect(result).toBeLessThanOrEqual(1000);
  });

  it('should respect maxDelayMs cap with jitter', () => {
    const result = applyJitter(10000, 'none', 0, 5000);
    expect(result).toBe(5000);
  });

  it('should support custom jitter functions', () => {
    const customJitter = (delay: number) => delay + 100;
    const result = applyJitter(500, customJitter as any, 0, 5000);
    expect(result).toBe(600);
  });
});

describe('Retry Function', () => {
  it('should succeed on first attempt', async () => {
    const op = mock(async () => 'success');
    const result = await retry(op);
    
    expect(result.value).toBe('success');
    expect(result.attempts).toBe(1);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    let attempts = 0;
    const op = mock(async () => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return 'success';
    });
    
    const result = await retry(op, { maxAttempts: 5, baseDelayMs: 10 });
    expect(result.value).toBe('success');
    expect(result.attempts).toBe(3);
  });

  it('should throw RetryError when all attempts fail', async () => {
    const op = mock(async () => { throw new Error('always fails'); });
    
    await expect(retry(op, { maxAttempts: 3, baseDelayMs: 10 })).rejects.toThrow(RetryError);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('should respect abort signal', async () => {
    const controller = new AbortController();
    const op = mock(async () => { 
      throw new Error('fail'); 
    });
    
    setTimeout(() => controller.abort(), 50);
    
    await expect(retry(op, { 
      maxAttempts: 10, 
      baseDelayMs: 100,
      abortSignal: controller.signal 
    })).rejects.toThrow('aborted');
  });

  it('should use shouldRetry predicate', async () => {
    const op = mock(async () => { throw new Error('special error'); });
    const shouldRetry = mock(() => false);
    
    try {
      await retry(op, { shouldRetry, maxAttempts: 5 });
    } catch (e) {}
    
    expect(shouldRetry).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenCalledTimes(1);
  });
});