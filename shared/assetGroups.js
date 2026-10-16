// The asset groups of the served manifests (shared/assetGroups.js): one art URL → one group key, shared by the server
// (the per-group byte totals of the served views, server/http/assetViews.js) and by the client (the title screen's
// 下载完整素材 selection, public/js/assetDownload.js). Deliberately free of any UI text: this file only decides which
// URL belongs to which group, the dialog names a group with its own translated label.
//
//   core    everything a match needs: operator/enemy/token models and portraits, skill and item icons, UI art, BGM,
//           sound effects, fonts — and the local client's extra models and emoticons (small, needed in a match)
//   guide   the gameplay-guide art, large pictures read only when the guide is opened
//   fx      the official battle effects: descriptors, meshes, the index and the half-size textures
//   fx:hd   those effects' full-resolution textures (skippable: 官方特效「精简」 draws the half-size ones)
//   scene   the local scenes, maps, meshes and the map UI atlases the server's owner extracted
//   voice:<lang>  one dub, by the language directory of a voice URL (cn, jp, en, kr, native)
//
// A served URL may carry a content-hash segment (/assets/~<16 hex>/…) and audio is requested in its /media/… form
// (media.js): both are removed before the group is decided, so the committed manifest and the served view classify
// exactly alike.

/** Everything a match needs. */
export const GROUP_CORE = 'core';
/** The gameplay-guide art. */
export const GROUP_GUIDE = 'guide';
/** The local scenes, maps, meshes and their UI atlases. */
export const GROUP_SCENE = 'scene';
/** The official battle effects without their full-resolution textures. */
export const GROUP_FX = 'fx';
/** The official battle effects' full-resolution textures. */
export const GROUP_FX_HD = 'fx:hd';
/** Dub languages, in the order the dialog lists them. */
export const VOICE_LANGS = Object.freeze(['cn', 'jp', 'en', 'kr', 'native']);
/** The group of one dub. */
export const voiceGroup = (lang) => `voice:${lang}`;
/** Every group (the dialog's order: core, the dubs, then the optional art). */
export const ALL_GROUPS = Object.freeze([GROUP_CORE, ...VOICE_LANGS.map(voiceGroup), GROUP_FX, GROUP_FX_HD, GROUP_SCENE, GROUP_GUIDE]);
/** The presets the dialog offers; 'minimal' is its default. */
export const PRESETS = Object.freeze(['minimal', 'standard', 'full']);

const GROUP_SET = new Set(ALL_GROUPS);
const HASH_SEG = /\/~[0-9a-f]{16}(?=\/)/;
const VOICE_SEG = /\/voice\/(cn|jp|en|kr|native)\//;
const ART_URL = /^\/(?:assets|fonts|media)\//;
const LOCAL_FX = '/assets/local/fx/';
const LOCAL_FX_HALF = '/assets/local/fx/tex/half/';
const LOCAL_FX_HD = '/assets/local/fx/tex/';
const LOCAL_SCENE = /^\/assets\/local\/(?:scene|map|mesh|ui|module|projectiles|tex)\//;

/**
 * The path a URL is classified by: its /media/… form reads as /assets/audio/… and a content-hash segment is dropped
 * (never a data URL — those are not art).
 * @param {string} url
 * @returns {string}
 */
export function groupPathOf(url) {
  if (typeof url !== 'string' || !url) return '';
  return url.replace(/^\/media\//, '/assets/audio/').replace(HASH_SEG, '');
}

/**
 * The group of one art URL. Anything that is not one of the groups above — including a URL that is not art at all — is
 * 'core', so a caller that hands over every string of a manifest never loses a file.
 * @param {string} url
 * @returns {string}
 */
export function groupOf(url) {
  const p = groupPathOf(url);
  if (!ART_URL.test(p)) return GROUP_CORE;
  const voice = VOICE_SEG.exec(p);
  if (voice) return voiceGroup(voice[1]);
  if (p.startsWith(LOCAL_FX_HD) && !p.startsWith(LOCAL_FX_HALF)) return GROUP_FX_HD;
  if (p.startsWith(LOCAL_FX)) return GROUP_FX;
  if (p.startsWith('/assets/local/guide/') || p.startsWith('/assets/ui/guide/')) return GROUP_GUIDE;
  if (LOCAL_SCENE.test(p)) return GROUP_SCENE;
  return GROUP_CORE;
}

/**
 * The groups a preset downloads.
 * @param {'minimal'|'standard'|'full'} preset
 * @param {{ voiceLang?: string, voiceNative?: boolean, voiceExtra?: string[], fxTier?: 'off'|'lite'|'full' }} [opts]
 *   voiceLang: the settings' 语音语言; voiceNative: the 本土语言 switch; voiceExtra: every language a per-operator
 *   override names (a group is a whole language, not a character); fxTier: render/vfx/tier.js's resolved tier.
 * @returns {string[]}
 */
export function presetGroups(preset, opts = {}) {
  const langs = new Set();
  if (VOICE_LANGS.includes(opts.voiceLang)) langs.add(opts.voiceLang);
  if (opts.voiceNative === true) langs.add('native');
  for (const lang of Array.isArray(opts.voiceExtra) ? opts.voiceExtra : []) if (VOICE_LANGS.includes(lang)) langs.add(lang);
  if (!langs.size) langs.add('cn');
  const voice = [...langs].map(voiceGroup);
  if (preset === 'full') return [...ALL_GROUPS];
  if (preset === 'standard') {
    const fx = opts.fxTier === 'off' ? [] : opts.fxTier === 'full' ? [GROUP_FX, GROUP_FX_HD] : [GROUP_FX];
    return [GROUP_CORE, ...voice, ...fx, GROUP_SCENE];
  }
  return [GROUP_CORE, ...voice];
}

/** The known groups of a list, deduplicated and in ALL_GROUPS order (what the store keeps as its selection). */
export function normalizeGroups(groups) {
  const want = new Set(Array.isArray(groups) ? groups : []);
  return ALL_GROUPS.filter((g) => want.has(g));
}

/** A comparable key of a selection (null = every group). */
export function groupsKey(groups) {
  if (!Array.isArray(groups)) return '';
  return [...new Set(groups)].filter((g) => GROUP_SET.has(g)).sort().join(',');
}
