// Player wallets on Firestore: `players/{uid}` (coins, cards, stars, unlocks, box timers) plus the
// append-only `players/{uid}/ledger`. Only this server writes them (Admin SDK; client rules deny).
// Every change is one transaction: re-read the wallet, apply the pure rule from shared/economy.ts,
// write the wallet and its ledger line together — two concurrent requests cannot spend the same
// coins or open the same box twice. Prices, rewards and time come from the server, never the client.
import { randomInt } from 'node:crypto';
import { FieldValue, Timestamp, type DocumentData, type DocumentReference, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import {
  adjustCoins,
  boxStatus,
  buyCards,
  EconomyError,
  emptyPlayer,
  LEDGER_COLLECTION,
  openBox,
  PLAYERS_COLLECTION,
  playerStateSchema,
  pvpXp,
  startBotBattle,
  unlockUnit,
  upgradeUnit,
  winBotBattle,
  type BoxReward,
  type BoxStatus,
  type Change,
  type LedgerEntry,
  type PlayerAction,
  type PlayerState,
  type Quiet,
} from '@/shared/economy';
import type { BattleOutcome } from '@/shared/net';
import { claimSeasonReward, currentSeason } from '@/shared/ranked';
import type { ContentBundle } from '@/shared/schema';
import { getContent, getSettings } from './content';
import { firestore } from './firebase';

export const players = () => firestore().collection(PLAYERS_COLLECTION);
export const random = () => randomInt(0, 2 ** 32) / 2 ** 32;

export interface PlayerView {
  player: PlayerState;
  boxes: BoxStatus;
}

export type LedgerLine = LedgerEntry & { id: string; at: number | null };

export function parse(data: DocumentData | undefined): PlayerState {
  if (!data) return emptyPlayer();
  const parsed = playerStateSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  console.error('Ví người chơi không hợp lệ:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  throw new EconomyError('Dữ liệu ví không hợp lệ, hãy liên hệ quản trị viên');
}

export async function getPlayer(uid: string): Promise<PlayerState> {
  return parse((await players().doc(uid).get()).data());
}

export async function getPlayerView(uid: string): Promise<PlayerView> {
  const [player, settings] = await Promise.all([getPlayer(uid), getSettings()]);
  return { player, boxes: boxStatus(player, settings.economy, Date.now()) };
}

/** Writes a wallet read in `tx` (as `snap`) with its change, plus the ledger line when coins or cards moved. */
export function writeChange(tx: Transaction, ref: DocumentReference, snap: DocumentSnapshot, out: Change | Quiet): void {
  tx.set(ref, { ...out.state, createdAt: snap.get('createdAt') ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  // Firestore refuses undefined fields.
  if ('entry' in out) tx.create(ref.collection(LEDGER_COLLECTION).doc(), { ...JSON.parse(JSON.stringify(out.entry)), at: FieldValue.serverTimestamp() });
}

/** Runs one change in a transaction; the rule may throw EconomyError (nothing is written then). */
async function change(uid: string, rule: (player: PlayerState, content: ContentBundle, now: number) => Change | Quiet): Promise<PlayerView & { reward?: BoxReward }> {
  const content = await getContent();
  const now = Date.now();
  const ref = players().doc(uid);
  const result = await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const out = rule(parse(snap.data()), content, now);
    writeChange(tx, ref, snap, out);
    return out;
  });
  return { player: result.state, boxes: boxStatus(result.state, content.settings.economy, now), reward: 'reward' in result ? result.reward : undefined };
}

function unitOf(content: ContentBundle, unitId: string) {
  const unit = content.units.find((u) => u.id === unitId);
  if (!unit) throw new EconomyError('Lính không tồn tại');
  return unit;
}

function botOf(content: ContentBundle, botId: string) {
  const bot = content.bots.find((b) => b.id === botId);
  if (!bot) throw new EconomyError('Bot không tồn tại');
  return bot;
}

export function runPlayerAction(uid: string, action: PlayerAction): Promise<PlayerView & { reward?: BoxReward }> {
  switch (action.action) {
    case 'open-box':
      return change(uid, (p, c, now) => openBox(p, action.kind, c.units, c.settings.economy, now, random));
    case 'bot-start':
      return change(uid, (p, c, now) => startBotBattle(p, botOf(c, action.botId), action.botCount, now));
    case 'bot-win':
      return change(uid, (p, c, now) => winBotBattle(p, c.bots, c.units, c.settings.economy, now, random));
    case 'rank-claim':
      return change(uid, (p, c, now) => claimSeasonReward(p, currentSeason(c.settings.ranked, now), c.settings.ranked, c.units, random));
    case 'unlock':
      return change(uid, (p, c) => unlockUnit(p, unitOf(c, action.unitId)));
    case 'upgrade':
      return change(uid, (p, c) => upgradeUnit(p, unitOf(c, action.unitId)));
    case 'buy-cards':
      return change(uid, (p, c) => buyCards(p, unitOf(c, action.unitId), action.count));
  }
}

/** XP for one side of a finished online battle (no coins or cards move, so no ledger line). */
export async function awardBattleXp(uid: string, outcome: BattleOutcome, durationMs: number): Promise<PlayerState> {
  return (await change(uid, (p, c) => ({ state: { ...p, xp: p.xp + pvpXp(outcome, durationMs, c.settings.economy) } }))).player;
}

/** Admin top-up or correction, recorded with the admin's uid and note. */
export function adjustPlayerCoins(uid: string, delta: number, note: string, by: string): Promise<PlayerView> {
  return change(uid, (p) => adjustCoins(p, delta, note, by));
}

export async function listLedger(uid: string, limit = 50): Promise<LedgerLine[]> {
  const snap = await players().doc(uid).collection(LEDGER_COLLECTION).orderBy('at', 'desc').limit(limit).get();
  return snap.docs.map((d) => {
    const { at, ...entry } = d.data();
    return { ...(entry as LedgerEntry), id: d.id, at: at instanceof Timestamp ? at.toMillis() : null };
  });
}

/** Removes the wallet and its ledger (account deletion). */
export async function deletePlayer(uid: string): Promise<void> {
  await firestore().recursiveDelete(players().doc(uid));
}
