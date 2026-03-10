# retry-ts 🔄

[![CI](https://github.com/AdametherzLab/retry-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AdametherzLab/retry-ts/actions) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Type-Safe Retries with Custom Backoff Strategies, Jitter, Abort Support, and Custom Jitter Functions**

## Features

- **Custom jitter strategies**: Choose from none, full, equal, decorrelated, or provide your own function
- **Custom backoff strategies**: exponential, linear, fixed, or bring your own
- Timeout and AbortController support
- Custom retry conditions via `shouldRetry`
- Error filtering with `retryOn` and `abortOn`
- Zero dependencies — pure TypeScript/ESM

## Installation

bash
bun add @adametherzlab/retry-ts


## Custom Jitter Example


import { retry } from '@adametherzlab/retry-ts';

// Custom jitter that adds ±20% variance
const customJitter = (baseDelay: number) => {
  const variance = baseDelay * 0.2;
  return baseDelay - variance + Math.random() * variance * 2;
};

const result = await retry(fetchData, {
  maxAttempts: 5,
  baseDelayMs: 100,
  jitterStrategy: customJitter,
  backoffStrategy: 'exponential'
});


## Key Features

### Custom Jitter Functions
Implement complex backoff strategies with complete control:

// Example ramp-up jitter that increases variance with each attempt
const rampUpJitter = (delay: number, prevDelay: number) => {
  const multiplier = prevDelay === 0 ? 0.1 : 0.5;
  return delay * (multiplier + Math.random() * multiplier);
};

await retry(operation, { jitterStrategy: rampUpJitter });


### Built-in Jitter Strategies
- `none`: No randomization
- `full`: 0 to calculated delay
- `equal`: Delay/2 to delay
- `decorrelated`: Random between base delay and previous delay * 3 (capped at maxDelayMs)

### Backoff Strategies
- Exponential (default)
- Linear
- Fixed
- Custom functions
