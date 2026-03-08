# retry-ts 🔄

[![CI](https://github.com/AdametherzLab/retry-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AdametherzLab/retry-ts/actions) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Type-Safe Retries with Exponential Backoff, Jitter, and Abort Support**  
Because sometimes third time's the charm, but you need proper type safety while waiting! ⏳

## Features ✅

- 🚀 Exponential backoff with full TypeScript type safety
- 🎲 Configurable jitter strategies (none, full, equal)
- ⏱ Timeout and AbortController support for precise control
- 🔄 Custom retry conditions for complex error handling
- 🎯 Error filtering with `retryOn` and `abortOn` for granular control
- 📦 Zero dependencies - pure TypeScript/ESM

## Installation

bash
npm install @adametherzlab/retry-ts
# or
bun add @adametherzlab/retry-ts


## ⚡ Quick Start


import { retry, RetryError } from '@adametherzlab/retry-ts';

// Basic retry with defaults (3 attempts, 1s base delay)
const result = await retry(() => fetch('https://api.example.com/data'));
console.log(result.value); // Response
console.log(result.attempts); // Number of attempts taken


## 🎯 Error Filtering

Control exactly which errors trigger retries and which fail immediately:

### `retryOn` — Only retry matching errors


class NetworkError extends Error {}
class ValidationError extends Error {}

// Only retry on NetworkError — ValidationError fails immediately
const result = await retry(fetchData, {
  maxAttempts: 5,
  retryOn: NetworkError,
});

// Use a predicate for more control
const result = await retry(fetchData, {
  maxAttempts: 5,
  retryOn: (error) => error instanceof Error && error.message.includes('ECONNRESET'),
});

// Combine classes and predicates in an array
const result = await retry(fetchData, {
  maxAttempts: 5,
  retryOn: [
    NetworkError,
    (e) => e instanceof Error && e.message.includes('ETIMEDOUT'),
  ],
});


### `abortOn` — Immediately fail on matching errors


class AuthError extends Error {}

// Retry anything except auth errors
const result = await retry(fetchData, {
  maxAttempts: 5,
  abortOn: AuthError,
});

// abortOn with predicate
const result = await retry(fetchData, {
  maxAttempts: 5,
  abortOn: (e) => e instanceof Error && e.message.includes('403'),
});

// abortOn takes precedence over retryOn
const result = await retry(fetchData, {
  maxAttempts: 5,
  retryOn: [NetworkError, AuthError],
  abortOn: AuthError, // AuthError still fails immediately
});


### Combining with `shouldRetry`

`retryOn`/`abortOn` filters run first, then `shouldRetry` provides additional logic:


const result = await retry(fetchData, {
  maxAttempts: 5,
  retryOn: TransientError,
  shouldRetry: ({ error, attempt }) => {
    // Only retry 500s, not 429s
    return (error as TransientError).statusCode === 500;
  },
});


## 🎲 Jitter Strategies


// No jitter (default) — exact exponential backoff
await retry(fn, { jitterStrategy: 'none' });

// Full jitter — random between 0 and computed delay
await retry(fn, { jitterStrategy: 'full' });

// Equal jitter — random between delay/2 and delay
await retry(fn, { jitterStrategy: 'equal' });


## ⏱ Timeout & Abort


// Timeout after 10 seconds total
await retry(fn, { timeoutMs: 10000 });

// External abort control
const controller = new AbortController();
await retry(fn, { abortSignal: controller.signal });
// Later: controller.abort();


## 📖 API Reference

### `retry<T>(operation, config?): Promise<RetryResult<T>>`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Maximum number of attempts |
| `baseDelayMs` | `number` | `1000` | Base delay in ms (doubles each attempt) |
| `maxDelayMs` | `number` | `30000` | Maximum delay cap in ms |
| `timeoutMs` | `number` | `Infinity` | Total timeout across all attempts |
| `jitterStrategy` | `'none' \| 'full' \| 'equal'` | `'none'` | Jitter strategy for delays |
| `abortSignal` | `AbortSignal` | — | External abort signal |
| `shouldRetry` | `(ctx: RetryContext) => boolean \| Promise<boolean>` | `() => true` | Custom retry predicate |
| `retryOn` | `ErrorFilter` | — | Only retry errors matching this filter |
| `abortOn` | `ErrorFilter` | — | Immediately fail on errors matching this filter |

### `ErrorFilter`

`ErrorConstructor | ErrorPredicate | Array<ErrorConstructor | ErrorPredicate>`

### `matchesErrorFilter(error, filter): boolean`

Utility to test if an error matches a given `ErrorFilter`.

### `RetryResult<T>`


{ value: T; attempts: number; elapsedTimeMs: number }


### `RetryError`

Thrown when retries are exhausted. Properties: `cause`, `attempts`, `elapsedTimeMs`.

## License

MIT
