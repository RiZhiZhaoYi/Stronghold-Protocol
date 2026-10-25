// The title screen's 下载完整素材 (docs/history/0.3.0.md §32.14.23; the fork's selection): the button, its hint line and
// the dialog. Opening the dialog only reads the served manifests (assetDownload.prepare(), no art) and shows what the
// current selection costs — nothing is downloaded until 开始下载. The groups are shared/assetGroups.js: 核心素材
// (always), one line per dub, the official battle effects (their full-resolution textures separately), the local scenes
// and the gameplay-guide art. 最小可玩 — core plus the dubs the settings name (语音语言, 本土语言 and every per-operator
// override) — is the default preset, so a player who does not choose downloads 448 MB instead of 1011 MB. Closing the
// dialog pauses a run; the import of a local pack has its own button beside this one (ui/assetImport.js, §32.14.39): a
// file already imported counts as ready here and is not requested again.
import { useEffect, useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, ProgressBar } from './components.js';
import { assetDownload } from '../assetDownload.js';
import { GROUP_CORE, GROUP_FX, GROUP_FX_HD, GROUP_GUIDE, GROUP_SCENE, presetGroups } from '../../../shared/assetGroups.js';
import { resolveOfficialFx, touchDevice } from '../render/vfx/tier.js';
import { useSettings } from './settings.js';
import { t, tc } from '../../../shared/i18n.js';

/** Every dub named in its own script, like 设置→语音语言 (ui/settings.js); 'native' is that switch's own name. */
const VOICE_NAMES = { cn: '中文', jp: '日本語', en: 'English', kr: '한국어' }; // i18n-ignore
/** The presets the dialog offers, in order. */
const PRESET_NAMES = ['minimal', 'standard', 'full'];
const mb = (bytes) => ((Number(bytes) || 0) / 1048576).toFixed(1);
const selectionKey = (groups) => [...new Set(Array.isArray(groups) ? groups : [])].filter(Boolean).sort().join(',');

/**
 * The preset whose groups are exactly `selected` — 'custom' once the player changed a box (the dialog then highlights
 * no preset). Exported for the test: the dialog itself only renders the result.
 * @param {string[]} selected @param {{ voiceLang?: string, voiceNative?: boolean, voiceExtra?: string[], fxTier?: string }} opts
 * @returns {'minimal'|'standard'|'full'|'custom'}
 */
export function presetOf(selected, opts) {
  return PRESET_NAMES.find((name) => selectionKey(presetGroups(name, opts)) === selectionKey(selected)) || 'custom';
}

/** 下载完整素材: the button, its hint line and the download dialog. */
export function AssetDownloadButton() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(() => assetDownload.get());
  const settings = useSettings();
  useEffect(() => {
    const off = assetDownload.subscribe(setState);
    setState(assetDownload.get());
    return () => {
      off();
      assetDownload.pause();
    };
  }, []);
  // What 最小可玩 means for this player: their own dub, 本土语言 and every language an operator override names.
  const opts = useMemo(() => ({
    voiceLang: settings.voiceLang,
    voiceNative: settings.voiceNative === true,
    voiceExtra: [...new Set(Object.values(settings.voiceOverrides || {}))],
    fxTier: resolveOfficialFx(settings.officialFx, true, touchDevice()),
  }), [settings.voiceLang, settings.voiceNative, settings.voiceOverrides, settings.officialFx]);

  const busy = ['preparing', 'downloading'].includes(state.phase);
  // Before the first choice the selection is null (every group): the dialog shows and applies 最小可玩.
  const selected = state.selection && state.selection.length ? state.selection : state.available.map((g) => g.group);
  const activePreset = presetOf(selected, opts);
  const openDialog = () => {
    setOpen(true);
    const now = assetDownload.get();
    if (!now.selection) assetDownload.select(presetGroups('minimal', opts));
    void assetDownload.prepare();
  };
  const close = () => {
    assetDownload.pause();
    setOpen(false);
  };
  const toggle = (group, on) => {
    assetDownload.select(on ? [...selected, group] : selected.filter((g) => g !== group));
  };
  const groupLabel = (group) => group === GROUP_CORE ? t('核心素材（干员、敌人、技能与音效）')
    : group === GROUP_FX ? t('官方特效')
      : group === GROUP_FX_HD ? t('完整分辨率特效贴图')
        : group === GROUP_SCENE ? t('官方场景与关卡美术')
          : group === GROUP_GUIDE ? t('玩法说明图')
            : group.startsWith('voice:') && group.slice(6) === 'native' ? tc('voice-lang', '本土语言')
              : VOICE_NAMES[group.slice(6)] || group;
  const status = state.phase === 'complete' ? t('本次素材下载完成')
    : state.phase === 'preparing' ? t('正在读取素材清单…')
      : state.phase === 'paused' ? t('素材下载已暂停')
        : state.phase === 'error' ? t('无法读取素材清单，请检查网络后重试。')
          : state.phase === 'partial' ? t('有 {n} 个素材下载失败', { n: state.failures.length })
            : state.phase === 'downloading' ? t('正在下载素材…')
              : t('选择要下载的素材');
  const label = state.phase === 'complete' ? t('素材已下载')
    : state.phase === 'paused' ? t('继续下载素材') : t('下载完整素材');
  const planned = state.planned || { files: 0, bytes: 0, known: false };
  const planLine = planned.known
    ? t('本次将下载 {files} 个文件，约 {size} MB', { files: planned.files, size: mb(planned.bytes) })
    : t('本次将下载 {files} 个文件', { files: planned.files });
  // done includes both imported files and fully read downloads; cached counts imports only.
  const ready = state.done || 0;
  const missing = Math.max(0, (state.total || 0) - ready);
  const action = state.phase === 'complete' ? t('重新检查')
    : state.phase === 'paused' ? t('继续下载素材')
      : state.phase === 'partial' ? t('重试下载') : t('开始下载');

  return html`<div class="title-assets__item">
    <${Button} variant="secondary" block=${true} size="sm" data-testid="asset-download" aria-describedby="title-asset-download-hint" onClick=${openDialog}>${label}<//>
    <small id="title-asset-download-hint">${t('可选：不下载也能游玩，素材会按需加载；下载时建议使用 Wi-Fi。')}</small>
    <${Modal} open=${open} onClose=${close} title=${t('下载完整素材')} class="asset-download" actions=${html`
      ${busy ? html`<${Button} onClick=${() => assetDownload.pause()}>${t('暂停下载')}<//>`
        : html`<${Button} variant="primary" data-testid="asset-download-start"
          disabled=${!state.prepared && state.phase !== 'error' && state.phase !== 'partial' && state.phase !== 'complete'}
          onClick=${() => void assetDownload.start()}>${action}<//>`}
      <${Button} onClick=${close}>${t('关闭')}<//>`}>
      <p role="status" data-testid="asset-download-status">${status}</p>
      <div class="set-seg asset-download__presets" role="radiogroup" aria-label=${t('选择要下载的素材')}>
        ${PRESET_NAMES.map((name) => {
          const plan = assetDownload.plan(presetGroups(name, opts));
          return html`<button key=${name} type="button" role="radio" data-testid=${`asset-preset-${name}`}
            aria-checked=${activePreset === name ? 'true' : 'false'} class=${activePreset === name ? 'is-on' : ''}
            disabled=${busy} onClick=${() => assetDownload.select(presetGroups(name, opts))}>
            <span>${name === 'minimal' ? t('最小可玩') : name === 'standard' ? t('推荐') : t('完整')}</span>
            ${state.prepared ? html`<small>${plan.known ? t('约 {size} MB', { size: mb(plan.bytes) }) : t('{n} 个文件', { n: plan.files })}</small>` : null}
          </button>`;
        })}
      </div>
      <div class="asset-download__groups">
        ${state.available.map((entry) => html`<div class="asset-download__group" key=${entry.group}>
          <label>
            <input type="checkbox" data-testid=${`asset-group-${entry.group}`} checked=${selected.includes(entry.group)}
              disabled=${busy || entry.group === GROUP_CORE} onChange=${(event) => toggle(entry.group, event.currentTarget.checked)} />
            <span>${groupLabel(entry.group)}</span>
          </label>
          <em>${entry.bytes > 0 ? t('约 {size} MB', { size: mb(entry.bytes) }) : t('{n} 个文件', { n: entry.files })}</em>
        </div>`)}
      </div>
      <p>${planLine}</p>
      <p class="t-lo">${t('选择分组后点「开始下载」；已下载的文件不会重复下载，暂停时可以改选。')}</p>
      <${ProgressBar} value=${state.done} max=${state.total || 1} label=${t('已完成 {done} / {total} 个文件', { done: state.done, total: state.total })} />
      <p>${t('已读取 {size} MB（含浏览器缓存）', { size: (state.bytes / 1048576).toFixed(1) })}</p>
      ${state.total > 0 ? html`<p>${t('已就绪 {ready}，缺少 {missing}', { ready, missing })}</p>` : null}
      ${busy || state.phase === 'paused' ? html`<ul class="asset-download__progress">
        ${Object.entries(state.byGroup || {}).map(([group, entry]) => html`<li key=${group}>${groupLabel(group)}<em>${t('{done} / {total}', { done: entry.done, total: entry.files })}</em></li>`)}
      </ul>` : null}
      <p class="t-lo">${t('已导入的素材直接使用，不再向服务器请求。')}</p>
      <p class="t-lo">${t('下载本服务器提供的素材到浏览器缓存。关闭窗口会暂停；缓存被清理后可再次下载。')}</p>
      ${state.localMissing ? html`<p class="t-lo">${t('服务器未提供额外的本地素材包，将使用基础素材。')}</p>` : null}
      ${state.failures.length ? html`<div class="asset-download__errors">
        <p>${t('下载未完成。请重试；若文件持续缺失，请联系服主补齐素材。')}</p>
        <details><summary>${t('查看失败文件')}</summary><ul>
          ${state.failures.slice(0, 30).map((item) => html`<li key=${item.url}><code>${item.url}</code> (${item.status})</li>`)}
        </ul></details>
      </div>` : null}
    <//>
  </div>`;
}
