# retry-ts 🔄

[![CI](https://github.com/AdametherzLab/retry-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AdametherzLab/retry-ts/actions) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Type-Safe Retries with Exponential Backoff, Jitter, and Abort Support**

## Features

- Exponential backoff with full TypeScript type safety
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
console.log(result.value); // Response
console.log(result.attempts); // 1-3


## Error Filtering


import { retry } from '@adametherzlab/retry-ts';

class AuthError extends Error {}
class NetworkError extends Error {}

// Only retry network errors, abort immediately on auth errors
const result = await retry(callApi, {
  maxAttempts: 5,
  retryOn: [NetworkError, (e) => e instanceof Error && e.message.includes('ECONNRESET')],
  abortOn: AuthError,
});


## API

### `retry<T>(operation, config?): Promise<RetryResult<T>>`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Maximum number of attempts |
| `baseDelayMs` | `number` | `1000` | Base delay between retries (ms) |
| `maxDelayMs` | `number` | `30000` | Maximum delay cap (ms) |
| `timeoutMs` | `number` | `Infinity` | Total timeout across all attempts |
| `jitterStrategy` | `'none' \| 'full' \| 'equal'` | `'none'` | Jitter strategy for delay randomization |
| `abortSignal` | `AbortSignal` | — | External abort signal |
| `shouldRetry` | `(ctx: RetryContext) => boolean` | `() => true` | Custom retry predicate |
| `retryOn` | `ErrorFilter` | — | Only retry matching errors |
| `abortOn` | `ErrorFilter` | — | Immediately fail on matching errors (takes precedence over retryOn) |

### `RetryResult<T>`


{ value: T; attempts: number; elapsedTimeMs: number }


### `RetryError`

Thrown when all attempts fail. Properties: `cause`, `attempts`, `elapsedTimeMs`.

### `matchesErrorFilter(error, filter): boolean`

Utility to test if an error matches an `ErrorFilter`.

## License

MIT
