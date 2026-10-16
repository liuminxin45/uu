export function normalizeUuContextReference(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const row = value;
    const text = (key) => typeof row[key] === 'string' && row[key].length <= 4096 ? row[key] : undefined;
    const source = text('source'), entityId = text('entityId');
    if (row.schemaVersion !== 1 || !source || !entityId)
        return undefined;
    return { schemaVersion: 1, source, entityId, ...Object.fromEntries(['sourceIdentity', 'start', 'end', 'revision'].flatMap(key => text(key) ? [[key, text(key)]] : [])) };
}
/** Bounded, ordered reads. The Host owns actual source IO and cancellation. */
export async function mapUuContext(items, read, signal, concurrency = 4) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
        throw new Error('UU_CONTEXT_CONCURRENCY_INVALID');
    const results = new Array(items.length);
    let next = 0;
    let failure;
    await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
        while (next < items.length && failure === undefined) {
            try {
                signal.throwIfAborted();
                const index = next++;
                results[index] = await read(items[index], index);
            }
            catch (error) {
                failure ??= error;
            }
        }
    }));
    if (failure !== undefined)
        throw failure;
    signal.throwIfAborted();
    return results;
}
