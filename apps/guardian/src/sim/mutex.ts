/** A FIFO async mutex: the fork holds one snapshot at a time, so simulations run one by one. */
export class Mutex {
  #tail: Promise<void> = Promise.resolve();
  #size = 0;

  /** Tasks running or waiting; the API refuses new checks above a cap (P13, see app.ts). */
  get size(): number {
    return this.#size;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.#size++;
    const result = this.#tail.then(task);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    void this.#tail.then(() => this.#size--);
    return result;
  }
}
