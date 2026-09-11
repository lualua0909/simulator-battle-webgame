// SQLite document store for CMS content (one row per document).
// Shared by Next.js route handlers and the Socket.IO server; both run in one Node
// process but load separate module instances, so the connection lives on globalThis.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  COLLECTIONS,
  type CollectionDocs,
  type CollectionName,
  type ConfigBundle,
  type ContentBundle,
  type Settings,
} from '@/shared/schema';
import { SEED } from '@/shared/seed';

type DB = Database.Database;

const store = globalThis as unknown as { __battleDb?: DB };

export function getDb(): DB {
  return (store.__battleDb ??= open());
}

function open(): DB {
  const file = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'game.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS docs (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (collection, id)
  )`);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM docs').get() as { n: number };
  if (n === 0) write(db, SEED);
  return db;
}

function write(db: DB, content: ContentBundle): void {
  const insert = db.prepare('INSERT INTO docs (collection, id, data, updated_at) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM docs').run();
    const now = Date.now();
    for (const c of COLLECTIONS) for (const d of content[c]) insert.run(c, d.id, JSON.stringify(d), now);
    insert.run('settings', 'global', JSON.stringify(content.settings), now);
  })();
}

export function listDocs<K extends CollectionName>(collection: K): CollectionDocs[K][] {
  const rows = getDb().prepare('SELECT data FROM docs WHERE collection = ? ORDER BY id').all(collection) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data));
}

export function getDoc<K extends CollectionName>(collection: K, id: string): CollectionDocs[K] | null {
  const row = getDb().prepare('SELECT data FROM docs WHERE collection = ? AND id = ?').get(collection, id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function putDoc<K extends CollectionName>(collection: K, doc: CollectionDocs[K]): void {
  getDb()
    .prepare(
      `INSERT INTO docs (collection, id, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(collection, doc.id, JSON.stringify(doc), Date.now());
}

export function deleteDoc(collection: CollectionName, id: string): boolean {
  return getDb().prepare('DELETE FROM docs WHERE collection = ? AND id = ?').run(collection, id).changes > 0;
}

export function getSettings(): Settings {
  const row = getDb().prepare("SELECT data FROM docs WHERE collection = 'settings' AND id = 'global'").get() as { data: string } | undefined;
  return row ? JSON.parse(row.data) : SEED.settings;
}

export function putSettings(settings: Settings): void {
  getDb()
    .prepare(
      `INSERT INTO docs (collection, id, data, updated_at) VALUES ('settings', 'global', ?, ?)
       ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(settings), Date.now());
}

export function getContent(): ContentBundle {
  const content = { settings: getSettings() } as ContentBundle;
  for (const c of COLLECTIONS) (content as unknown as Record<string, unknown>)[c] = listDocs(c);
  return content;
}

export function contentVersion(content: ContentBundle): string {
  return createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 12);
}

export function getBundle(): ConfigBundle {
  const content = getContent();
  return { ...content, version: contentVersion(content) };
}

export function replaceContent(content: ContentBundle): void {
  write(getDb(), content);
}
