# retry-ts 🔄

[![CI](https://github.com/AdametherzLab/retry-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AdametherzLab/retry-ts/actions) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Type-Safe Retries with Custom Backoff Strategies, Jitter, Abort Support, and Custom Jitter Functions**

## Features

- **Custom retry conditions**: Define precise logic for when to retry based on error type, message, or any custom criteria
- **Custom jitter strategies**: Choose from none, full, equal, decorrelated, or provide your own function
- **Custom backoff strategies**: exponential, linear, fixed, or bring your own
- Timeout and AbortController support
- Error filtering with `retryOn` and `abortOn`
- Zero dependencies — pure TypeScript/ESM

## Advanced Retry Conditions

Control exactly when to retry using the `shouldRetry` predicate:


// Retry only on specific error types/messages
await retry(fetchData, {
  maxAttempts: 5,
  shouldRetry: ({ error, attempt }) => {
    if (error instanceof RateLimitError) return true;
    if (error instanceof NetworkError && attempt < 3) return true;
    return false;
  }
});

// Retry based on error message content
await retry(apiCall, {
  shouldRetry: ({ error }) => 
    error instanceof Error && error.message.includes('retryable')
});

// Async condition check
await retry(databaseQuery, {
  shouldRetry: async ({ error }) => {
    const isRecoverable = await checkErrorRecoverability(error);
    return isRecoverable && attempt < 5;
  }
});


## Installation

bash
bun add @adametherzlab/retry-ts


## Custom Jitter Example


import { retry } from '@adametherzlab/retry-ts';

// Custom jitter that adds ±20% variance
const customJitter = (delay: number) => delay * (0.8 + Math.random() * 0.4);

const result = await retry(unstableOperation, {
  maxAttempts: 5,
  baseDelayMs: 100,
  backoffStrategy: 'exponential',
  jitterStrategy: customJitter
});


// ... rest of existing README content