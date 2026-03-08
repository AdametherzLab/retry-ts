import { describe, it, expect } from 'bun:test';
import { retry, RetryError, matchesErrorFilter } from '../src/index.ts';

describe('retry', () => {
  it('returns immediately on first successful attempt', async () => {
    let calls = 0;
    const successfulFn = () => { calls++; return Promise.resolve('data') };
    
    const result = await retry(successfulFn, { maxAttempts: 3 });
    
    expect(result.value).toBe('data');
    expect(calls).toBe(1);
  });

  it('retries correct number of times before success', async () => {
    let attempts = 0;
    const failingThenSuccess = () => {
      attempts++;
      return attempts === 3 ? Promise.resolve('ok') : Promise.reject(new Error('error'));
    };

    const result = await retry(failingThenSuccess, { maxAttempts: 3 });
    
    expect(result.value).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('throws RetryError with attempt count after max retries', async () => {
    const alwaysFails = () => Promise.reject(new Error('nope'));
    
    try {
      await retry(alwaysFails, { maxAttempts: 3, baseDelayMs: 1 });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(RetryError);
      expect((err as RetryError).attempts).toBe(3);
      expect((err as RetryError).message).toContain('3');
    }
  });

  it('aborts retries immediately when signal is triggered', async () => {
    const controller = new AbortController();
    let calls = 0;
    const failingFn = () => {
      calls++;
      controller.abort();
      return Promise.reject(new Error('abort me'));
    };

    try {
      await retry(failingFn, {
        maxAttempts: 5,
        abortSignal: controller.signal,
        baseDelayMs: 1,
      });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(RetryError);
    }
    
    expect(calls).toBe(1);
  });
});

describe('retryOn - error filtering', () => {
  class NetworkError extends Error {
    constructor(msg = 'network failure') { super(msg); this.name = 'NetworkError'; }
  }
  class ValidationError extends Error {
    constructor(msg = 'invalid input') { super(msg); this.name = 'ValidationError'; }
  }
  class AuthError extends Error {
    constructor(msg = 'unauthorized') { super(msg); this.name = 'AuthError'; }
  }

  it('retries when error matches retryOn class', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 3) return Promise.reject(new NetworkError());
      return Promise.resolve('ok');
    };

    const result = await retry(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      retryOn: NetworkError,
    });

    expect(result.value).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('fails immediately when error does not match retryOn', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      return Promise.reject(new ValidationError());
    };

    try {
      await retry(fn, {
        maxAttempts: 5,
        baseDelayMs: 1,
        retryOn: NetworkError,
      });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(RetryError);
      expect((err as RetryError).attempts).toBe(1);
      expect((err as RetryError).message).toContain('not retryable');
    }

    expect(attempts).toBe(1);
  });

  it('retryOn with predicate function', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 3) return Promise.reject(new Error('ECONNRESET'));
      return Promise.resolve('recovered');
    };

    const result = await retry(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      retryOn: (e) => e instanceof Error && e.message.includes('ECONNRESET'),
    });

    expect(result.value).toBe('recovered');
    expect(attempts).toBe(3);
  });

  it('retryOn with array of mixed classes and predicates', async () => {
    let attempts = 0;
    const errors = [new NetworkError(), new Error('ETIMEDOUT'), new Error('success trigger')];
    const fn = () => {
      const err = errors[attempts];
      attempts++;
      if (attempts <= 2) return Promise.reject(err);
      return Promise.resolve('done');
    };

    const result = await retry(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      retryOn: [
        NetworkError,
        (e) => e instanceof Error && e.message.includes('ETIMEDOUT'),
      ],
    });

    expect(result.value).toBe('done');
    expect(attempts).toBe(3);
  });
});

describe('abortOn - error filtering', () => {
  class NetworkError extends Error {
    constructor(msg = 'network failure') { super(msg); this.name = 'NetworkError'; }
  }
  class AuthError extends Error {
    constructor(msg = 'unauthorized') { super(msg); this.name = 'AuthError'; }
  }

  it('aborts immediately when error matches abortOn class', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      return Promise.reject(new AuthError());
    };

    try {
      await retry(fn, {
        maxAttempts: 5,
        baseDelayMs: 1,
        abortOn: AuthError,
      });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(RetryError);
      expect((err as RetryError).attempts).toBe(1);
      expect((err as RetryError).message).toContain('non-retryable');
    }

    expect(attempts).toBe(1);
  });

  it('retries normally when error does not match abortOn', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 3) return Promise.reject(new NetworkError());
      return Promise.resolve('ok');
    };

    const result = await retry(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      abortOn: AuthError,
    });

    expect(result.value).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('abortOn takes precedence over retryOn', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      return Promise.reject(new AuthError());
    };

    try {
      await retry(fn, {
        maxAttempts: 5,
        baseDelayMs: 1,
        retryOn: [AuthError, NetworkError],
        abortOn: AuthError,
      });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(RetryError);
      expect((err as RetryError).attempts).toBe(1);
    }

    expect(attempts).toBe(1);
  });

  it('abortOn with predicate function', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      return Promise.reject(new Error('HTTP 403 Forbidden'));
    };

    try {
      await retry(fn, {
        maxAttempts: 5,
        baseDelayMs: 1,
        abortOn: (e) => e instanceof Error && e.message.includes('403'),
      });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(RetryError);
      expect((err as RetryError).attempts).toBe(1);
    }

    expect(attempts).toBe(1);
  });
});

describe('matchesErrorFilter', () => {
  class CustomError extends Error {
    constructor() { super('custom'); this.name = 'CustomError'; }
  }

  it('matches by error class', () => {
    expect(matchesErrorFilter(new CustomError(), CustomError)).toBe(true);
    expect(matchesErrorFilter(new Error('x'), CustomError)).toBe(false);
  });

  it('matches by predicate', () => {
    const filter = (e: unknown) => e instanceof Error && e.message === 'target';
    expect(matchesErrorFilter(new Error('target'), filter)).toBe(true);
    expect(matchesErrorFilter(new Error('other'), filter)).toBe(false);
  });

  it('matches by array of mixed filters', () => {
    const filter = [
      CustomError,
      (e: unknown) => e instanceof Error && e.message === 'special',
    ] as const;
    expect(matchesErrorFilter(new CustomError(), [...filter])).toBe(true);
    expect(matchesErrorFilter(new Error('special'), [...filter])).toBe(true);
    expect(matchesErrorFilter(new Error('nope'), [...filter])).toBe(false);
  });
});

describe('combined retryOn + shouldRetry', () => {
  class TransientError extends Error {
    constructor(public code: number) { super(`transient ${code}`); this.name = 'TransientError'; }
  }

  it('shouldRetry can further restrict retryOn matches', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      return Promise.reject(new TransientError(attempts === 1 ? 500 : 429));
    };

    try {
      await retry(fn, {
        maxAttempts: 5,
        baseDelayMs: 1,
        retryOn: TransientError,
        shouldRetry: ({ error }) => {
          // Only retry 500s, not 429s
          return (error as TransientError).code === 500;
        },
      });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(RetryError);
      // Attempt 1: TransientError(500) -> matches retryOn, shouldRetry=true -> retry
      // Attempt 2: TransientError(429) -> matches retryOn, shouldRetry=false -> stop
      expect((err as RetryError).attempts).toBe(2);
    }

    expect(attempts).toBe(2);
  });
});
