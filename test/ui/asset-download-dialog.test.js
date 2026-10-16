// The download dialog's preset highlight (public/js/ui/assetDownload.js presetOf): the loading and the switching itself
// are the SP_E2E browser test's (test/ui/asset-download.browser.test.js); this keeps the choice-matching rule honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetOf } from '../../public/js/ui/assetDownload.js';
import { GROUP_CORE, presetGroups } from '../../shared/assetGroups.js';

test('presetOf: a selection that is exactly a preset highlights it, anything else is 自定义', () => {
  const opts = { voiceLang: 'cn', voiceNative: false, voiceExtra: [], fxTier: 'lite' };
  for (const name of ['minimal', 'standard', 'full']) assert.equal(presetOf(presetGroups(name, opts), opts), name);
  assert.equal(presetOf(['core'], opts), 'custom', 'a hand-picked subset is not a preset');
  assert.equal(presetOf(presetGroups('minimal', opts).slice().reverse(), opts), 'minimal', 'the order does not matter');
  const jp = { voiceLang: 'jp', voiceNative: true, voiceExtra: ['kr'], fxTier: 'full' };
  assert.equal(presetOf(presetGroups('minimal', jp), jp), 'minimal');
  assert.equal(presetOf(presetGroups('minimal', opts), jp), 'custom', 'another player’s 最小可玩 is not this one');
  assert.equal(presetOf([GROUP_CORE], { ...opts, voiceLang: 'jp' }), 'custom');
});
