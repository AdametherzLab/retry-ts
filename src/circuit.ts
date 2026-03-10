import { ErrorFilter, matchesErrorFilter } from './types.js';

/**
 * Represents the possible states of a circuit breaker.
 * - `closed`: The circuit is operating normally, allowing requests to pass through.
 * - `open`: The circuit has tripped due to too many failures, blocking requests.
 * - `half-open`: The circuit is attempting to allow a single request to pass through
 *   to check if the underlying service has recovered.
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * Implements the Circuit Breaker pattern to prevent repeated calls to a failing service.
 * It monitors failures and temporarily stops retries after a certain failure threshold,
 * improving system stability and preventing cascading failures.
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly errorFilter?: ErrorFilter;

  /**
   * Creates a new CircuitBreaker instance.
   * @param failureThreshold - The number of consecutive failures that will trip the circuit to 'open'.
   * @param resetTimeoutMs - The time in milliseconds after which the circuit will transition from 'open' to 'half-open'.
   * @param errorFilter - An optional filter to specify which errors should count towards the failure threshold.
   *                      If not provided, all errors will count.
   */
  constructor(failureThreshold: number, resetTimeoutMs: number, errorFilter?: ErrorFilter) {
    if (failureThreshold <= 0) {
      throw new RangeError('failureThreshold must be greater than 0');
    }
    if (resetTimeoutMs <= 0) {
      throw new RangeError('resetTimeoutMs must be greater than 0');
    }
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.errorFilter = errorFilter;
  }

  /**
   * Checks the current state of the circuit breaker and determines if an operation should proceed.
   * @returns 'allow' if the operation can proceed, 'block' if it should be immediately rejected.
   */
  public checkState(): 'allow' | 'block' {
    if (this.state === 'open') {
      const now = Date.now();
      if (now - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'half-open';
        return 'allow'; // Allow one trial request in half-open state
      } else {
        return 'block'; // Still in open state, block the request
      }
    } else if (this.state === 'half-open') {
      // In half-open, allow one request. If it fails, go back to open. If it succeeds, go to closed.
      // For now, we allow it, and the retry logic will handle the single attempt.
      return 'allow';
    }
    return 'allow'; // Closed state, allow all requests
  }

  /**
   * Records a successful operation. If the circuit is 'half-open', it will transition to 'closed'.
   */
  public onSuccess(): void {
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.failureCount = 0; // Reset failure count on success
    }
    if (this.state === 'closed') {
      this.failureCount = 0; // Keep failure count at 0 if already closed
    }
  }

  /**
   * Records a failed operation. Increments the failure count and may trip the circuit to 'open'.
   * @param error - The error that occurred during the operation.
   */
  public onFailure(error: unknown): void {
    if (this.errorFilter && !matchesErrorFilter(error, this.errorFilter)) {
      // If an error filter is provided and the error doesn't match, don't count it.
      return;
    }

    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.state = 'open'; // Failed in half-open, go back to open
      // Failure count is not reset here, it continues from previous failures
    } else if (this.state === 'closed') {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'open';
      }
    }
    // If already in 'open' state, failures don't change its state further
  }

  /**
   * Resets the circuit breaker to the 'closed' state, clearing all failure counts.
   * This can be useful for manual intervention or testing.
   */
  public reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Gets the current state of the circuit breaker.
   * @returns The current CircuitBreakerState.
   */
  public getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Gets the current failure count.
   * @returns The number of consecutive failures.
   */
  public getFailureCount(): number {
    return this.failureCount;
  }
}
