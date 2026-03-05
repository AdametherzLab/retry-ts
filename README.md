# retry-ts 🔄

[![CI](https://github.com/AdametherzLab/retry-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AdametherzLab/retry-ts/actions) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Type-Safe Retries with Exponential Backoff, Jitter, and Abort Support**  
Because sometimes third time's the charm, but you need proper type safety while waiting! ⏳

## Features ✅

- 🚀 Exponential backoff with full TypeScript type safety
- 🎲 Configurable jitter strategies (none, full, equal)
- ⏱ Timeout and AbortController support for precise control
- 🔄 Custom retry conditions for complex error handling
- 📦 Zero dependencies - pure TypeScript/ESM

## Installation

```bash
npm install @adametherzlab/retry-ts
# or
bun add @adametherzlab/retry-ts
```

## ⚡ Quick Start

```typescript
// REMOVED external import: import { retry, RetryError } from '@adametherzlab/retry-ts';

async function fetchData(): Promise<string> {
  // Your flaky API call here
}

try {
  const result = await retry(fetchData, {
    maxAttempts: 3,
    baseDelayMs: 100,
    jitter: 'FULL'
  });
  console.log('Data:', result.value);
} catch (error) {
  if (error instanceof RetryError) {
    console.error(`Failed after ${error.attempt} attempts`);
  }
}
```

## 🔧 API Reference

### `retry<T>(operation: (signal: AbortSignal) => Promise<T>, config: RetryConfig)`

**Parameters:**
- `maxAttempts`: Total retry attempts (default: `3`)
- `baseDelayMs`: Base delay between attempts in ms (default: `100`)
- `maxDelayMs`: Maximum delay cap (default: `30_000`)
- `timeoutMs`: Total timeout across all attempts (default: `Infinity`)
- `jitter`: Jitter strategy: `'NONE' | 'FULL' | 'EQUAL'` (default: `'FULL'`)
- `signal`: AbortController signal for cancellation
- `shouldRetry`: `(error: unknown) => boolean` custom retry condition
- `onRetry`: `(ctx: RetryContext) => void` retry callback

**Returns:** `Promise<RetryResult<T>>` with:
- `value`: Successful result
- `attempt`: Total attempts made
- `aborted`: If operation was cancelled

## 🎯 Advanced Usage

### Custom Retry Logic + AbortController

```typescript
// REMOVED external import: import { retry, JitterStrategy } from '@adametherzlab/retry-ts';

const controller = new AbortController();

// Cancel after 2 seconds
setTimeout(() => controller.abort(), 2000);

const { value } = await retry(async (signal) => {
  const response = await fetch('https://api.example.com', { signal });
  if (response.status === 429) throw new Error('Rate limited');
  return response.json();
}, {
  maxAttempts: 5,
  baseDelayMs: 200,
  jitter: JitterStrategy.EQUAL,
  shouldRetry: (error) => error.message.includes('Rate limited'),
  signal: controller.signal,
  onRetry: ({ attempt, delay }) => {
    console.log(`Attempt ${attempt}, next delay: ${delay}ms`);
  }
});
```

### Wrapping Fetch with Retries

```typescript
// REMOVED external import: import { retry } from '@adametherzlab/retry-ts';

const resilientFetch = (url: string, init?: RequestInit) =>
  retry(async (signal) => {
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  }, {
    maxAttempts: 4,
    baseDelayMs: 500,
    timeoutMs: 10_000
  });

// Usage
const response = await resilientFetch('https://api.example.com/data');
```

## Jitter Strategies 🎲

- `NONE`: Pure exponential backoff (⚠️ thundering herd risk)
- `FULL`: Random jitter between 0 and base delay (default)
- `EQUAL`: Balanced jitter that preserves average delay

## Error Handling ⚠️

Throws `RetryError` with:
- `attempt`: Final attempt count
- `reason`: Original failure reason
- `errors`: Array of all encountered errors

```typescript
try {
  await retry(/* ... */);
} catch (error) {
  if (error instanceof RetryError) {
    console.error(`Failed after ${error.attempt} attempts:`, error.reason);
  }
}
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT © [AdametherzLab](https://github.com/AdametherzLab)