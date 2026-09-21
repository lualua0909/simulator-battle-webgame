// Player economy: coins (1 coin = 1 VND), unit cards, star upgrades, unlocks and reward boxes.
// Pure rules shared by the server — the only place coins move, inside Firestore transactions
// (src/server/players.ts) — the browser (display, countdowns) and the tests.
import { z } from 'zod';
import { idSchema, RANK_TIERS, STAR_MAX, type BotDef, type BoxConfig, type Economy, type UnitDef } from './schema';

export const PLAYERS_COLLECTION = 'players';
export const LEDGER_COLLECTION = 'ledger';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Box days follow Vietnam time (UTC+7, no daylight saving). */
const VN_OFFSET_MS = 7 * HOUR_MS;

// ---------------------------------------------------------------- state

const count = z.number().int().min(0);

/** Ranked standing in one season (rules in ranked.ts). */
export const rankStateSchema = z.object({
  /** Season id ('s1', 's2', …) of this standing. */
  season: z.string(),
  tier: z.enum(RANK_TIERS),
  /** Class 1 … tier.classes (always 1 in master). */
  cls: z.number().int().min(1),
  diamonds: count,
  /** Master points. */
  points: count.default(0),
  wins: count.default(0),
  losses: count.default(0),
  draws: count.default(0),
  /** Results of this season that were voided because the reports disagreed (too many locks ranked). */
  disputes: count.default(0),
  /** Vietnam date of `rewardsToday` (ranked win boxes). */
  rewardDay: z.string().nullable().default(null),
  rewardsToday: count.default(0),
});

export type RankState = z.infer<typeof rankStateSchema>;

/** `players/{uid}` without timestamps. Invalid stored data is refused, never reset: a reset would wipe the coins. */
export const playerStateSchema = z.object({
  coins: count.default(0),
  /** Unspent cards per unit id. */
  cards: z.record(z.string(), count).default({}),
  /** Star level per unit id. */
  stars: z.record(z.string(), z.number().int().min(0).max(STAR_MAX)).default({}),
  /** Units bought with coins (a unit whose unlockCost is 0 needs no entry). */
  unlocked: z.array(z.string()).default([]),
  /** Vietnam date (YYYY-MM-DD) of the last daily box. */
  dailyDay: z.string().nullable().default(null),
  /** Epoch ms of the last box opened, daily or x-hour: the x-hour countdown starts here. */
  lastBoxAt: z.number().nullable().default(null),
  /** Vietnam date (YYYY-MM-DD) of the Monday whose week `weekClaims` tracks. */
  weekStart: z.string().nullable().default(null),
  /** Which of the 7 VN days (Mon…Sun) of `weekStart`'s week had the daily box claimed. */
  weekClaims: z.array(z.boolean()).length(7).default(() => Array(7).fill(false)),
  /** Epoch ms of the last bot-win reward (anti-farm cooldown, see `economy.botWinCooldown`). */
  lastBotWinAt: z.number().nullable().default(null),
  /** The bot battle the server saw start (bot-start): the next bot-win reward consumes it. */
  botTicket: z.object({ botId: idSchema, botCount: z.number().int().min(1).max(3), at: z.number() }).nullable().default(null),
  /** Vietnam date of `botWinsToday` (see `economy.botWinDailyCap`). */
  botWinDay: z.string().nullable().default(null),
  botWinsToday: count.default(0),
  /** Bot-win rewards ever claimed (ranked entry requirement). */
  botWinTotal: count.default(0),
  /** Ranked standing; null before the first ranked battle. */
  ranked: rankStateSchema.nullable().default(null),
});

export type PlayerState = z.infer<typeof playerStateSchema>;

export function emptyPlayer(): PlayerState {
  return playerStateSchema.parse({});
}

export function isUnlocked(unit: Pick<UnitDef, 'id' | 'unlockCost'>, player: Pick<PlayerState, 'unlocked'> | null): boolean {
  return unit.unlockCost === 0 || Boolean(player?.unlocked.includes(unit.id));
}

/** Cost of the next star, or null at the top. */
export function nextStar(unit: Pick<UnitDef, 'starCards' | 'starCoins'>, star: number): { star: number; cards: number; coins: number } | null {
  if (star >= STAR_MAX) return null;
  return { star: star + 1, cards: unit.starCards[star], coins: unit.starCoins[star] };
}

/** HP and damage multiplier of a star level (used by the deterministic simulation). */
export function starScale(star: number, bonus: number): number {
  return 1 + bonus * Math.max(0, Math.min(STAR_MAX, Math.floor(star)));
}

export function formatCoins(n: number): string {
  return n.toLocaleString('en-US');
}

// ---------------------------------------------------------------- boxes

export type BoxKind = 'daily' | 'hourly';

/** One slot of the 7-day claim calendar (Monday…Sunday of the current Vietnam week). */
export interface WeekSlot {
  /** Vietnam date (YYYY-MM-DD). */
  date: string;
  status: 'claimed' | 'missed' | 'today' | 'future';
}

export interface BoxStatus {
  /** One per Vietnam day; `resetAt` is the next midnight. `week` is always Monday-first, length 7. */
  daily: { ready: boolean; resetAt: number; week: WeekSlot[] };
  /** Unlocked by today's daily box, then ready every `boxHours` after the last box. */
  hourly: { unlocked: boolean; ready: boolean; readyAt: number | null };
}

export function vnDay(ms: number): string {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function nextVnMidnight(ms: number): number {
  return (Math.floor((ms + VN_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - VN_OFFSET_MS;
}

/**
 * Monday-based weekday of a Vietnam calendar instant: 0 = Monday … 6 = Sunday. Epoch day 0
 * (1970-01-01) was a Thursday, hence the +3 (checked against 2026-09-14, the existing `MORNING`
 * test fixture below, which is a Monday: day index 20710, (20710 + 3) % 7 = 0).
 */
function vnWeekday(ms: number): number {
  return (Math.floor((ms + VN_OFFSET_MS) / DAY_MS) + 3) % 7;
}

/** Vietnam date (YYYY-MM-DD) of the Monday of `ms`'s week. */
function vnWeekStart(ms: number): string {
  return vnDay(ms - vnWeekday(ms) * DAY_MS);
}

/** `date` (YYYY-MM-DD) plus `n` calendar days — plain arithmetic, no VN offset needed once it's already a date string. */
function addVnDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Monday…Sunday of `now`'s Vietnam week; `claimed(i, date)` marks which of the 7 slots are claimed. */
function buildWeek(now: number, claimed: (i: number, date: string) => boolean): WeekSlot[] {
  const monday = vnWeekStart(now);
  const today = vnDay(now);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addVnDays(monday, i);
    const status: WeekSlot['status'] = claimed(i, date) ? 'claimed' : date === today ? 'today' : date < today ? 'missed' : 'future';
    return { date, status };
  });
}

export function boxStatus(p: PlayerState, economy: Pick<Economy, 'boxHours'>, now: number): BoxStatus {
  const openedToday = p.dailyDay === vnDay(now);
  const readyAt = openedToday && p.lastBoxAt !== null ? p.lastBoxAt + economy.boxHours * HOUR_MS : null;
  const thisWeek = p.weekStart === vnWeekStart(now) ? p.weekClaims : null;
  return {
    daily: { ready: !openedToday, resetAt: nextVnMidnight(now), week: buildWeek(now, (i) => thisWeek?.[i] ?? false) },
    hourly: { unlocked: openedToday, ready: readyAt !== null && now >= readyAt, readyAt },
  };
}

/** A status fetched earlier, brought up to `now`. */
export function liveBoxes(b: BoxStatus, now: number): BoxStatus {
  const claimedDates = new Set(b.daily.week.filter((w) => w.status === 'claimed').map((w) => w.date));
  const week = buildWeek(now, (_, date) => claimedDates.has(date));
  if (!b.daily.ready && now >= b.daily.resetAt) return { daily: { ready: true, resetAt: nextVnMidnight(now), week }, hourly: { unlocked: false, ready: false, readyAt: null } };
  return { daily: { ...b.daily, week }, hourly: { ...b.hourly, ready: b.hourly.readyAt !== null && now >= b.hourly.readyAt } };
}

export interface BoxReward {
  coins: number;
  cards: Array<{ unitId: string; count: number }>;
}

/** Uniform number in [0, 1): crypto on the server, seeded in tests. */
export type Random = () => number;

/** Coins in [min, max]; `cards` shared between `kinds` different units, cheap units more likely (weight 1/√cost). */
export function rollBox(units: readonly Pick<UnitDef, 'id' | 'cost'>[], box: BoxConfig, random: Random): BoxReward {
  const [lo, hi] = box.coins;
  const coins = lo + Math.floor(random() * (hi - lo + 1));
  const pool = units.map((u) => ({ id: u.id, weight: 1 / Math.sqrt(Math.max(1, u.cost)) }));
  const picked: string[] = [];
  while (picked.length < Math.min(box.kinds, box.cards) && pool.length > 0) {
    let r = random() * pool.reduce((sum, p) => sum + p.weight, 0);
    let i = 0;
    while (i < pool.length - 1 && (r -= pool[i].weight) >= 0) i++;
    picked.push(pool.splice(i, 1)[0].id);
  }
  if (picked.length === 0) return { coins, cards: [] };
  // One card each, the rest split by random shares.
  const shares = picked.map(() => 0.25 + random());
  const total = shares.reduce((a, b) => a + b, 0);
  const counts = shares.map((s) => 1 + Math.floor(((box.cards - picked.length) * s) / total));
  for (let i = 0, left = box.cards - counts.reduce((a, b) => a + b, 0); left > 0; i = (i + 1) % counts.length, left--) counts[i]++;
  return { coins, cards: picked.map((unitId, i) => ({ unitId, count: counts[i] })).sort((a, b) => b.count - a.count) };
}

// ---------------------------------------------------------------- changes

export const LEDGER_TYPES = ['daily-box', 'hourly-box', 'bot-win', 'rank-win', 'rank-season', 'unlock', 'upgrade', 'buy-cards', 'admin', 'topup'] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

/** One audit line in `players/{uid}/ledger`. */
export interface LedgerEntry {
  type: LedgerType;
  /** Coin change: negative when spent. */
  coins: number;
  /** Balance after the change. */
  balance: number;
  /** Card changes per unit id. */
  cards?: Record<string, number>;
  unitId?: string;
  /** Star reached by an upgrade. */
  star?: number;
  note?: string;
  /** Admin who changed the balance. */
  by?: string;
}

/** A refused change; the message is shown to the player. */
export class EconomyError extends Error {}

export interface Change {
  state: PlayerState;
  entry: LedgerEntry;
  reward?: BoxReward;
}

/** A change that moves no coins or cards (bookkeeping only): nothing goes in the ledger. */
export interface Quiet {
  state: PlayerState;
}

export const playerActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open-box'), kind: z.enum(['daily', 'hourly']) }),
  z.object({ action: z.literal('bot-start'), botId: idSchema, botCount: z.number().int().min(1).max(3) }),
  z.object({ action: z.literal('bot-win') }),
  z.object({ action: z.literal('rank-claim') }),
  z.object({ action: z.literal('unlock'), unitId: idSchema }),
  z.object({ action: z.literal('upgrade'), unitId: idSchema }),
  z.object({ action: z.literal('buy-cards'), unitId: idSchema, count: z.number().int().min(1).max(1000) }),
]);

export type PlayerAction = z.infer<typeof playerActionSchema>;

export const coinAdjustSchema = z.object({
  delta: z
    .number()
    .int('số nguyên')
    .min(-1_000_000_000)
    .max(1_000_000_000)
    .refine((d) => d !== 0, 'khác 0'),
  note: z.string().trim().min(1, 'ghi lý do').max(200),
});

function spend(p: PlayerState, price: number): number {
  if (p.coins < price) throw new EconomyError(`Không đủ coin: cần ${formatCoins(price)}, bạn có ${formatCoins(p.coins)}`);
  return p.coins - price;
}

export function openBox(p: PlayerState, kind: BoxKind, units: readonly UnitDef[], economy: Economy, now: number, random: Random): Change {
  const status = boxStatus(p, economy, now);
  if (kind === 'daily' && !status.daily.ready) throw new EconomyError('Hôm nay bạn đã mở hộp quà hằng ngày');
  if (kind === 'hourly' && !status.hourly.unlocked) throw new EconomyError('Hãy mở hộp quà hằng ngày trước');
  if (kind === 'hourly' && !status.hourly.ready) throw new EconomyError('Hộp chưa tới giờ mở');
  const reward = rollBox(units, kind === 'daily' ? economy.dailyBox : economy.hourlyBox, random);
  const cards = { ...p.cards };
  for (const c of reward.cards) cards[c.unitId] = (cards[c.unitId] ?? 0) + c.count;
  let weekStart = p.weekStart;
  let weekClaims = p.weekClaims;
  if (kind === 'daily') {
    const monday = vnWeekStart(now);
    weekClaims = monday === p.weekStart ? [...p.weekClaims] : Array(7).fill(false);
    weekClaims[vnWeekday(now)] = true;
    weekStart = monday;
  }
  const state: PlayerState = { ...p, coins: p.coins + reward.coins, cards, lastBoxAt: now, dailyDay: kind === 'daily' ? vnDay(now) : p.dailyDay, weekStart, weekClaims };
  const entry: LedgerEntry = { type: kind === 'daily' ? 'daily-box' : 'hourly-box', coins: reward.coins, balance: state.coins, cards: Object.fromEntries(reward.cards.map((c) => [c.unitId, c.count])) };
  return { state, entry, reward };
}

/** The reward box tier for a bot's difficulty (1‑5). */
export function botBoxTier(economy: Pick<Economy, 'botBoxes'>, difficulty: number): BoxConfig {
  return economy.botBoxes[String(Math.max(1, Math.min(5, Math.round(difficulty)))) as '1' | '2' | '3' | '4' | '5'];
}

/** A bot battle is starting: the server remembers which bot and when (one pending battle; a new start replaces it). */
export function startBotBattle(p: PlayerState, bot: Pick<BotDef, 'id'>, botCount: number, now: number): Quiet {
  return { state: { ...p, botTicket: { botId: bot.id, botCount, at: now } } };
}

/**
 * Coins and cards for beating the bot of the pending battle (× its bot count). Needs a battle the
 * server saw start at least `botWinMinSeconds` earlier, and is gated by `botWinCooldown` and
 * `botWinDailyCap`. The server cannot see who won (the battle runs in the browser): these bound
 * what a scripted claim can farm, they do not prove the win.
 */
export function winBotBattle(p: PlayerState, bots: readonly Pick<BotDef, 'id' | 'difficulty'>[], units: readonly UnitDef[], economy: Economy, now: number, random: Random): Change {
  const ticket = p.botTicket;
  if (!ticket) throw new EconomyError('Không có trận đấu bot nào để nhận thưởng');
  const bot = bots.find((b) => b.id === ticket.botId);
  if (!bot) throw new EconomyError('Bot không tồn tại');
  if (p.lastBotWinAt !== null && now - p.lastBotWinAt < economy.botWinCooldown * 1000) {
    const wait = Math.ceil((economy.botWinCooldown * 1000 - (now - p.lastBotWinAt)) / 1000);
    throw new EconomyError(`Đợi ${wait}s nữa để nhận thưởng trận tiếp theo`);
  }
  if (now - ticket.at < economy.botWinMinSeconds * 1000) throw new EconomyError('Trận đấu quá ngắn để nhận thưởng');
  const today = vnDay(now);
  const winsToday = p.botWinDay === today ? p.botWinsToday : 0;
  if (economy.botWinDailyCap > 0 && winsToday >= economy.botWinDailyCap) throw new EconomyError(`Hôm nay bạn đã nhận đủ ${economy.botWinDailyCap} lần thưởng đánh bot, mai quay lại nhé`);
  const tier = botBoxTier(economy, bot.difficulty);
  const mult = 1 + economy.botWinBonusPerExtra * (ticket.botCount - 1);
  const box: BoxConfig = { chest: tier.chest, coins: [Math.round(tier.coins[0] * mult), Math.round(tier.coins[1] * mult)], cards: Math.round(tier.cards * mult), kinds: tier.kinds };
  const reward = rollBox(units, box, random);
  const cards = { ...p.cards };
  for (const c of reward.cards) cards[c.unitId] = (cards[c.unitId] ?? 0) + c.count;
  const state: PlayerState = { ...p, coins: p.coins + reward.coins, cards, lastBotWinAt: now, botTicket: null, botWinDay: today, botWinsToday: winsToday + 1, botWinTotal: p.botWinTotal + 1 };
  const entry: LedgerEntry = { type: 'bot-win', coins: reward.coins, balance: state.coins, cards: Object.fromEntries(reward.cards.map((c) => [c.unitId, c.count])), note: `Thắng bot ${bot.id} (độ khó ${bot.difficulty}) ×${ticket.botCount}` };
  return { state, entry, reward };
}

export function unlockUnit(p: PlayerState, unit: UnitDef): Change {
  if (isUnlocked(unit, p)) throw new EconomyError(`${unit.name} đã được mở khóa`);
  const coins = spend(p, unit.unlockCost);
  return { state: { ...p, coins, unlocked: [...p.unlocked, unit.id] }, entry: { type: 'unlock', coins: -unit.unlockCost, balance: coins, unitId: unit.id } };
}

export function upgradeUnit(p: PlayerState, unit: UnitDef): Change {
  if (!isUnlocked(unit, p)) throw new EconomyError(`Hãy mở khóa ${unit.name} trước`);
  const next = nextStar(unit, p.stars[unit.id] ?? 0);
  if (!next) throw new EconomyError(`${unit.name} đã đạt ${STAR_MAX} sao`);
  const have = p.cards[unit.id] ?? 0;
  if (have < next.cards) throw new EconomyError(`Cần ${next.cards} thẻ ${unit.name}, bạn có ${have}`);
  const coins = spend(p, next.coins);
  return {
    state: { ...p, coins, cards: { ...p.cards, [unit.id]: have - next.cards }, stars: { ...p.stars, [unit.id]: next.star } },
    entry: { type: 'upgrade', coins: -next.coins, balance: coins, cards: { [unit.id]: -next.cards }, unitId: unit.id, star: next.star },
  };
}

export function buyCards(p: PlayerState, unit: UnitDef, count: number): Change {
  if (unit.cardPrice <= 0) throw new EconomyError(`Thẻ ${unit.name} không bán`);
  if (!isUnlocked(unit, p)) throw new EconomyError(`Hãy mở khóa ${unit.name} trước`);
  const price = unit.cardPrice * count;
  const coins = spend(p, price);
  return {
    state: { ...p, coins, cards: { ...p.cards, [unit.id]: (p.cards[unit.id] ?? 0) + count } },
    entry: { type: 'buy-cards', coins: -price, balance: coins, cards: { [unit.id]: count }, unitId: unit.id },
  };
}

export function adjustCoins(p: PlayerState, delta: number, note: string, by: string): Change {
  if (p.coins + delta < 0) throw new EconomyError(`Không trừ được ${formatCoins(-delta)} coin: ví chỉ có ${formatCoins(p.coins)}`);
  const coins = p.coins + delta;
  return { state: { ...p, coins }, entry: { type: 'admin', coins: delta, balance: coins, note, by } };
}

/** Cộng xu khi admin duyệt đơn nạp (ghi sổ loại `topup` để phân biệt với cộng tay). */
export function creditTopup(p: PlayerState, coins: number, content: string, amountVnd: number, by: string): Change {
  if (!Number.isInteger(coins) || coins <= 0) throw new EconomyError('Số xu nạp không hợp lệ');
  const next = p.coins + coins;
  return { state: { ...p, coins: next }, entry: { type: 'topup', coins, balance: next, note: `Nạp ${amountVnd.toLocaleString('en-US')}đ (${content})`, by } };
}
