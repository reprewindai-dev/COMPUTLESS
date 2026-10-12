import fs from 'fs';
import path from 'path';
import type { StoredVkgPackage, VkgPackage } from '../types.js';
import { createDefaultVkgPackages } from './vkgEngine.js';

/**
 * Local store for .vkg packages.
 *
 * Built-in packages are not stored: they are built from the repo source on
 * every read (vkgEngine.createDefaultVkgPackages). The file holds only
 * packages users uploaded to this server. There are no seed records.
 */
interface DBState {
  schemaVersion: number;
  uploadedVkgPackages: StoredVkgPackage[];
}

/**
 * Bump when record semantics change. A stored file with a different version is
 * discarded (not merged): earlier versions held seeded demo records (nodes,
 * grants, providers, ledger rows, ...) that must never be served again.
 */
export const DB_SCHEMA_VERSION = 3;

const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'substrate_db.json');

export type LoadedFrom = 'disk' | 'empty' | 'empty-after-legacy-reset' | 'empty-after-read-error';

export class DatabaseStore {
  private state: DBState;
  private loadedFrom: LoadedFrom = 'empty';

  constructor() {
    this.state = this.load();
  }

  private load(): DBState {
    const empty: DBState = { schemaVersion: DB_SCHEMA_VERSION, uploadedVkgPackages: [] };
    try {
      if (!fs.existsSync(DB_FILE)) return empty;
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as Partial<DBState>;
      if (parsed.schemaVersion === DB_SCHEMA_VERSION && Array.isArray(parsed.uploadedVkgPackages)) {
        this.loadedFrom = 'disk';
        return { schemaVersion: DB_SCHEMA_VERSION, uploadedVkgPackages: parsed.uploadedVkgPackages };
      }
      console.warn(
        `[DatabaseStore] ${DB_FILE} has schema version ${parsed.schemaVersion ?? 'none'} (expected ${DB_SCHEMA_VERSION}); discarding it.`
      );
      this.loadedFrom = 'empty-after-legacy-reset';
    } catch (err) {
      console.warn(`[DatabaseStore] Failed to read ${DB_FILE}; starting empty:`, err);
      this.loadedFrom = 'empty-after-read-error';
    }
    // Overwrite the legacy/unreadable file so its records cannot come back.
    this.write(empty);
    return empty;
  }

  /** Throws when the file cannot be written. */
  private write(state: DBState): void {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf-8');
  }

  public getLoadedFrom(): LoadedFrom {
    return this.loadedFrom;
  }

  public isBuiltInId(packageId: string): boolean {
    return createDefaultVkgPackages().some((p) => p.manifest.packageId === packageId);
  }

  /** Built-in packages (from repo source) followed by uploaded ones. */
  public getVkgPackages(): StoredVkgPackage[] {
    const builtIns: StoredVkgPackage[] = createDefaultVkgPackages().map((p) => ({ ...p, source: 'built-in' }));
    return [...builtIns, ...this.state.uploadedVkgPackages];
  }

  public getVkgPackage(id: string): StoredVkgPackage | undefined {
    return this.getVkgPackages().find((p) => p.manifest.packageId === id);
  }

  /**
   * Stores (or replaces) an uploaded package and writes the file. Throws when
   * the write fails; the in-memory state is then left unchanged.
   */
  public addUploadedVkgPackage(pkg: VkgPackage): StoredVkgPackage {
    if (this.isBuiltInId(pkg.manifest.packageId)) {
      throw new Error(`'${pkg.manifest.packageId}' is a built-in package id`);
    }
    const stored: StoredVkgPackage = {
      manifest: pkg.manifest,
      dataTables: pkg.dataTables || {},
      actionHandlers: pkg.actionHandlers,
      source: 'uploaded',
      uploadedAt: new Date().toISOString(),
    };
    const next = this.state.uploadedVkgPackages.filter((p) => p.manifest.packageId !== stored.manifest.packageId);
    next.push(stored);
    const nextState = { ...this.state, uploadedVkgPackages: next };
    this.write(nextState);
    this.state = nextState;
    return stored;
  }
}

export const dbStore = new DatabaseStore();
