import type { DispatchRecord, DispatchStore } from './types.ts';

/** Volatile by design. Host integrations must supply a protected durable store for restart recovery. */
export function createMemoryDispatchStore(): DispatchStore {
  const records = new Map<string, DispatchRecord>();
  return {
    async load() {
      return structuredClone([...records.values()]);
    },
    async save(record) {
      records.set(record.input.id, structuredClone(record));
    },
  };
}
