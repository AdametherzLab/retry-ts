# retry-ts 🔄

[![CI](https://github.com/AdametherzLab/retry-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AdametherzLab/retry-ts/actions) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Type-Safe Retries with Custom Backoff Strategies, Jitter, Abort Support, and Custom Jitter Functions**

## Installation

bash
bun install retry-ts


Or with npm/yarn/pnpm:

bash
npm install retry-ts
# or
yarn add retry-ts
# or
pnpm add retry-ts


## Features

- **Custom retry conditions**: Define precise logic for when to retry based on error type, message, or any custom criteria
- **Custom jitter strategies**: Choose from none, full, equal, decorrelated, or provide your own function
- **Custom backoff strategies**: exponential, linear, fixed, or bring your own
- Timeout and AbortController support
- Error filtering with `retryOn` and `abortOn`
- Zero dependencies — pure TypeScript/ESM

## Usage

### Basic Retry


import { retry } from 'retry-ts';

const result = await retry(
  async (signal) => {
    // Your async operation here
    return fetch('/api/data', { signal });
  },
  {
    maxAttempts: 3,
    baseDelayMs: 1000,
  }
);


### Custom Backoff Strategy


import { retry } from 'retry-ts';

const result = await retry(
  async () => fetch('/api/data'),
  {
    maxAttempts: 5,
    backoffStrategy: (attempt, baseDelay) => attempt * attempt * baseDelay,
    maxDelayMs: 10000,
  }
);


## Advanced Retry Conditions

Control exactly when to retry using the `shouldRetry` predicate:


const result = await retry(
  async () => fetch('/api/data'),
  {
    maxAttempts: 3,
    shouldRetry: (context) => {
      // Retry only on network errors, not 4xx errors
      return context.error instanceof NetworkError;
    },
  }
);


### Circuit Breaker


import { retry, CircuitBreaker } from 'retry-ts';

const breaker = new CircuitBreaker(3, 30000);

const result = await retry(
  async () => fetch('/api/data'),
  {
    circuitBreaker: breaker,
    maxAttempts: 3,
  }
);
