// SQLite file for img2threejs studio jobs (CMS content lives in Firestore, see content.ts).
// Shared by Next.js route handlers and the Socket.IO server; both run in one Node
// process but load separate module instances, so the connection lives on globalThis.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

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
  return db;
}
