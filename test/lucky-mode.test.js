// test/lucky-mode.test.js — 「恭喜发财」 (shared/constants.js LUCKY_MODE; owner's request 2026-10-05: "新增一个模式，叫
// 「恭喜发财」，每个人在进入游戏时都能获取一个随机五阶干员，但是都不重复，并且缪尔赛斯不能作为随机干员，并且在选择策略时就
// 在每个人旁边显示自己的开局随机五阶干员").
//
//   * Engine: every seat of a lucky match draws ONE tier-5 operator as the strategy draft opens (Match.grantLuckyChess,
//     called from enterBandDraft); the draws are pairwise distinct, 缪尔赛思 can never be drawn, the piece is a normal
//     gained piece (the 整备区, one shared-pool copy) and m.public carries it as players[].lucky / luckyName throughout
//     the draft. NOT at 确认本局信息: that briefing can be rerolled (match/setupVote.js rebuilds the pool, the stage and
//     the bans), and a copy drawn from the discarded pool would be a phantom in the 整备区. A match without the flag is
//     byte-for-byte unaffected.
//   * Official versions (versions M1): the draw reads the match's own data (its pool, its tiers), so a 第一期 / 上半
//     room draws that version's tier-5 operators; covered below with the real version data.
//   * Lobby: room.create { lucky } sets it, room.setLucky is host-only, LOBBY-only, un-readies the other humans, and
//     room.state carries it. Match receives opts.lucky.

import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { LUCKY_MODE, ERR, PHASE } from '../shared/constants.js';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { makeMatch, DATA } from './match/harness.js';
import { getVersionData } from '../server/data.js';
import { VERSIONS } from '../shared/versions.js';

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

/** Reach INFO_CHECK of a lucky (or plain) match: the briefing, where a lucky match has NOT drawn yet (it can still be rerolled). */
function briefingOf(o = {}) {
  const h = makeMatch({ mode: 'coop', humans: 3, bots: 1, seed: 42, ...o }).start();
  assert.equal(h.m.phase, PHASE.INFO_CHECK);
  return h;
}

/** Reach BAND_DRAFT of a lucky (or plain) match (every human confirms the briefing): the draw is made here. */
function draftOf(o = {}) {
  const h = briefingOf(o);
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

  test('确认本局信息 shows no draw: that briefing can still be rerolled (match/setupVote.js)', () => {
    const h = briefingOf({ seed: 3, lucky: true });
    const pub = h.m.publicView();
    assert.equal(pub.phase, PHASE.INFO_CHECK);
    assert.equal(pub.lucky, true, 'the mode flag is on from the briefing on');
    for (const p of pub.players) {
      assert.equal(Object.hasOwn(p, 'lucky'), false, 'nothing drawn while the briefing is open');
      assert.equal(Object.hasOwn(p, 'luckyName'), false);
      const ps = h.m.players.get(p.playerId);
      assert.equal(ps.luckyChess, null);
      assert.equal(ps.hand.filter(Boolean).length, 0, 'no piece in the 整备区 before the draft');
    }
    h.invariants();
    h.m.dispose();
  });

  test('the draw is published as the strategy draft opens (owner\'s decision: readable while picking)', () => {
    const h = draftOf({ seed: 3, lucky: true });
    const pub = h.m.publicView();
    assert.equal(pub.phase, PHASE.BAND_DRAFT);
    assert.equal(pub.lucky, true);
    const okay = new Set(candidatesOf(h.m));
    const drawn = [];
    for (const p of pub.players) {
      assert.ok(p.lucky, `${p.playerId} has no draw at the draft`);
      assert.equal(p.luckyName, DATA.chess[p.lucky].name);
      assert.ok(okay.has(p.lucky));
      drawn.push(p.lucky);
      // the piece is in the 整备区, and the board is still empty
      const ps = h.m.players.get(p.playerId);
      assert.deepEqual(ps.hand.filter(Boolean).map((x) => x.id), [ps.luckyChess]);
      assert.equal(ps.board.size, 0);
    }
    assert.equal(new Set(drawn).size, drawn.length, 'still all different');
    h.invariants();
    h.m.dispose();
  });

  test('a solo setup reroll: the draw follows the FINAL pool, never a copy of the discarded one', () => {
    // The live bug (6007, 2026-10-25): solo lucky drew at the briefing, the player then rerolled the setup (solo completes
    // the vote at once), the old hand copy stayed while the new pool never held it — `left + held == cap` broke.
    const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 3, lucky: true, fake: true }).start();
    assert.equal(h.m.phase, PHASE.INFO_CHECK);
    assert.equal(h.m.setupRevision, 0);
    const firstPool = candidatesOf(h.m).join(',');
    assert.equal(h.m.requestSetupReroll('p_0', h.m.setupRevision).ok, true, 'solo: the reroll completes at once');
    assert.equal(h.m.setupRevision, 1);
    assert.equal(h.m.phase, PHASE.INFO_CHECK, 'the rerolled opening is still 确认本局信息');
    // nothing was drawn before the reroll, and the rerolled briefing shows nothing either
    for (const ps of h.m.players.values()) {
      assert.equal(ps.luckyChess, null);
      assert.equal(ps.hand.filter(Boolean).length, 0);
    }
    const pub = h.m.publicView();
    assert.equal(pub.players.some((p) => Object.hasOwn(p, 'lucky')), false);
    h.invariants();
    // confirm the new briefing (g.infoReady names the current setup revision): the draw comes from the rerolled pool
    assert.equal(h.m.handle('p_0', { t: 'g.infoReady', setupRevision: h.m.setupRevision }).ok, true);
    h.sched.advance(1);
    assert.equal(h.m.phase, PHASE.BAND_DRAFT);
    const ps = h.ps('p_0');
    assert.equal(typeof ps.luckyChess, 'string', `nothing drawn after the reroll (old pool ${firstPool})`);
    assert.ok(candidatesOf(h.m).includes(ps.luckyChess), `${ps.luckyChess} must be in the REROLLED pool`);
    assert.equal(ps.hand.filter(Boolean).length, 1);
    assert.equal(ps.hand.filter(Boolean)[0].poolCopies, 1, 'a real copy of the rerolled pool');
    h.invariants();
    h.m.dispose();
  });

  test('a co-op setup reroll vote: no draw while the vote runs, and the draw never comes from the discarded pool', () => {
    const h = briefingOf({ seed: 9, lucky: true }); // 3 humans + 1 bot
    assert.equal(h.m.setupRevision, 0);
    const humans = h.m.humans().map((p) => p.playerId);
    assert.equal(h.m.requestSetupReroll(humans[0], h.m.setupRevision).ok, true);
    assert.ok(h.m.setupVote, 'a vote is open');
    for (const pid of humans.slice(1)) assert.equal(h.m.voteSetupReroll(h.m.players.get(pid), h.m.setupVote.id, true).ok, true);
    assert.equal(h.m.setupRevision, 1, 'the last agreement completes the reroll');
    assert.equal(h.m.phase, PHASE.INFO_CHECK);
    for (const ps of h.m.players.values()) assert.equal(ps.luckyChess, null);
    h.invariants();
    for (const ps of h.m.players.values()) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.infoReady', setupRevision: h.m.setupRevision });
    h.sched.advance(1);
    assert.equal(h.m.phase, PHASE.BAND_DRAFT);
    const okay = new Set(candidatesOf(h.m));
    const drawn = [];
    for (const ps of h.m.players.values()) {
      assert.ok(okay.has(ps.luckyChess), `${ps.playerId}: ${ps.luckyChess} must be in the rerolled pool`);
      assert.equal(ps.hand.filter(Boolean).length, 1);
      drawn.push(ps.luckyChess);
    }
    assert.equal(new Set(drawn).size, drawn.length, 'still all different after a reroll');
    h.invariants();
    h.m.dispose();
  });

  test('grantLuckyChess is idempotent: a seat that already drew never draws again', () => {
    const h = draftOf({ seed: 6, lucky: true });
    const before = [...h.m.players.values()].map((ps) => ps.luckyChess);
    assert.ok(before.every(Boolean));
    // re-running the grant is a no-op for every seat that already has one (it is guarded by ps.luckyChess)
    h.m.grantLuckyChess();
    assert.deepEqual([...h.m.players.values()].map((ps) => ps.luckyChess), before);
    for (const ps of h.m.players.values()) {
      assert.equal([...ps.hand, ...ps.temp, ...ps.board.values()].filter((p) => p && p.kind === 'chess').length, 1);
    }
    h.invariants();
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
// official versions (versions M1): the draw reads the match's own data, never the default one
// ---------------------------------------------------------------------------------------------------

describe('「恭喜发财」: official versions', () => {
  test('every official version draws that version\'s own tier-5 operators', () => {
    const quiet = { warn() {}, error() {}, info() {} };
    for (const v of VERSIONS) {
      const data = v.dir === '' ? DATA : getVersionData(v.id, { log: quiet });
      const tier5 = Object.values(data.chess)
        .filter((c) => c.visible && !c.isGolden && !c.isDiy && !c.isHidden && c.tier === LUCKY_MODE.tier);
      assert.ok(tier5.length >= 4, `${v.id}: expected several tier-5 operators, got ${tier5.length}`);
      // the excluded operator is the same record in every shipped version (same id, still tier 6)
      assert.equal(data.chess[MLYSS].tier, LUCKY_MODE.tier + 1, `${v.id}: ${MLYSS} stays out of the draw tier`);
      const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, bots: 1, seed: 7, data, lucky: true, fake: true }).start();
      for (const ps of h.m.players.values()) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.infoReady' });
      h.sched.advance(1);
      assert.equal(h.m.phase, PHASE.BAND_DRAFT, v.id);
      const drawn = [];
      for (const ps of h.m.players.values()) {
        assert.equal(typeof ps.luckyChess, 'string', `${v.id}: ${ps.playerId} drew nothing`);
        assert.equal(data.chess[ps.luckyChess].tier, LUCKY_MODE.tier, `${v.id}: ${ps.luckyChess} is tier 5`);
        assert.notEqual(ps.luckyChess, MLYSS);
        assert.equal(ps.hand.filter(Boolean).length, 1);
        assert.equal(ps.hand.filter(Boolean)[0].poolCopies, 1, `${v.id}: a real copy of this version's pool`);
        assert.equal(h.m.pool.left(ps.luckyChess), h.m.pool.cap(ps.luckyChess) - 1);
        drawn.push(ps.luckyChess);
      }
      assert.equal(new Set(drawn).size, drawn.length, `${v.id}: all different (${drawn.join(', ')})`);
      assert.deepEqual(h.m.publicView().players.map((p) => p.lucky), drawn, `${v.id}: m.public names the draws`);
      h.invariants();
      h.m.dispose();
    }
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
    assert.equal(off.lucky, undefined, 'off unless asked for: the key is left out, so a default room.state stays the message it was');

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

  test('「恭喜发财」 over the wire: the host turns it on and the draw shows up as the draft opens (real match)', async () => {
    // The stub match ends as soon as everyone confirms the briefing, so this one runs the real MatchClass.
    const real = await startServer({ port: 0, host: '127.0.0.1', log: quiet, seedFn: () => 4242 });
    try {
      const host = await TestClient.connect(`ws://127.0.0.1:${real.port}/ws`);
      const w = await host.hello('Lucky');
      host.id = w.playerId;
      await ok(host, { t: 'room.create', mode: 'solo', difficulty: 'FUNNY', lucky: true });
      await host.waitFor('room.state', (s) => s.hostId === host.id && s.lucky === true);
      await ok(host, { t: 'room.start' });
      // 确认本局信息 carries the flag but NOT the draw: this briefing can still be rerolled (match/setupVote.js)
      const brief = await host.waitFor('m.public', (p) => p.phase === PHASE.INFO_CHECK && p.lucky === true, 5000);
      assert.equal(brief.lucky, true);
      assert.equal(brief.players.some((x) => Object.hasOwn(x, 'lucky')), false, 'nothing drawn at the briefing');
      // the draw is made as the draft opens, before the player picks a strategy
      await ok(host, { t: 'g.infoReady' }); // solo: the player confirms the briefing (no timer)
      const pub = await host.waitFor('m.public', (p) => p.phase === PHASE.BAND_DRAFT && p.lucky === true && p.players.some((x) => x.playerId === host.id && x.lucky), 5000);
      const me = pub.players.find((p) => p.playerId === host.id);
      assert.equal(DATA.chess[me.lucky].tier, LUCKY_MODE.tier, `drew ${me.lucky}`);
      assert.notEqual(me.lucky, MLYSS);
      assert.equal(me.luckyName, DATA.chess[me.lucky].name);
      // the piece is in the hand like any other gain, from the first draft frame on
      const priv = await host.waitFor('m.private', (p) => (p.hand || []).some((x) => x && x.id === me.lucky), 3000);
      assert.ok(priv.hand.some((x) => x && x.id === me.lucky));
      await host.terminate();
    } finally {
      await real.close();
    }
  });
});
