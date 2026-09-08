import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DispatchError } from './types.ts';
import type { DispatchRecord, DispatchStore } from './types.ts';

/** Node-side only, outside the model workspace. Credentials must remain opaque references. */
export async function createFileDispatchStore(
  directory: string,
): Promise<DispatchStore & { close(): Promise<void>; }> {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (
    !info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0
    || (process.getuid && info.uid !== process.getuid())
  ) throw new DispatchError('unsafe_store_directory');
  const lockPath = join(root, '.writer.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch {
    throw new DispatchError('store_locked');
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  const path = join(root, 'dispatches.json');
  let closed = false;
  let chain = Promise.resolve();
  const records = new Map<string, DispatchRecord>();
  try {
    const fileInfo = await lstat(path);
    if (
      !fileInfo.isFile() || fileInfo.isSymbolicLink() || (fileInfo.mode & 0o077) !== 0
      || (process.getuid && fileInfo.uid !== process.getuid()) || fileInfo.size > 16 * 1024 * 1024
    ) {
      throw new DispatchError('unsafe_store_file');
    }
    const data = JSON.parse(await readFile(path, 'utf8')) as DispatchRecord[];
    if (!Array.isArray(data)) throw new DispatchError('invalid_store');
    for (const record of data) {
      if (
        !record?.input?.id || record.input.id !== record.snapshot?.id
        || records.has(record.input.id)
      ) throw new DispatchError('invalid_store');
      records.set(record.input.id, record);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await lock.close();
      await unlink(lockPath);
      throw error;
    }
  }
  return {
    async load() {
      await chain;
      if (closed) throw new DispatchError('store_closed');
      return structuredClone([...records.values()]);
    },
    async save(record) {
      const copy = structuredClone(record);
      const operation = chain.then(async () => {
        if (closed) throw new DispatchError('store_closed');
        const next = new Map(records);
        next.set(copy.input.id, copy);
        const text = JSON.stringify([...next.values()]);
        if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new DispatchError('store_limit');
        const temporary = join(root, `.${randomUUID()}.tmp`);
        const file = await open(temporary, 'wx', 0o600);
        try {
          await file.writeFile(text);
          await file.sync();
          await file.close();
          await rename(temporary, path);
          const dir = await open(root, 'r');
          try {
            await dir.sync();
          } finally {
            await dir.close();
          }
          records.set(copy.input.id, copy);
        } catch (error) {
          await file.close().catch(() => {});
          await unlink(temporary).catch(() => {});
          throw error;
        }
      });
      chain = operation.catch(() => {});
      await operation;
    },
    async close() {
      await chain;
      if (closed) return;
      closed = true;
      await lock.close();
      await unlink(lockPath);
    },
  };
}
