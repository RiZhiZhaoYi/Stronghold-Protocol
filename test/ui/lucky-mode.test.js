// test/ui/lucky-mode.test.js — 「恭喜发财」 in the client (shared/constants.js LUCKY_MODE): the 选择策略 order list shows
// each player's opening random tier-5 operator next to them (screens/bandDraft.js LuckyOp, m.public players[].lucky /
// luckyName), and the pre-game step header wears the mode mark (ui/matchChrome.js LuckyTag, m.public.lucky).
//
// The components are hook-free, so they render to vnodes in Node; the browser data store reads the real data/*.json from
// disk (the thumbnail resolves the operator's own name and tier).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { LuckyOp } = await import('../../public/js/screens/bandDraft.js');
const { LuckyTag } = await import('../../public/js/ui/matchChrome.js');
const { UnitThumb } = await import('../../public/js/ui/gameComponents.js');
const { LUCKY_MODE } = await import('../../shared/constants.js');
const { data } = await import('../../public/js/data.js');
const { loadData } = await import('../../public/js/data.js');
await loadData('chess');

/** Every vnode of a preact tree (htm output), depth first. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

const TIER5 = 'chess_char_5_11_a'; // 塞雷娅 — a real tier-5 operator of the data

describe('「恭喜发财」: the draft order shows the drawn operator', () => {
  test('nothing while the mode is off / before the draw', () => {
    assert.equal(LuckyOp({ player: { playerId: 'p_0', name: 'A' } }), null);
    assert.equal(LuckyOp({ player: { playerId: 'p_0', name: 'A', lucky: null } }), null);
    assert.equal(LuckyOp({ player: null }), null);
    assert.equal(LuckyOp({ player: { lucky: 7 } }), null, 'never a non-string id');
  });

  test('the drawn operator renders as a tier-5 thumbnail named after the operator', () => {
    const v = LuckyOp({ player: { playerId: 'p_0', name: 'A', lucky: TIER5, luckyName: '塞雷娅' } });
    assert.ok(v, 'a chip');
    assert.ok(hasClass(v, 'dorder__lucky'));
    assert.equal(v.props['data-lucky'], TIER5);
    assert.match(v.props.title, /恭喜发财/);
    assert.match(v.props.title, /塞雷娅/);
    const nodes = [...walk(v)];
    const thumb = nodes.find((n) => n.type === UnitThumb);
    assert.ok(thumb, 'the unit thumbnail');
    assert.equal(thumb.props.kind, 'chess');
    assert.equal(thumb.props.id, TIER5);
    assert.equal(thumb.props.size, 'xs');
    // the operator record the thumbnail reads is the real one: tier 5 (the mode's tier)
    const rec = data.lookup('chess', TIER5);
    assert.equal(rec.tier, LUCKY_MODE.tier);
    assert.equal(rec.name, '塞雷娅');
    assert.ok(textOf(nodes.find((n) => hasClass(n, 'dorder__luckyname'))).includes('塞雷娅'));
  });

  test('without a name from m.public it falls back to the id (never blank)', () => {
    const v = LuckyOp({ player: { lucky: TIER5 } });
    assert.ok(textOf(v).includes(TIER5));
  });
});

describe('「恭喜发财」: the pre-game header mark', () => {
  test('only for a lucky match', () => {
    assert.equal(LuckyTag({ pub: null }), null);
    assert.equal(LuckyTag({ pub: {} }), null);
    assert.equal(LuckyTag({ pub: { lucky: false } }), null);
  });

  test('names the mode and explains itself', () => {
    const v = LuckyTag({ pub: { lucky: true } });
    assert.ok(v, 'the tag');
    assert.ok(hasClass(v, 'lucky-tag'));
    assert.match(textOf(v), new RegExp(LUCKY_MODE.name));
    assert.match(v.props.title, /随机五阶干员/);
  });
});
