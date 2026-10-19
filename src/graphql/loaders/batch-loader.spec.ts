import { alignByKey, BatchLoader, groupByKey } from './batch-loader';

describe('BatchLoader (#515)', () => {
  it('coalesces loads issued in the same tick into one batch call', async () => {
    const batchFn = jest.fn(async (keys: readonly number[]) => keys.map((k) => k * 10));
    const loader = new BatchLoader(batchFn);

    const values = await Promise.all([loader.load(1), loader.load(2), loader.load(3)]);

    expect(values).toEqual([10, 20, 30]);
    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('de-duplicates keys and caches results for the loader lifetime', async () => {
    const batchFn = jest.fn(async (keys: readonly string[]) => keys.map((k) => k.toUpperCase()));
    const loader = new BatchLoader(batchFn);

    await Promise.all([loader.load('a'), loader.load('a'), loader.load('b')]);
    await loader.load('a');

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn).toHaveBeenCalledWith(['a', 'b']);
  });

  it('batches loads issued from chained promises in the same execution phase', async () => {
    const batchFn = jest.fn(async (keys: readonly number[]) => keys);
    const loader = new BatchLoader(batchFn);

    await Promise.all([
      loader.load(1),
      Promise.resolve().then(() => loader.load(2)),
      Promise.resolve().then(() => Promise.resolve()).then(() => loader.load(3)),
    ]);

    expect(batchFn).toHaveBeenCalledTimes(1);
  });

  it('splits batches by maxBatchSize', async () => {
    const batchFn = jest.fn(async (keys: readonly number[]) => keys);
    const loader = new BatchLoader(batchFn, { maxBatchSize: 2 });

    await loader.loadMany([1, 2, 3, 4, 5]);

    expect(batchFn.mock.calls.map((call) => call[0])).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('rejects only the keys whose value is an Error and does not cache failures', async () => {
    let fail = true;
    const batchFn = jest.fn(async (keys: readonly number[]) =>
      keys.map((k) => (k === 2 && fail ? new Error('boom') : k)),
    );
    const loader = new BatchLoader(batchFn);

    const [one, two] = await Promise.allSettled([loader.load(1), loader.load(2)]);
    expect(one).toEqual({ status: 'fulfilled', value: 1 });
    expect(two).toMatchObject({ status: 'rejected', reason: expect.any(Error) });

    fail = false;
    await expect(loader.load(2)).resolves.toBe(2);
    await expect(loader.load(1)).resolves.toBe(1);
    expect(batchFn).toHaveBeenCalledTimes(2);
  });

  it('rejects the whole batch when the batch function returns the wrong length', async () => {
    const loader = new BatchLoader(async () => [1]);

    await expect(Promise.all([loader.load('a'), loader.load('b')])).rejects.toThrow(
      /returned 1 values for 2 keys/,
    );
  });

  it('serves primed values without calling the batch function', async () => {
    const batchFn = jest.fn(async (keys: readonly string[]) => keys);
    const loader = new BatchLoader(batchFn).prime('x', 'primed');

    await expect(loader.load('x')).resolves.toBe('primed');
    expect(batchFn).not.toHaveBeenCalled();
  });
});

describe('alignByKey / groupByKey', () => {
  const rows = [
    { id: 'b', group: 'g1' },
    { id: 'a', group: 'g2' },
    { id: 'c', group: 'g1' },
  ];

  it('aligns rows to the requested key order with nulls for misses', () => {
    expect(alignByKey(['a', 'z', 'b'], rows, (r) => r.id)).toEqual([rows[1], null, rows[0]]);
  });

  it('groups rows per key with empty arrays for misses', () => {
    expect(groupByKey(['g1', 'g3', 'g2'], rows, (r) => r.group)).toEqual([
      [rows[0], rows[2]],
      [],
      [rows[1]],
    ]);
  });
});
