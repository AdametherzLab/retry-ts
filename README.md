# retry-ts 🔄

[![CI](https://github.com/AdametherzLab/retry-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AdametherzLab/retry-ts/actions) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Type-Safe Retries with Custom Backoff Strategies, Jitter, and Abort Support**

## Features

- **Custom backoff strategies**: exponential, linear, fixed, or bring your own
- Configurable jitter strategies (none, full, equal)
- Timeout and AbortController support
- Custom retry conditions via `shouldRetry`
- Error filtering with `retryOn` and `abortOn` for granular control
- Zero dependencies — pure TypeScript/ESM

## Installation

bash
bun add @adametherzlab/retry-ts


## Quick Start


import { retry } from '@adametherzlab/retry-ts';

const result = await retry(() => fetch('https://api.example.com/data'), {
  maxAttempts: 3,
  baseDelayMs: 200,
  jitterStrategy: 'full',
});
console.log(result.value);


## Backoff Strategies

Control how delay increases between retries with the `backoffStrategy` option:

### Built-in Strategies


// Exponential (default): 100ms, 200ms, 400ms, 800ms...
await retry(fn, { backoffStrategy: 'exponential', baseDelayMs: 100 });

// Linear: 100ms, 200ms, 300ms, 400ms...
await retry(fn, { backoffStrategy: 'linear', baseDelayMs: 100 });

// Fixed: 100ms, 100ms, 100ms, 100ms...
await retry(fn, { backoffStrategy: 'fixed', baseDelayMs: 100 });


### Custom Backoff Function

Pass a function `(attempt: number, baseDelayMs: number) => number` for full control:


// Quadratic backoff: 50ms, 200ms, 450ms, 800ms...
await retry(fn, {
  baseDelayMs: 50,
  backoffStrategy: (attempt, base) => base * attempt * attempt,
});

// Fibonacci-like backoff
let prev = 0, curr = 1;
await retry(fn, {
  baseDelayMs: 100,
  backoffStrategy: (attempt, base) => {
    const delay = base * curr;
    [prev, curr] = [curr, prev + curr];
    return delay;
  },
});


All strategies respect `maxDelayMs` — the computed delay is always capped.

### `computeBackoffDelay(strategy, attempt, baseDelayMs)`

Utility function to compute a backoff delay outside of `retry()`:


import { computeBackoffDelay } from '@adametherzlab/retry-ts';

computeBackoffDelay('exponential', 3, 100); // 400
computeBackoffDelay('linear', 3, 100);      // 300
computeBackoffDelay('fixed', 3, 100);       // 100


## Error Filtering


import { retry } from '@adametherzlab/retry-ts';

// Only retry network errors
await retry(fn, {
  retryOn: [TypeError, (e) => e instanceof Error && e.message.includes('ECONNRESET')],
});

// Never retry auth errors
await retry(fn, {
  abortOn: [AuthError, (e) => e instanceof Error && e.message.includes('403')],
});


## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Maximum number of attempts |
| `baseDelayMs` | `number` | `1000` | Base delay in milliseconds |
| `maxDelayMs` | `number` | `30000` | Maximum delay cap |
| `timeoutMs` | `number` | `Infinity` | Total timeout across all attempts |
| `backoffStrategy` | `BackoffStrategy` | `'exponential'` | `'exponential'`, `'linear'`, `'fixed'`, or custom function |
| `jitterStrategy` | `JitterStrategy` | `'none'` | `'none'`, `'full'`, or `'equal'` |
| `abortSignal` | `AbortSignal` | — | External abort signal |
| `shouldRetry` | `(ctx) => boolean` | `() => true` | Custom retry predicate |
| `retryOn` | `ErrorFilter` | — | Only retry matching errors |
| `abortOn` | `ErrorFilter` | — | Immediately fail on matching errors |

## License

MIT
