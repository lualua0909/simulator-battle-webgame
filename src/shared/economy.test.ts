import assert from 'node:assert/strict';
import test from 'node:test';
import { Rng } from '@/game/sim/rng';
import { adjustCoins, boxStatus, buyCards, EconomyError, emptyPlayer, isUnlocked, liveBoxes, openBox, rollBox, starScale, unlockUnit, upgradeUnit, vnDay, type PlayerState } from './economy';
import { SEED } from './seed';

const HOUR = 3_600_000;
const economy = SEED.settings.economy;
const unit = (id: string) => SEED.units.find((u) => u.id === id)!;
/** 2026-09-14 10:00 in Vietnam. */
const MORNING = Date.UTC(2026, 8, 14, 3);
const random = () => {
  const rng = new Rng(7);
  return () => rng.next();
};

test('Vietnam dates roll over at local midnight (17:00 UTC)', () => {
  assert.equal(vnDay(Date.UTC(2026, 8, 14, 16, 59)), '2026-09-14');
  assert.equal(vnDay(Date.UTC(2026, 8, 14, 17, 0)), '2026-09-15');
});

test('the daily box opens once per Vietnam day', () => {
  const opened = openBox(emptyPlayer(), 'daily', SEED.units, economy, MORNING, random());
  assert.equal(opened.state.dailyDay, '2026-09-14');
  assert.throws(() => openBox(opened.state, 'daily', SEED.units, economy, MORNING + 5 * HOUR, random()), EconomyError);
  const midnight = Date.UTC(2026, 8, 14, 17);
  assert.equal(boxStatus(opened.state, economy, MORNING).daily.resetAt, midnight);
  assert.doesNotThrow(() => openBox(opened.state, 'daily', SEED.units, economy, midnight, random()));
});

test('the x-hour box unlocks with the daily box and waits boxHours after the last box', () => {
  assert.throws(() => openBox(emptyPlayer(), 'hourly', SEED.units, economy, MORNING, random()), /hằng ngày trước/);
  const daily = openBox(emptyPlayer(), 'daily', SEED.units, economy, MORNING, random()).state;
  assert.deepEqual(boxStatus(daily, economy, MORNING).hourly, { unlocked: true, ready: false, readyAt: MORNING + 3 * HOUR });
  assert.throws(() => openBox(daily, 'hourly', SEED.units, economy, MORNING + 3 * HOUR - 1, random()), /chưa tới giờ/);
  const hourly = openBox(daily, 'hourly', SEED.units, economy, MORNING + 3 * HOUR, random()).state;
  assert.equal(hourly.dailyDay, daily.dailyDay);
  assert.equal(boxStatus(hourly, economy, MORNING + 3 * HOUR).hourly.readyAt, MORNING + 6 * HOUR);
  // Next day: the x-hour box waits for that day's daily box again.
  const tomorrow = MORNING + 24 * HOUR;
  assert.deepEqual(boxStatus(hourly, economy, tomorrow).hourly, { unlocked: false, ready: false, readyAt: null });
});

test('a status fetched earlier follows the clock', () => {
  const daily = openBox(emptyPlayer(), 'daily', SEED.units, economy, MORNING, random()).state;
  const status = boxStatus(daily, economy, MORNING);
  assert.equal(liveBoxes(status, MORNING + 3 * HOUR).hourly.ready, true);
  const nextDay = liveBoxes(status, status.daily.resetAt);
  assert.equal(nextDay.daily.ready, true);
  assert.equal(nextDay.hourly.unlocked, false);
});

test('the weekly grid is always Monday-first, whichever day of the week `now` falls on', () => {
  for (let d = 0; d < 7; d++) {
    const week = boxStatus(emptyPlayer(), economy, MORNING + d * 24 * HOUR).daily.week;
    assert.equal(week.length, 7);
    assert.equal(week[0].date, '2026-09-14');
    assert.equal(week[6].date, '2026-09-20');
  }
});

test('the weekly grid tracks claims across days and permanently marks a skipped day missed', () => {
  const monday = openBox(emptyPlayer(), 'daily', SEED.units, economy, MORNING, random()).state;
  assert.equal(monday.weekStart, '2026-09-14');
  assert.deepEqual(monday.weekClaims, [true, false, false, false, false, false, false]);
  const wednesday = MORNING + 2 * 24 * HOUR; // Tuesday skipped
  const beforeClaim = boxStatus(monday, economy, wednesday).daily.week;
  assert.equal(beforeClaim[0].status, 'claimed'); // Mon
  assert.equal(beforeClaim[1].status, 'missed'); // Tue
  assert.equal(beforeClaim[2].status, 'today'); // Wed: not claimed yet
  assert.equal(beforeClaim[3].status, 'future'); // Thu
  const wed = openBox(monday, 'daily', SEED.units, economy, wednesday, random()).state;
  assert.deepEqual(wed.weekClaims, [true, false, true, false, false, false, false]);
  const afterClaim = boxStatus(wed, economy, wednesday).daily.week;
  assert.equal(afterClaim[1].status, 'missed'); // Tue: still permanently lost
  assert.equal(afterClaim[2].status, 'claimed'); // Wed: now claimed
});

test('a stale weekStart (a previous week) is ignored — the grid starts fresh', () => {
  const stale = boxStatus({ ...emptyPlayer(), weekStart: '2026-09-07', weekClaims: [true, true, true, true, true, true, true] }, economy, MORNING).daily.week;
  assert.equal(stale[0].date, '2026-09-14');
  assert.ok(stale.every((w) => w.status !== 'claimed'));
});

test('liveBoxes carries claims within a week and wipes the grid across a Monday rollover', () => {
  const monday = openBox(emptyPlayer(), 'daily', SEED.units, economy, MORNING, random()).state;
  const status = boxStatus(monday, economy, MORNING);
  const midweek = liveBoxes(status, MORNING + 2 * 24 * HOUR); // Wednesday, same week
  assert.equal(midweek.daily.week[0].status, 'claimed'); // Mon still shows claimed
  assert.equal(midweek.daily.week[2].status, 'today'); // Wed: unclaimed
  const nextMonday = liveBoxes(status, MORNING + 7 * 24 * HOUR); // the following Monday
  assert.equal(nextMonday.daily.week[0].date, '2026-09-21');
  assert.ok(nextMonday.daily.week.every((w) => w.status !== 'claimed'));
});

test('a box holds coins in range and exactly its cards over distinct units, cheap units more often', () => {
  const rng = new Rng(11);
  const tally = new Map<string, number>();
  for (let i = 0; i < 3000; i++) {
    const r = rollBox(SEED.units, economy.dailyBox, () => rng.next());
    assert.ok(r.coins >= 200 && r.coins <= 500);
    assert.equal(r.cards.reduce((s, c) => s + c.count, 0), 40);
    assert.equal(new Set(r.cards.map((c) => c.unitId)).size, 3);
    for (const c of r.cards) tally.set(c.unitId, (tally.get(c.unitId) ?? 0) + 1);
  }
  assert.ok((tally.get('clubber') ?? 0) > (tally.get('dragon') ?? 0) * 3);
  assert.deepEqual(rollBox([], economy.dailyBox, () => 0.5).cards, []);
  assert.deepEqual(rollBox(SEED.units, { ...economy.dailyBox, cards: 0 }, () => 0.5).cards, []);
});

test('a star uses up cards and coins, up to 5 stars', () => {
  const archer = unit('archer');
  let p: PlayerState = { ...emptyPlayer(), coins: 100_000, cards: { archer: 1600 } };
  assert.ok(isUnlocked(archer, null), 'starter units are free');
  for (let star = 1; star <= 5; star++) p = upgradeUnit(p, archer).state;
  assert.equal(p.stars.archer, 5);
  assert.equal(p.cards.archer, 1600 - 1500);
  assert.equal(p.coins, 100_000 - 31_000);
  assert.throws(() => upgradeUnit(p, archer), /5 sao/);
  assert.throws(() => upgradeUnit({ ...emptyPlayer(), coins: 5000, cards: { archer: 99 } }, archer), /Cần 100 thẻ/);
  assert.throws(() => upgradeUnit({ ...emptyPlayer(), coins: 999, cards: { archer: 100 } }, archer), /Không đủ coin/);
  const upgrade = upgradeUnit({ ...emptyPlayer(), coins: 1000, cards: { archer: 100 } }, archer);
  assert.deepEqual(upgrade.entry, { type: 'upgrade', coins: -1000, balance: 0, cards: { archer: -100 }, unitId: 'archer', star: 1 });
});

test('locked units must be bought before their cards are bought or upgraded', () => {
  const dragon = unit('dragon');
  const rich: PlayerState = { ...emptyPlayer(), coins: 200_000, cards: { dragon: 100 } };
  assert.equal(isUnlocked(dragon, rich), false);
  assert.throws(() => upgradeUnit(rich, dragon), /mở khóa/);
  assert.throws(() => buyCards(rich, dragon, 1), /mở khóa/);
  const bought = unlockUnit(rich, dragon);
  assert.equal(bought.state.coins, 200_000 - dragon.unlockCost);
  assert.ok(isUnlocked(dragon, bought.state));
  assert.throws(() => unlockUnit(bought.state, dragon), /đã được mở khóa/);
  const cards = buyCards(bought.state, dragon, 10).state;
  assert.equal(cards.cards.dragon, 110);
  assert.equal(cards.coins, bought.state.coins - 10 * dragon.cardPrice);
  assert.throws(() => unlockUnit(emptyPlayer(), dragon), /Không đủ coin/);
  assert.throws(() => buyCards(bought.state, { ...dragon, cardPrice: 0 }, 1), /không bán/);
});

test('admin adjustments never leave a negative balance', () => {
  const p = adjustCoins(emptyPlayer(), 5000, 'nạp tay', 'root').state;
  assert.equal(p.coins, 5000);
  assert.throws(() => adjustCoins(p, -5001, 'sai', 'root'), EconomyError);
  assert.equal(adjustCoins(p, -5000, 'hoàn', 'root').state.coins, 0);
});

test('stars scale stats by the bonus, clamped to 0–5', () => {
  assert.equal(starScale(0, 0.1), 1);
  assert.equal(starScale(3, 0.1), 1 + 0.1 * 3);
  assert.equal(starScale(9, 0.1), starScale(5, 0.1));
  assert.equal(starScale(-2, 0.1), 1);
});
