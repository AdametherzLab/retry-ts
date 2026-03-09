# retry-ts 🔄

[![CI](https://github.com/AdametherzLab/retry-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AdametherzLab/retry-ts/actions) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Type-Safe Retries with Custom Backoff Strategies, Jitter, and Abort Support**

## Features

- **Custom backoff strategies**: exponential, linear, fixed, or bring your own
- **Configurable jitter**: none, full, equal, or decorrelated strategies
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
  jitterStrategy: 'decorrelated',
  backoffStrategy: 'exponential'
});


## Jitter Strategies

- `none`: No randomization (exact calculated delay)
- `full`: Random between 0 and calculated delay
- `equal`: Random between delay/2 and delay
- `decorrelated`: Random between current base delay and 3× previous actual delay (adaptive)
