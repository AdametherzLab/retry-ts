import { describe, it, expect, mock } from 'bun:test';
import { retry, RetryError, computeBackoffDelay, CircuitBreaker } from '../src/index.ts';
import { applyJitter } from '../src/retry.ts';

describe('Circuit Breaker', () => {
  it('opens after threshold failures', async () => {
    const cb = new CircuitBreaker(3, 1000);
    let attempts = 0;
    
    const failingOp = async () => {
      attempts++;
      throw new Error('Failure');
    };

    // First call: exhaust all 3 attempts
    try {
      await retry(failingOp, { maxAttempts: 3, circuitBreaker: cb });
    } catch (e) {
      expect(e).toBeInstanceOf(RetryError);
      expect((e as RetryError).message).toContain('Failed after 3 attempts');
    } 

    expect(cb['state']).toBe('open');
    expect(attempts).toBe(3);

    // Next call should be blocked immediately
    try {
      await retry(failingOp, { maxAttempts: 2, circuitBreaker: cb });
    } catch (error) {
      expect(error).toBeInstanceOf(RetryError);
      expect((error as RetryError).message).toContain('Circuit breaker is open');
      expect(attempts).toBe(3); // No new attempts
    }
  });

  it('allows retry after timeout', async () => {
    const cb = new CircuitBreaker(2, 100);
    let attempts = 0;

    const failingOp = async () => {
      attempts++;
      throw new Error('Failure');
    };

    // First call: 2 attempts
    try {
      await retry(failingOp, { maxAttempts: 2, circuitBreaker: cb });
    } catch (e) {
      expect(e).toBeInstanceOf(RetryError);
      expect((e as RetryError).message).toContain('Failed after 2 attempts');
    }

    expect(cb['state']).toBe('open');
    expect(attempts).toBe(2);

    // Wait for timeout
    await new Promise(r => setTimeout(r, 150));

    // Next call: half-open state, should attempt once and fail, then open again
    try {
      await retry(failingOp, { maxAttempts: 2, circuitBreaker: cb });
    } catch (error) {
      expect(error).toBeInstanceOf(RetryError);
      expect((error as RetryError).message).toContain('Failed after 1 attempts'); // Only one attempt in half-open
      expect(attempts).toBe(3); // 1 attempt in half-open
      expect(cb['state']).toBe('open');
    }
  });

  it('resets on successful half-open attempt', async () => {
    const cb = new CircuitBreaker(2, 100);
    let attempts = 0;

    const sometimesWorks = async () => {
      attempts++;
      if (attempts <= 2) throw new Error('Failure'); // Fail first 2 times to open circuit
      return 'success';
    };

    // First call: 2 failures to open circuit
    try {
      await retry(sometimesWorks, { maxAttempts: 2, circuitBreaker: cb });
    } catch (e) {
      expect(e).toBeInstanceOf(RetryError);
      expect((e as RetryError).message).toContain('Failed after 2 attempts');
    }
    expect(cb['state']).toBe('open');
    expect(attempts).toBe(2);

    await new Promise(r => setTimeout(r, 150));

    // Second call: succeeds in half-open
    const result = await retry(sometimesWorks, { maxAttempts: 1, circuitBreaker: cb }); // maxAttempts: 1 to ensure only one attempt in half-open
    expect(result.value).toBe('success');
    expect(cb['state']).toBe('closed');
    expect(attempts).toBe(3); // 2 from first call + 1 successful in half-open
  });

  it('only counts matching errors', async () => {
    class NetworkError extends Error {}
    class ValidationError extends Error {}

    const cb = new CircuitBreaker(2, 1000, [NetworkError]);

    await expect(retry(
      async () => { throw new NetworkError(); },
      { maxAttempts: 1, circuitBreaker: cb }
    )).rejects.toThrow(RetryError);
    expect(cb['failureCount']).toBe(1);
    expect(cb['state']).toBe('closed'); // Not enough failures yet

    await expect(retry(
      async () => { throw new ValidationError(); },
      { maxAttempts: 1, circuitBreaker: cb }
    )).rejects.toThrow(RetryError);
    expect(cb['failureCount']).toBe(1); // ValidationError should not count
    expect(cb['state']).toBe('closed');

    await expect(retry(
      async () => { throw new NetworkError(); },
      { maxAttempts: 1, circuitBreaker: cb }
    )).rejects.toThrow(RetryError);
    expect(cb['failureCount']).toBe(2);
    expect(cb['state']).toBe('open'); // Now it should be open
  });

  it('should not open circuit breaker if maxAttempts is less than failureThreshold', async () => {
    const cb = new CircuitBreaker(5, 1000); // Threshold of 5
    let attempts = 0;

    const failingOp = async () => {
      attempts++;
      throw new Error('Failure');
    };

    // Try 3 times, which is less than the threshold of 5
    try {
      await retry(failingOp, { maxAttempts: 3, circuitBreaker: cb });
    } catch (e) {
      expect(e).toBeInstanceOf(RetryError);
      expect((e as RetryError).message).toContain('Failed after 3 attempts');
    }

    expect(cb['state']).toBe('closed'); // Should still be closed
    expect(cb['failureCount']).toBe(3);
    expect(attempts).toBe(3);

    // Try 2 more times, reaching the threshold
    try {
      await retry(failingOp, { maxAttempts: 2, circuitBreaker: cb });
    } catch (e) {
      expect(e).toBeInstanceOf(RetryError);
      expect((e as RetryError).message).toContain('Failed after 2 attempts');
    }

    expect(cb['state']).toBe('open'); // Now it should be open
    expect(cb['failureCount']).toBe(5);
    expect(attempts).toBe(5);
  });

  it('should reset failure count when circuit breaker closes', async () => {
    const cb = new CircuitBreaker(2, 100);
    let attempts = 0;

    const sometimesWorks = async () => {
      attempts++;
      if (attempts <= 2) throw new Error('Failure'); // Fail first 2 times to open circuit
      return 'success';
    };

    // Open the circuit
    try {
      await retry(sometimesWorks, { maxAttempts: 2, circuitBreaker: cb });
    } catch (e) {
      expect(e).toBeInstanceOf(RetryError);
    }
    expect(cb['state']).toBe('open');
    expect(cb['failureCount']).toBe(2);

    // Wait for timeout to go to half-open
    await new Promise(r => setTimeout(r, 150));

    // Succeed in half-open, should close circuit and reset failure count
    const result = await retry(sometimesWorks, { maxAttempts: 1, circuitBreaker: cb });
    expect(result.value).toBe('success');
    expect(cb['state']).toBe('closed');
    expect(cb['failureCount']).toBe(0); // Failure count should be reset
  });
});
