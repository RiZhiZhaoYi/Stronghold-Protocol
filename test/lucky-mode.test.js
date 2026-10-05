// test/lucky-mode.test.js — 「恭喜发财」 (shared/constants.js LUCKY_MODE; owner's request 2026-10-05: "新增一个模式，叫
// 「恭喜发财」，每个人在进入游戏时都能获取一个随机五阶干员，但是都不重复，并且缪尔赛斯不能作为随机干员，并且在选择策略时就
// 在每个人旁边显示自己的开局随机五阶干员").
//
//   * Engine: every seat of a lucky match draws ONE tier-5 operator at the strategy draft (Match.grantLuckyChess); the
//     draws are pairwise distinct, 缪尔赛思 can never be drawn, the piece is a normal gained piece (the 整备区, one
//     shared-pool copy) and m.public carries it as players[].lucky / luckyName throughout the draft. A match without the
//     flag is byte-for-byte unaffected.
//   * Lobby: room.create { lucky } sets it, room.setLucky is host-only, LOBBY-only, un-readies the other humans, and
//     room.state carries it. Match receives opts.lucky.

import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { LUCKY_MODE, ERR, PHASE } from '../shared/constants.js';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { makeMatch, DATA } from './match/harness.js';

const MLYSS = 'chess_char_6_11_a'; // 缪尔赛思 (tier 6 — never a candidate, and on the exclusion list)
/** Visible base operator ids of the draw tier, before this match's pool bans. */
const TIER5 = Object.values(DATA.chess)
  .filter((c) => c.visible && !c.isGolden && !c.isDiy && !c.isHidden && c.tier === LUCKY_MODE.tier)
  .map((c) => c.chessId)
  .sort();

/** The candidate pool of a started match: its shared pool's own tier-5 entries minus the exclusions. */
const candidatesOf = (m) => [...m.pool.entries]
  .filter(([id, e]) => e.tier === LUCKY_MODE.tier && !LUCKY_MODE.excludedChessIds.includes(id))
  .map(([id]) => id)
  .sort();

/** Reach BAND_DRAFT of a lucky (or plain) match. */
function draftOf(o = {}) {
  const h = makeMatch({ mode: 'coop', humans: 3, bots: 1, seed: 42, ...o }).start();
  for (const ps of h.m.players.values()) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.infoReady' });
  h.sched.advance(1);
  assert.equal(h.m.phase, PHASE.BAND_DRAFT);
  return h;
}

describe('「恭喜发财」: the opening draw (engine)', () => {
  test('the draw tier is the visible tier-5 operators; the exclusions are never candidates', () => {
    assert.ok(TIER5.length >= 4, `expected several tier-${LUCKY_MODE.tier} operators, got ${TIER5.length}`);
    assert.equal(TIER5.includes(MLYSS), false, '缪尔赛思 is tier 6 — never in the tier-5 pool');
    assert.deepEqual([...LUCKY_MODE.excludedChessIds], [MLYSS]);
    const h = makeMatch({ humans: 1 }).start();
    assert.ok(candidatesOf(h.m).length >= 4);
    assert.equal(candidatesOf(h.m).includes(MLYSS), false);
    h.m.dispose();
  });

  test('every seat draws one distinct tier-5 operator of THIS match pool, into its own 整备区, taking a pool copy', () => {
    for (const seed of [1, 7, 42, 999, 123456]) {
      const h = draftOf({ seed, lucky: true });
      const okay = new Set(candidatesOf(h.m)); // the pool's tier-5 operators, banned ones excluded
      const drawn = [];
      for (const ps of h.m.players.values()) {
        assert.equal(typeof ps.luckyChess, 'string', `${ps.playerId} drew nothing (seed ${seed})`);
        assert.equal(DATA.chess[ps.luckyChess].tier, LUCKY_MODE.tier);
        assert.notEqual(ps.luckyChess, MLYSS);
        assert.ok(okay.has(ps.luckyChess), `${ps.luckyChess} must be in this match's pool (seed ${seed})`);
        drawn.push(ps.luckyChess);
        // a normal gained piece: one copy in the hand, held from the shared pool
        const hand = ps.hand.filter(Boolean);
        assert.equal(hand.length, 1, `${ps.playerId}: the draw is the only opening piece`);
        assert.equal(hand[0].id, ps.luckyChess);
        assert.equal(hand[0].poolCopies, 1, `${ps.playerId}: a real pool copy, not a phantom`);
        assert.equal(h.m.pool.left(ps.luckyChess), h.m.pool.cap(ps.luckyChess) - 1);
      }
      assert.equal(new Set(drawn).size, drawn.length, `seed ${seed}: all different (${drawn.join(', ')})`);
      h.invariants();
      h.m.dispose();
    }
  });

  test('a mode-disabled bond can ban tier-5 operators: those are never drawn', () => {
    const h = draftOf({ seed: 1, lucky: true });
    const candidates = new Set(candidatesOf(h.m));
    // 标准/险境 disable several bonds; with seed 1 烛煌 (维多利亚+炎) and 史尔特尔 (莱茵+奥术) are banned by them
    assert.ok(h.m.bannedChess.length > 0, 'this seed bans some operators');
    for (const id of h.m.bannedChess) {
      if (DATA.chess[id].tier !== LUCKY_MODE.tier) continue;
      assert.equal(candidates.has(id), false, `${id} is banned this match`);
      assert.equal([...h.m.players.values()].some((ps) => ps.luckyChess === id), false);
    }
    h.m.dispose();
  });

  test('m.public carries the draw (id + name) next to every player while the strategies are chosen', () => {
    const h = draftOf({ seed: 3, lucky: true });
    const pub = h.m.publicView();
    assert.equal(pub.lucky, true, 'the mode flag is on');
    assert.equal(pub.players.length, h.m.order.length);
    const okay = new Set(candidatesOf(h.m));
    for (const p of pub.players) {
      const ps = h.m.players.get(p.playerId);
      assert.equal(p.lucky, ps.luckyChess);
      assert.equal(p.luckyName, DATA.chess[ps.luckyChess].name);
      assert.ok(okay.has(p.lucky));
    }
    // it is a JSON frame like any other
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(pub)));
    h.m.dispose();
  });

  test('a match without the flag: no draws, no lucky field, no extra pieces', () => {
    const h = draftOf({ seed: 3 });
    const pub = h.m.publicView();
    assert.equal(pub.lucky, false);
    for (const p of pub.players) {
      assert.equal(Object.hasOwn(p, 'lucky'), false, 'omitted, so an ordinary m.public is unchanged');
      assert.equal(Object.hasOwn(p, 'luckyName'), false);
    }
    for (const ps of h.m.players.values()) {
      assert.equal(ps.luckyChess, null);
      assert.equal(ps.hand.filter(Boolean).length, 0);
    }
    h.m.dispose();
  });

  test('the draw happens exactly once, at the draft — not again at round start', () => {
    const h = draftOf({ seed: 11, lucky: true }).autoHumans();
    const before = [...h.m.players.values()].map((ps) => ps.luckyChess);
    h.run(() => h.m.round >= 1);
    assert.deepEqual([...h.m.players.values()].map((ps) => ps.luckyChess), before);
    for (const ps of h.m.players.values()) {
      const draws = [...ps.hand, ...ps.temp, ...ps.board.values()].filter((p) => p && p.kind === 'chess' && p.id === ps.luckyChess);
      assert.equal(draws.length, 1, `${ps.playerId}: exactly one copy of the drawn operator`);
    }
    h.invariants();
    h.m.dispose();
  });

  test('an eliminated player keeps no draw marker (m.public drops the chip with the pieces)', () => {
    const h = draftOf({ seed: 5, lucky: true });
    const ps = h.m.order[0];
    assert.ok(ps.luckyChess);
    ps.eliminate(1);
    assert.equal(ps.luckyChess, null);
    const row = h.m.publicView().players.find((p) => p.playerId === ps.playerId);
    assert.equal(Object.hasOwn(row, 'lucky'), false);
    h.m.dispose();
  });

  test('solo draws like co-op', () => {
    const h = makeMatch({ mode: 'solo', seed: 8, lucky: true }).start();
    h.m.handle('p_0', { t: 'g.infoReady' });
    h.sched.advance(1);
    assert.equal(h.m.phase, PHASE.BAND_DRAFT);
    assert.ok(candidatesOf(h.m).includes(h.ps('p_0').luckyChess));
    h.invariants();
    h.m.dispose();
  });

  test('more seats than candidates leaves the extra seats without a draw (never a duplicate)', () => {
    // A tiny synthetic pool: exactly 2 candidates, 4 seats. Two players draw, two get nothing — and nobody twice.
    const chess = {};
    for (const [id, c] of Object.entries(DATA.chess)) {
      chess[id] = (c.visible && !c.isGolden && !c.isDiy && !c.isHidden && c.tier === LUCKY_MODE.tier) ? { ...c, tier: 6 } : c;
    }
    const mk = (id, name) => ({
      ...DATA.chess.chess_char_5_01_a, chessId: id, baseId: id, goldenId: null, isGolden: false, isHidden: false, isDiy: false,
      visible: true, tier: LUCKY_MODE.tier, name, bonds: [],
    });
    chess.lucky_a = mk('lucky_a', '测试甲');
    chess.lucky_b = mk('lucky_b', '测试乙');
    const h = makeMatch({ humans: 4, seed: 2, lucky: true, data: { ...DATA, chess } }).start();
    for (const ps of h.m.players.values()) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.infoReady' });
    h.sched.advance(1);
    const drawn = [...h.m.players.values()].map((ps) => ps.luckyChess).filter(Boolean);
    assert.deepEqual([...drawn].sort(), ['lucky_a', 'lucky_b'], `two candidates, two draws (got ${drawn.join(', ')})`);
    for (const ps of h.m.players.values()) if (!ps.luckyChess) assert.equal(ps.hand.filter(Boolean).length, 0);
    h.invariants();
    h.m.dispose();
  });

  test('data without any candidate tier: the mode warns and grants nothing (never throws)', () => {
    const chess = {};
    for (const [id, c] of Object.entries(DATA.chess)) chess[id] = (c.visible && c.tier === LUCKY_MODE.tier) ? { ...c, tier: 6 } : c;
    const h = makeMatch({ humans: 2, seed: 4, lucky: true, data: { ...DATA, chess } }).start();
    for (const ps of h.m.players.values()) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.infoReady' });
    h.sched.advance(1);
    assert.equal(h.m.phase, PHASE.BAND_DRAFT);
    for (const ps of h.m.players.values()) assert.equal(ps.luckyChess, null);
    assert.ok(h.logs.warn.some((l) => l.includes('恭喜发财')), 'a warning names the missing pool');
    h.invariants();
    h.m.dispose();
  });

  test('the draws do not shift the other random streams (the bans, the stage, the draft order)', () => {
    const plain = makeMatch({ mode: 'coop', humans: 3, bots: 1, seed: 77 }).start();
    for (const ps of plain.m.players.values()) if (!ps.isBot) plain.m.handle(ps.playerId, { t: 'g.infoReady' });
    plain.sched.advance(1);
    const plainState = {
      stageId: plain.m.stageId, banned: plain.m.bannedChess, disabled: plain.m.disabledBonds, order: plain.m.draft.order,
      bossId: plain.m.bossId, hiddenBossId: plain.m.hiddenBossId, factions: plain.m.factions,
    };
    plain.m.dispose();
    const lucky = draftOf({ seed: 77, lucky: true });
    assert.deepEqual({
      stageId: lucky.m.stageId, banned: lucky.m.bannedChess, disabled: lucky.m.disabledBonds, order: lucky.m.draft.order,
      bossId: lucky.m.bossId, hiddenBossId: lucky.m.hiddenBossId, factions: lucky.m.factions,
    }, plainState, 'enabling the mode changes nothing but the draw');
    lucky.m.dispose();
  });
});

// ---------------------------------------------------------------------------------------------------
// lobby wiring (room.create / room.setLucky / room.state / opts.lucky)
// ---------------------------------------------------------------------------------------------------

class RecordingStub extends StubMatch {
  static instances = [];
  constructor(opts) { super(opts); this.opts = opts; RecordingStub.instances.push(this); }
}

const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };

describe('「恭喜发财」: the lobby switch', () => {
  let srv;
  const open = new Set();
  const quiet = { info() {}, warn() {}, debug() {}, error() {} };
  const player = async (name) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    open.add(c);
    const w = await c.hello(name);
    c.id = w.playerId;
    c.token = w.token;
    return c;
  };
  before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', log: quiet, MatchClass: RecordingStub }); });
  afterEach(async () => { RecordingStub.instances = []; await Promise.all([...open].map((c) => c.terminate().catch(() => {}))); open.clear(); });
  after(async () => { await srv?.close(); });

  test('room.create { lucky } sets it and room.state carries it (default off)', async () => {
    const a = await player('A');
    await ok(a, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const off = await a.waitFor('room.state', (s) => s.hostId === a.id);
    assert.equal(off.lucky, false, 'off unless asked for');

    const b = await player('B');
    await ok(b, { t: 'room.create', mode: 'coop', difficulty: 'HARD', lucky: true });
    const on = await b.waitFor('room.state', (s) => s.hostId === b.id && s.mode === 'coop');
    assert.equal(on.lucky, true);
    assert.equal(on.difficulty, 'HARD', 'the mode stacks on the difficulty, it does not replace it');
  });

  test('room.setLucky: host only, before the match, un-readies the others; the flag reaches the Match', async () => {
    const host = await player('Host');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
    const guest = await player('Guest');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id));
    await ok(guest, { t: 'room.ready', ready: true });
    await guest.waitFor('room.state', (s) => s.seats.find((x) => x && x.playerId === guest.id)?.ready === true);

    // a guest may not toggle it
    await err(guest, { t: 'room.setLucky', lucky: true }, ERR.NOT_HOST);
    // the host may; the guest is un-readied (their match would be a different one)
    await ok(host, { t: 'room.setLucky', lucky: true });
    const after = await host.waitFor('room.state', (s) => s.lucky === true);
    assert.equal(after.seats.find((x) => x && x.playerId === guest.id).ready, false, 'the other humans are un-readied');
    // setting the same value again changes nothing
    await ok(host, { t: 'room.setLucky', lucky: true });

    await ok(guest, { t: 'room.ready', ready: true });
    await guest.waitFor('room.state', (s) => s.seats.find((x) => x && x.playerId === guest.id)?.ready === true);
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === PHASE.INFO_CHECK);
    assert.equal(RecordingStub.instances.at(-1).opts.lucky, true, 'opts.lucky reaches the match');

    // during the match it is locked
    await err(host, { t: 'room.setLucky', lucky: false }, ERR.ROOM_STARTED);
  });

  test('the protocol refuses a non-boolean', async () => {
    const a = await player('C');
    await err(a, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', lucky: 'yes' }, ERR.BAD_MSG);
    await ok(a, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', lucky: true });
    await a.waitFor('room.state', (s) => s.hostId === a.id);
    await err(a, { t: 'room.setLucky', lucky: 1 }, ERR.BAD_MSG);
  });

  test('「恭喜发财」 over the wire: the host turns it on and the draw shows up in m.public (real match)', async () => {
    // The stub match ends as soon as everyone confirms the briefing, so this one runs the real MatchClass.
    const real = await startServer({ port: 0, host: '127.0.0.1', log: quiet, seedFn: () => 4242 });
    try {
      const host = await TestClient.connect(`ws://127.0.0.1:${real.port}/ws`);
      const w = await host.hello('Lucky');
      host.id = w.playerId;
      await ok(host, { t: 'room.create', mode: 'solo', difficulty: 'FUNNY', lucky: true });
      await host.waitFor('room.state', (s) => s.hostId === host.id && s.lucky === true);
      await ok(host, { t: 'room.start' });
      await host.waitFor('m.public', (p) => p.phase === PHASE.INFO_CHECK, 5000);
      await ok(host, { t: 'g.infoReady' }); // solo: the player confirms the briefing (no timer)
      // every m.public from here on is a lucky one: find the draft frame carrying the draw
      const pub = await host.waitFor('m.public', (p) => p.lucky === true && p.players.some((x) => x.playerId === host.id && x.lucky), 5000);
      assert.equal(pub.lucky, true);
      assert.equal(pub.phase, PHASE.BAND_DRAFT, 'the draw is published from the strategy draft on');
      const me = pub.players.find((p) => p.playerId === host.id);
      assert.equal(DATA.chess[me.lucky].tier, LUCKY_MODE.tier, `drew ${me.lucky}`);
      assert.notEqual(me.lucky, MLYSS);
      assert.equal(me.luckyName, DATA.chess[me.lucky].name);
      // the piece is in the hand like any other gain
      const priv = await host.waitFor('m.private', (p) => (p.hand || []).some((x) => x && x.id === me.lucky), 3000);
      assert.ok(priv.hand.some((x) => x && x.id === me.lucky));
      await host.terminate();
    } finally {
      await real.close();
    }
  });
});
