// The asset groups (shared/assetGroups.js) and the served views' per-group sizes (server/http/assetViews.js,
// manifestSizes): the download dialog's selection and its "about N MB" preflight both read them, so the classification
// has to be stable across a committed manifest (/assets/…) and the served view (a content-hash segment, /media/… audio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_GROUPS, GROUP_CORE, GROUP_FX, GROUP_FX_HD, GROUP_GUIDE, GROUP_SCENE, groupOf, groupsKey, normalizeGroups, presetGroups, voiceGroup,
} from '../shared/assetGroups.js';
import { manifestSizes } from '../server/http/assetViews.js';

test('groupOf: one group per URL, the same for the committed and the served form', () => {
  const cases = [
    ['/assets/char/avatar/char_a.png', GROUP_CORE],
    ['/assets/~0123456789abcdef/char/avatar/char_a.png', GROUP_CORE],
    ['/assets/audio/bgm/x.mp3', GROUP_CORE],
    ['/assets/audio/sfx/general/g_ui/a.mp3', GROUP_CORE],
    ['/assets/local/spine/token/t/t.skel', GROUP_CORE],
    ['/assets/local/emoticon/basic/a.png', GROUP_CORE],
    ['/fonts/f.woff2', GROUP_CORE],
    ['/assets/audio/voice/cn/char_a/1.mp3', voiceGroup('cn')],
    ['/media/voice/jp/char_a/1', voiceGroup('jp')],
    ['/media/~0123456789abcdef/voice/kr/char_a/1', voiceGroup('kr')],
    ['/assets/~0123456789abcdef/audio/voice/en/char_a/1.mp3', voiceGroup('en')],
    ['/assets/audio/voice/native/char_a_ita/1.mp3', voiceGroup('native')],
    ['/assets/local/fx/prefabs/a.json', GROUP_FX],
    ['/assets/~0123456789abcdef/local/fx/tex/half/a.webp', GROUP_FX],
    ['/assets/local/fx/index.json', GROUP_FX],
    ['/assets/local/fx/tex/a.webp', GROUP_FX_HD],
    ['/assets/ui/guide/1.png', GROUP_GUIDE],
    ['/assets/local/guide/1.png', GROUP_GUIDE],
    ['/assets/local/scene/act1autochess_m01/lm.png', GROUP_SCENE],
    ['/assets/local/ui/battle/a.png', GROUP_SCENE],
    ['/assets/local/map/autochess/a.bin', GROUP_SCENE],
  ];
  for (const [url, want] of cases) assert.equal(groupOf(url), want, url);
  assert.deepEqual(ALL_GROUPS, [GROUP_CORE, ...['cn', 'jp', 'en', 'kr', 'native'].map(voiceGroup), GROUP_FX, GROUP_FX_HD, GROUP_SCENE, GROUP_GUIDE]);
});

test('presetGroups: 最小可玩 is core plus the settings’ own dubs, 推荐 adds the effects and the scenes, 完整 everything', () => {
  assert.deepEqual(presetGroups('minimal', { voiceLang: 'cn' }), [GROUP_CORE, voiceGroup('cn')]);
  assert.deepEqual(presetGroups('minimal', { voiceLang: 'jp', voiceNative: true, voiceExtra: ['kr', 'kr'] }),
    [GROUP_CORE, voiceGroup('jp'), voiceGroup('native'), voiceGroup('kr')]);
  assert.deepEqual(presetGroups('minimal', { voiceLang: 'de' }), [GROUP_CORE, voiceGroup('cn')], 'an unknown dub falls back to Chinese');
  assert.deepEqual(presetGroups('standard', { voiceLang: 'cn', fxTier: 'lite' }), [GROUP_CORE, voiceGroup('cn'), GROUP_FX, GROUP_SCENE]);
  assert.deepEqual(presetGroups('standard', { voiceLang: 'cn', fxTier: 'full' }), [GROUP_CORE, voiceGroup('cn'), GROUP_FX, GROUP_FX_HD, GROUP_SCENE]);
  assert.deepEqual(presetGroups('standard', { voiceLang: 'cn', fxTier: 'off' }), [GROUP_CORE, voiceGroup('cn'), GROUP_SCENE]);
  assert.deepEqual(presetGroups('full', {}), [...ALL_GROUPS]);
  assert.deepEqual(normalizeGroups(['fx', 'nonsense', 'core']), [GROUP_CORE, GROUP_FX]);
  assert.deepEqual(normalizeGroups('core'), []);
  assert.equal(groupsKey(['fx', 'core']), groupsKey(['core', 'fx']));
});

test('manifestSizes: the files of each group, deduplicated, sized by the index', () => {
  const sizes = { 'assets/char/a.png': 10, 'assets/audio/voice/jp/c/1.mp3': 20,
    'assets/local/fx/tex/a.webp': 30, 'assets/local/fx/tex/half/a.webp': 5 };
  const index = { sizeOf: (rel) => sizes[rel] ?? null };
  const doc = { chars: { c: { avatar: '/assets/char/a.png', avatarE2: '/assets/char/a.png' } },
    audio: { voiceJp: { c: { start: '/assets/audio/voice/jp/c/1.mp3' } } },
    local: { fx: { a: { path: '/assets/local/fx/tex/a.webp', half: '/assets/local/fx/tex/half/a.webp' },
      b: { path: '/assets/char/unknown.png' } } } };
  assert.deepEqual(manifestSizes(doc, index), {
    [GROUP_CORE]: { files: 2, bytes: 10 },
    [voiceGroup('jp')]: { files: 1, bytes: 20 },
    [GROUP_FX_HD]: { files: 1, bytes: 30 },
    [GROUP_FX]: { files: 1, bytes: 5 },
  });
  assert.deepEqual(manifestSizes({ a: '/assets/unknown.png', b: 'not a url', c: '/data/assets.json' }, {}),
    { [GROUP_CORE]: { files: 1, bytes: 0 } }, 'a file the index does not know is counted, not dropped');
});
