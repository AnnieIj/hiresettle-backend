/**
 * Batch function: receives every key requested in one tick and must return
 * one value (or Error) per key, in the same order.
 */
export type BatchLoadFn<K, V> = (keys: readonly K[]) => Promise<ReadonlyArray<V | Error>>;

export interface BatchLoaderOptions {
  /** Split very large batches into chunks of this size (default: unlimited). */
  maxBatchSize?: number;
}

interface PendingLoad<K, V> {
  key: K;
  resolve: (value: V) => void;
  reject: (error: unknown) => void;
}

const resolvedPromise = Promise.resolve();

/**
 * Minimal DataLoader (#515): coalesces every `load()` issued during the same
 * tick into one call to the batch function and memoises results per key.
 *
 * Instances are meant to live for a single GraphQL request (see
 * `createGraphqlLoaders`), so the cache never serves data across users or
 * requests.
 */
export class BatchLoader<K, V> {
  private readonly cache = new Map<K, Promise<V>>();
  private queue: PendingLoad<K, V>[] = [];

  constructor(
    private readonly batchLoadFn: BatchLoadFn<K, V>,
    private readonly options: BatchLoaderOptions = {},
  ) {}

  load(key: K): Promise<V> {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const promise = new Promise<V>((resolve, reject) => {
      this.queue.push({ key, resolve, reject });
      if (this.queue.length === 1) this.scheduleDispatch();
    });
    this.cache.set(key, promise);
    return promise;
  }

  loadMany(keys: readonly K[]): Promise<V[]> {
    return Promise.all(keys.map((key) => this.load(key)));
  }

  /** Seed the cache, e.g. with rows already fetched by a parent resolver. */
  prime(key: K, value: V): this {
    if (!this.cache.has(key)) this.cache.set(key, Promise.resolve(value));
    return this;
  }

  clear(key: K): this {
    this.cache.delete(key);
    return this;
  }

  clearAll(): this {
    this.cache.clear();
    return this;
  }

  /**
   * Dispatch after the current promise jobs settle (like DataLoader), so
   * loads issued by sibling resolvers in the same execution phase share a batch.
   */
  private scheduleDispatch(): void {
    resolvedPromise.then(() => process.nextTick(() => this.dispatch()));
  }

  private dispatch(): void {
    const pending = this.queue;
    this.queue = [];

    const size = this.options.maxBatchSize && this.options.maxBatchSize > 0
      ? this.options.maxBatchSize
      : pending.length;
    for (let i = 0; i < pending.length; i += size) {
      void this.runBatch(pending.slice(i, i + size));
    }
  }

  private async runBatch(batch: PendingLoad<K, V>[]): Promise<void> {
    try {
      const values = await this.batchLoadFn(batch.map((item) => item.key));
      if (!Array.isArray(values) || values.length !== batch.length) {
        throw new TypeError(
          `BatchLoader batch function returned ${values?.length} values for ${batch.length} keys`,
        );
      }
      batch.forEach((item, index) => {
        const value = values[index];
        if (value instanceof Error) {
          this.cache.delete(item.key);
          item.reject(value);
        } else {
          item.resolve(value as V);
        }
      });
    } catch (error) {
      // Don't cache failures, so a later request in the same operation can retry.
      for (const item of batch) {
        this.cache.delete(item.key);
        item.reject(error);
      }
    }
  }
}

/** Order `rows` to match `keys`, filling gaps with null. */
export function alignByKey<K, R>(
  keys: readonly K[],
  rows: readonly R[],
  keyOf: (row: R) => K,
): (R | null)[] {
  const byKey = new Map<K, R>();
  for (const row of rows) byKey.set(keyOf(row), row);
  return keys.map((key) => byKey.get(key) ?? null);
}

/** Group `rows` by key, returning one (possibly empty) array per key. */
export function groupByKey<K, R>(
  keys: readonly K[],
  rows: readonly R[],
  keyOf: (row: R) => K,
): R[][] {
  const groups = new Map<K, R[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return keys.map((key) => groups.get(key) ?? []);
}
