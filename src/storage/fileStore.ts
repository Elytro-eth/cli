import { readFile, writeFile, mkdir, access, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { StorageAdapter } from '../types';

/**
 * File-based storage adapter.
 *
 * Each key maps to a JSON file under the data directory.
 * Default root: ~/.elytro/
 *
 * Design note:
 * Extension uses LocalSubscribableStore (chrome.storage + Proxy reactivity).
 * CLI has no UI to react to — a simple read/write-on-demand model is sufficient.
 * Services call load() at startup and save() after mutations.
 */
export class FileStore implements StorageAdapter {
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? join(homedir(), '.elytro');
  }

  private filePath(key: string): string {
    // Allow nested keys like "history/10-0xabc" → ~/.elytro/history/10-0xabc.json
    return join(this.root, `${key}.json`);
  }

  async load<T>(key: string): Promise<T | null> {
    const path = this.filePath(key);
    try {
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async save<T>(key: string, data: T): Promise<void> {
    const path = this.filePath(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await chmod(dirname(path), 0o700).catch(() => {});
    await writeFile(path, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await chmod(path, 0o600).catch(() => {});
  }

  async remove(key: string): Promise<void> {
    const { unlink } = await import('node:fs/promises');
    const path = this.filePath(key);
    try {
      await unlink(path);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const path = this.filePath(key);
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Ensure the root directory exists. Call once at startup. */
  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700).catch(() => {});
  }

  get dataDir(): string {
    return this.root;
  }
}
