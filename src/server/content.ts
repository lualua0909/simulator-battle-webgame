// CMS content lives in Firestore: one top-level collection per CMS collection (document id =
// content id) plus the `settings/global` document. The server keeps a live copy in memory through
// snapshot listeners, so saves from the CMS and edits in the Firebase Console reach the game without
// a restart. Next.js route handlers and the Socket.IO server load separate module instances in one
// process, so the copy lives on globalThis.
import { createHash } from 'node:crypto';
import type { DocumentData, QuerySnapshot, WriteBatch } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  COLLECTION_SCHEMAS,
  settingsSchema,
  type CollectionDocs,
  type CollectionName,
  type ConfigBundle,
  type ContentBundle,
  type Settings,
} from '@/shared/schema';
import { SEED } from '@/shared/seed';
import { getDb } from './db';
import { firestore } from './firebase';

const SETTINGS_PATH = 'settings/global';
/** While the first load takes longer than this, readers get the built-in content (writes stay refused). */
const LOAD_TIMEOUT_MS = 10_000;
/** Reconnect delay after a failed attempt, doubling up to MAX_RETRY_MS. */
const RETRY_MS = 30_000;
const MAX_RETRY_MS = 10 * 60_000;
/** Firestore caps a batch at 500 writes. */
const BATCH_SIZE = 400;

type AnyDoc = CollectionDocs[CollectionName];

interface Store {
  docs: Record<CollectionName, Map<string, AnyDoc>>;
  settings: Settings | null;
  /** Holds Firestore data; false = serving SEED. */
  loaded: boolean;
  /** Failed connection attempts in a row (only the first is logged). */
  failures: number;
  ready: Promise<void>;
}

const g = globalThis as unknown as { __battleContent?: Store };

// ---------------------------------------------------------------- encoding

const plain = (value: unknown): DocumentData => JSON.parse(JSON.stringify(value));

/** Firestore rejects arrays nested in arrays, which sculpt specs use (lathe profiles, triangles), so `sculpt` is stored as JSON text. */
export function toFirestore(collection: CollectionName, doc: AnyDoc): DocumentData {
  const data = plain(doc);
  if (collection === 'assets' && data.sculpt) data.sculpt = JSON.stringify(data.sculpt);
  return data;
}

/** Validated document with defaults applied, or null (logged) when it is invalid, e.g. after a hand edit in the Console. */
export function parseDoc<K extends CollectionName>(collection: K, id: string, data: DocumentData): CollectionDocs[K] | null {
  const raw: DocumentData = { ...data, id };
  if (collection === 'assets' && typeof raw.sculpt === 'string') {
    try {
      raw.sculpt = JSON.parse(raw.sculpt);
    } catch {
      // left as a string; the schema reports it
    }
  }
  const parsed = COLLECTION_SCHEMAS[collection].safeParse(raw);
  if (parsed.success) return parsed.data as CollectionDocs[K];
  console.error(`Nội dung ${collection}/${id} không hợp lệ, bỏ qua:`, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return null;
}

function parseSettings(data: DocumentData): Settings | null {
  const parsed = settingsSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  console.error(`Nội dung ${SETTINGS_PATH} không hợp lệ, dùng mặc định:`, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return null;
}

// ---------------------------------------------------------------- live copy

function store(): Store {
  if (g.__battleContent) return g.__battleContent;
  const s = { docs: Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])), settings: null, loaded: false, failures: 0 } as unknown as Store;
  g.__battleContent = s;
  s.ready = subscribe(s);
  return s;
}

/** Attaches the listeners. Resolves after the first full load (seeding an empty database), a failure, or LOAD_TIMEOUT_MS. */
function subscribe(s: Store): Promise<void> {
  return new Promise((resolve) => {
    const stops: Array<() => void> = [];
    const waiting = new Set<string>([...COLLECTIONS, SETTINGS_PATH]);
    let hasData = false;
    let failed = false;
    const timer = setTimeout(resolve, LOAD_TIMEOUT_MS);

    const fail = (e: unknown) => {
      if (failed) return;
      failed = true;
      for (const stop of stops) stop();
      if (!s.failures) console.error(`Firestore (nội dung CMS) lỗi, sẽ thử kết nối lại${s.loaded ? '' : ', tạm dùng nội dung mặc định'}:`, e instanceof Error ? e.message : e);
      setTimeout(() => void subscribe(s), Math.min(RETRY_MS * 2 ** s.failures++, MAX_RETRY_MS));
      clearTimeout(timer);
      resolve();
    };
    const received = (name: string) => {
      if (!waiting.delete(name) || waiting.size) return;
      (hasData ? Promise.resolve() : seed(s)).then(() => {
        s.loaded = true;
        clearTimeout(timer);
        resolve();
      }, fail);
    };

    // One read first: it rejects on missing credentials, which listeners would retry silently forever.
    Promise.resolve()
      .then(() => firestore().doc(SETTINGS_PATH).get())
      .then(() => {
        s.failures = 0;
        const db = firestore();
        for (const c of COLLECTIONS) {
          const stop = db.collection(c).onSnapshot((snap) => {
            hasData ||= !snap.empty;
            apply(s, c, snap, waiting.has(c));
            received(c);
          }, fail);
          stops.push(stop);
        }
        const stop = db.doc(SETTINGS_PATH).onSnapshot((snap) => {
          hasData ||= snap.exists;
          s.settings = snap.exists ? parseSettings(snap.data()!) : null;
          received(SETTINGS_PATH);
        }, fail);
        stops.push(stop);
      })
      .catch(fail);
  });
}

function apply(s: Store, collection: CollectionName, snap: QuerySnapshot, first: boolean): void {
  // The first snapshot of a listener lists every document as added.
  if (first) s.docs[collection] = new Map();
  const docs = s.docs[collection];
  for (const change of snap.docChanges()) {
    const doc = change.type === 'removed' ? null : parseDoc(collection, change.doc.id, change.doc.data());
    if (doc) docs.set(doc.id, doc);
    else docs.delete(change.doc.id);
  }
}

/** Fills an empty Firestore once: with the content the CMS kept in SQLite before, or the built-in defaults. */
async function seed(s: Store): Promise<void> {
  const legacy = legacyContent();
  console.log(legacy ? 'Firestore trống: chuyển nội dung CMS từ SQLite sang Firestore' : 'Firestore trống: ghi nội dung CMS mặc định');
  await write(s, legacy ?? SEED);
}

function legacyContent(): ContentBundle | null {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'docs'").get()) return null;
  const rows = db.prepare('SELECT collection, id, data FROM docs ORDER BY id').all() as Array<{ collection: string; id: string; data: string }>;
  if (!rows.length) return null;
  const settings = rows.find((r) => r.collection === 'settings');
  const content = { settings: (settings && parseSettings(JSON.parse(settings.data))) ?? SEED.settings } as ContentBundle;
  for (const c of COLLECTIONS) {
    const docs = rows.filter((r) => r.collection === c).map((r) => parseDoc(c, r.id, JSON.parse(r.data)));
    (content as unknown as Record<string, unknown>)[c] = docs.filter(Boolean);
  }
  return content;
}

/** Replaces all content: deletes documents missing from `content`, writes the rest. */
async function write(s: Store, content: ContentBundle): Promise<void> {
  const db = firestore();
  const ops: Array<(batch: WriteBatch) => void> = [];
  for (const c of COLLECTIONS) {
    const keep = new Set(content[c].map((d) => d.id));
    for (const ref of await db.collection(c).listDocuments()) if (!keep.has(ref.id)) ops.push((b) => b.delete(ref));
    for (const d of content[c]) ops.push((b) => b.set(db.collection(c).doc(d.id), toFirestore(c, d)));
  }
  ops.push((b) => b.set(db.doc(SETTINGS_PATH), plain(content.settings)));
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + BATCH_SIZE)) op(batch);
    await batch.commit();
  }
  for (const c of COLLECTIONS) s.docs[c] = new Map(content[c].map((d) => [d.id, d]));
  s.settings = content.settings;
}

// ---------------------------------------------------------------- API

async function loaded(): Promise<Store | null> {
  const s = store();
  await s.ready;
  return s.loaded ? s : null;
}

async function writable(): Promise<Store> {
  const s = await loaded();
  if (!s) throw new Error('Chưa kết nối được Firestore nên chưa lưu được nội dung CMS');
  return s;
}

export async function listDocs<K extends CollectionName>(collection: K): Promise<CollectionDocs[K][]> {
  const s = await loaded();
  const docs = (s ? [...s.docs[collection].values()] : SEED[collection]) as CollectionDocs[K][];
  return [...docs].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function getDoc<K extends CollectionName>(collection: K, id: string): Promise<CollectionDocs[K] | null> {
  const s = await loaded();
  const doc = s ? s.docs[collection].get(id) : (SEED[collection] as AnyDoc[]).find((d) => d.id === id);
  return (doc as CollectionDocs[K] | undefined) ?? null;
}

export async function putDoc<K extends CollectionName>(collection: K, doc: CollectionDocs[K]): Promise<void> {
  const s = await writable();
  await firestore().collection(collection).doc(doc.id).set(toFirestore(collection, doc));
  s.docs[collection].set(doc.id, doc);
}

export async function deleteDoc(collection: CollectionName, id: string): Promise<boolean> {
  const s = await writable();
  if (!s.docs[collection].has(id)) return false;
  await firestore().collection(collection).doc(id).delete();
  s.docs[collection].delete(id);
  return true;
}

export async function getSettings(): Promise<Settings> {
  return (await loaded())?.settings ?? SEED.settings;
}

export async function putSettings(settings: Settings): Promise<void> {
  const s = await writable();
  await firestore().doc(SETTINGS_PATH).set(plain(settings));
  s.settings = settings;
}

export async function getContent(): Promise<ContentBundle> {
  const content = { settings: await getSettings() } as ContentBundle;
  for (const c of COLLECTIONS) (content as unknown as Record<string, unknown>)[c] = await listDocs(c);
  return content;
}

export function contentVersion(content: ContentBundle): string {
  return createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 12);
}

export async function getBundle(): Promise<ConfigBundle> {
  const content = await getContent();
  return { ...content, version: contentVersion(content) };
}

export async function replaceContent(content: ContentBundle): Promise<void> {
  await write(await writable(), content);
}
