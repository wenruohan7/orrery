import { openDB, type IDBPDatabase } from 'idb';
import type { VaultFile } from './types';

let dbp: Promise<IDBPDatabase> | null = null;
function open() {
  dbp ??= openDB('orrery', 1, {
    upgrade(db) {
      db.createObjectStore('files', { keyPath: 'path' });
      db.createObjectStore('kv');
    },
  });
  return dbp;
}

export const db = {
  allFiles: async () => (await open()).getAll('files') as Promise<VaultFile[]>,
  putFile: async (f: VaultFile) => void (await open()).put('files', f),
  deleteFile: async (path: string) => void (await open()).delete('files', path),
  clearFiles: async () => void (await open()).clear('files'),
  get: async <T>(key: string) => (await open()).get('kv', key) as Promise<T | undefined>,
  set: async (key: string, value: unknown) => void (await open()).put('kv', value, key),
};
