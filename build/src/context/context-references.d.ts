import type { UuContextReference } from './types.js';
export declare function normalizeUuContextReference(value: unknown): UuContextReference | undefined;
/** Bounded, ordered reads. The Host owns actual source IO and cancellation. */
export declare function mapUuContext<T, R>(items: T[], read: (item: T, index: number) => Promise<R>, signal: AbortSignal, concurrency?: number): Promise<R[]>;
