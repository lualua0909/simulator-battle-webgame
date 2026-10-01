// Full unit suggestions are stored in Firestore; only the server can access them.
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { UNIT_REQUEST_DAILY_LIMIT, UNIT_REQUESTS_COLLECTION } from '@/shared/unitRequest';
import { firestore } from './firebase';

export class UnitRequestError extends Error {}

const requests = () => firestore().collection(UNIT_REQUESTS_COLLECTION);

/** Persist the image and description, with an atomic rolling 24-hour limit. */
export async function sendUnitRequest(uid: string, email: string | null, displayName: string | null, image: string, description: string): Promise<void> {
  const db = firestore();
  const ref = requests().doc();
  const limitRef = db.collection('unitRequestLimits').doc(uid);
  await db.runTransaction(async (tx) => {
    const now = Date.now();
    const since = now - 24 * 3600 * 1000;
    const limit = await tx.get(limitRef);
    // Include requests from the previous email flow when initializing the counter.
    const timestamps: unknown[] = limit.exists
      ? limit.get('timestamps') ?? []
      : (await tx.get(requests().where('uid', '==', uid).select('createdAt'))).docs.map((doc) => doc.get('createdAt'));
    const recent = timestamps.filter((at): at is Timestamp => at instanceof Timestamp && at.toMillis() >= since);
    if (recent.length >= UNIT_REQUEST_DAILY_LIMIT) throw new UnitRequestError('limit');
    tx.set(ref, { uid, email, displayName, image, description, status: 'pending', createdAt: FieldValue.serverTimestamp() });
    tx.set(limitRef, { timestamps: [...recent, Timestamp.fromMillis(now)] });
  });
}

/** Latest suggestions, loaded directly from Firestore on each admin page visit. */
export async function listUnitRequests() {
  const snap = await requests().orderBy('createdAt', 'desc').limit(50).get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      uid: String(data.uid ?? ''),
      email: data.email as string | null,
      displayName: data.displayName as string | null,
      image: typeof data.image === 'string' ? data.image : null,
      description: String(data.description ?? ''),
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : null,
    };
  });
}
