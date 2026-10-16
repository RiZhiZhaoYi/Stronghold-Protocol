// Explicit title-screen predownload with a selection (the fork's 下载完整素材 dialog): the served manifests name every
// art file, the dialog picks groups (shared/assetGroups.js) and the queue fetches only those. Reuse the game's HTTP
// cache and exact manifest URLs; never decode every model/image/audio file into RAM or persist an unverified
// "complete" flag. A URL already stored by a local import (assetPack.js) is marked done and not requested again.
//
// prepare() reads the three served manifests and the per-group `sizes` map they carry
// (server/http/assetViews.js) and requests no art: the dialog can then say what the current selection costs before
// its first file. select() changes the selection (a run in flight is left alone), start() downloads it. A server
// without `sizes` (an older one, a static host) still works — the sizes are unknown and only the counts show.
import { mediaUrl } from './media.js';
import { listImportedPaths } from './assetCache.js';
import { ALL_GROUPS, GROUP_CORE, groupOf, groupsKey, normalizeGroups } from '../../shared/assetGroups.js';

/**
 * Collect only same-origin art files, including all Spine pages and optional local scenes.
 * The served 0.3.0 views are walked as they are: hashed `/assets/~…` and `/fonts/~…` URLs, the extra dub banks
 * (`voiceEn` / `voiceKr` / `voiceNative`), statistics-page art, and local groups such as the 射击台 mesh. A cosmetic
 * plugin's own files are `/p/<id>/<hash8>/…` and are not in these manifests, so they are not queued here. The official
 * battle effects (DESIGN §33) come in their own manifest, /data/local-fx.json, read the same way when the host has them.
 */
export function collectAssetUrls(...manifests) {
  const urls = new Set();
  const visit = (value) => {
    if (typeof value === 'string') {
      if (/^\/(?:assets|fonts)\/[^/]/.test(value) && !/[?#\\]/.test(value)) urls.add(mediaUrl(value));
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) visit(child);
    }
  };
  manifests.forEach(visit);
  // Fetch models/images before audio, so an interrupted download still improves battle visuals.
  return [...urls].sort((a, b) => Number(a.startsWith('/media/')) - Number(b.startsWith('/media/')) || a.localeCompare(b));
}

/** The `sizes` maps of the served manifests merged: group → { files, bytes } (absent when the server has none). */
export function mergeSizes(...docs) {
  const out = {};
  for (const doc of docs) {
    const sizes = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc.sizes : null;
    if (!sizes || typeof sizes !== 'object' || Array.isArray(sizes)) continue;
    for (const [group, entry] of Object.entries(sizes)) {
      if (!entry || typeof entry !== 'object') continue;
      const files = Number(entry.files);
      const bytes = Number(entry.bytes);
      const sum = out[group] || (out[group] = { files: 0, bytes: 0 });
      sum.files += Number.isFinite(files) && files > 0 ? files : 0;
      sum.bytes += Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    }
  }
  return out;
}

/** How many files each group of a URL list holds (known without any size: the dialog always shows these). */
export function countGroups(urls) {
  const out = {};
  for (const url of urls) {
    const group = groupOf(url);
    out[group] = (out[group] || 0) + 1;
  }
  return out;
}

/** A bounded, pausable download queue. A file counts only after its entire body arrives. */
export function createAssetDownload({ fetch: doFetch = (...args) => globalThis.fetch(...args),
  concurrency = 8, timeoutMs = 60000, retries = 2, lookupImported = listImportedPaths } = {}) {
  let state = { phase: 'idle', total: 0, done: 0, bytes: 0, failures: [], localMissing: false, cached: 0,
    prepared: false, selection: null, groups: [], available: [], planned: { files: 0, bytes: 0, known: false }, byGroup: {} };
  let urls = null, sizes = {}, counts = {}, selection = null;
  let running = null, reading = null, controller = null, paused = false, lastNotice = 0;
  const complete = new Set(), failures = new Map(), listeners = new Set();
  const groupDone = new Map();

  /** The groups the manifests name, in ALL_GROUPS order, each with its byte total when the server gave one. */
  function available() {
    if (!urls) return [];
    return ALL_GROUPS.filter((group) => counts[group]).map((group) => ({ group, files: counts[group], bytes: sizes[group]?.bytes || 0 }));
  }

  /** What a group list costs: its files always, its bytes only while every group of it has a served size. */
  function planFor(groups) {
    const chosen = normalizeGroups(groups);
    let files = 0, bytes = 0, known = chosen.length > 0;
    for (const group of chosen) {
      files += counts[group] || 0;
      if (sizes[group]) bytes += sizes[group].bytes; else known = false;
    }
    return { files, bytes, known };
  }

  const chosenGroups = () => (selection ? [...selection] : [...ALL_GROUPS]);

  function emit(force = false) {
    if (!force && Date.now() - lastNotice < 100) return;
    lastNotice = Date.now();
    const chosen = chosenGroups();
    const byGroup = {};
    if (urls) {
      for (const group of chosen) if (counts[group]) byGroup[group] = { files: counts[group], done: groupDone.get(group) || 0 };
    }
    state = { ...state, done: complete.size, failures: [...failures.values()], groups: chosen, selection,
      available: available(), planned: planFor(chosen), byGroup, total: urls ? planFor(chosen).files : 0 };
    for (const listener of listeners) listener(state);
  }

  async function request(url, json = false, optional = false) {
    for (let attempt = 0; ; attempt++) {
      const abort = new AbortController();
      const cancel = () => abort.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      if (controller.signal.aborted) cancel();
      const timer = setTimeout(cancel, timeoutMs);
      try {
        const response = await doFetch(url, { signal: abort.signal, cache: json ? 'no-cache' : 'default' });
        if (optional && response.status === 404) { await response.body?.cancel(); return null; }
        if (!response.ok || response.status === 206) {
          await response.body?.cancel();
          throw Object.assign(new Error('Asset request failed'), { status: response.status });
        }
        // Static hosts sometimes send their HTML fallback with status 200 for missing art.
        if (/text\/html/i.test(response.headers.get('content-type') || '')) {
          await response.body?.cancel();
          throw Object.assign(new Error('Unexpected HTML response'), { status: 'html' });
        }
        if (json) return await response.json();
        let size = 0;
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              state = { ...state, bytes: state.bytes + value.byteLength };
              emit();
            }
          } finally { reader.releaseLock(); }
        } else {
          size = (await response.arrayBuffer()).byteLength;
          state = { ...state, bytes: state.bytes + size };
        }
        if (!size) throw Object.assign(new Error('Empty asset response'), { status: 'empty' });
        return;
      } catch (error) {
        if (paused) throw error;
        const transient = !error.status || error.status >= 500 || [408, 429].includes(error.status);
        if (!transient || attempt >= retries) throw Object.assign(error, { url });
        // Keep retries bounded and avoid hammering a struggling server.
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        if (paused) throw error;
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', cancel);
      }
    }
  }

  /** The manifests and the groups they name. Sequential reads keep cancellation simple. */
  async function read() {
    state = { ...state, phase: 'preparing', error: null };
    emit(true);
    try {
      const assets = await request('/data/assets.json', true);
      const local = await request('/data/local-assets.json', true, true);
      // the official battle effects' files (DESIGN §33): optional, like the local manifest
      const fx = await request('/data/local-fx.json', true, true);
      if (!assets || typeof assets !== 'object' || Array.isArray(assets)
        || (local !== null && (!local || typeof local !== 'object' || !local.groups))
        || (fx !== null && (!fx || typeof fx !== 'object' || !fx.groups))) throw new Error('Invalid asset manifest');
      const list = collectAssetUrls(assets, local, fx);
      if (!list.length) throw new Error('Empty asset manifest');
      urls = list;
      sizes = mergeSizes(assets, local, fx);
      counts = countGroups(list);
      state = { ...state, phase: 'ready', prepared: true, localMissing: local === null };
    } catch (error) {
      if (!paused) state = { ...state, phase: 'error', error: { url: error.url, status: error.status || 'manifest' } };
    }
    emit(true);
  }

  function readManifests() {
    if (urls) return Promise.resolve();
    if (!reading) reading = read().finally(() => { reading = null; });
    return reading;
  }

  /** Forget what a previous selection downloaded (a new selection downloads its own files). */
  function resetProgress() {
    complete.clear();
    failures.clear();
    groupDone.clear();
    state = { ...state, failures: [], cached: 0 };
  }

  async function run() {
    try {
      if (!urls) {
        await readManifests();
        if (!urls) return;   // the manifests did not arrive: the error phase stands
      }
      if (paused) return;
      const plan = planFor(chosenGroups());
      state = { ...state, phase: 'downloading', total: plan.files, failures: [] };
      emit(true);
      let imported = null;
      try { imported = await lookupImported(); } catch { imported = null; }
      if (paused) return;
      let cached = 0;
      const queue = [];
      for (const url of urls) {
        if (selection && !selection.includes(groupOf(url))) continue;
        let path = url;
        try { path = new URL(url, 'http://localhost').pathname; } catch { /* keep the queue string */ }
        if (imported && typeof imported.has === 'function' && (imported.has(url) || imported.has(path))) {
          cached++;
          complete.add(url);
        } else if (!complete.has(url)) queue.push(url);
      }
      // the per-group progress of what this run starts from (imports included)
      groupDone.clear();
      for (const url of complete) groupDone.set(groupOf(url), (groupDone.get(groupOf(url)) || 0) + 1);
      state = { ...state, cached };
      if (paused) return;
      failures.clear();
      state = { ...state, phase: 'downloading' };
      emit(true);
      let next = 0;
      const worker = async () => {
        while (!paused && next < queue.length) {
          const url = queue[next++];
          const group = groupOf(url);
          try {
            await request(url);
            complete.add(url);
            groupDone.set(group, (groupDone.get(group) || 0) + 1);
          } catch (error) {
            if (!paused) failures.set(url, { url, status: error.status || 'network' });
          }
          emit();
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(8, concurrency)) }, worker));
      if (!paused) state = { ...state, phase: failures.size ? 'partial' : 'complete' };
    } catch (error) {
      if (!paused) state = { ...state, phase: 'error', error: { url: error.url, status: error.status || 'manifest' } };
    } finally {
      if (paused) state = { ...state, phase: 'paused' };
      emit(true);
    }
  }

  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** Read the served manifests (and their group sizes) without requesting one art file. */
    prepare() {
      if (urls) return Promise.resolve();
      if (!reading) {
        paused = false;
        controller = new AbortController();
      }
      return readManifests();
    },
    /** What a group list would cost — the dialog's preflight ({ files, bytes, known }). */
    plan: (groups) => planFor(groups),
    /**
     * Choose the groups a run downloads (null/undefined: every group, []: only 'core'). Ignored while a run is in
     * flight — the dialog disables its checkboxes then; a paused run picks the new selection up when it resumes.
     */
    select(groups) {
      if (running || reading) return false;
      const next = groups === null || groups === undefined ? null : normalizeGroups(groups.length ? groups : [GROUP_CORE]);
      if (groupsKey(next || ALL_GROUPS) === groupsKey(selection || ALL_GROUPS)) return true;
      selection = next;
      resetProgress();
      state = { ...state, phase: urls ? 'ready' : 'idle' };
      emit(true);
      return true;
    },
    start(options = {}) {
      // A run in flight absorbs the call (the dialog's button is disabled then); a paused one settles at once and the
      // resume waits for it, so 继续下载素材 is never dropped by the aborted run's own teardown.
      if (running && !paused) return running;
      const previous = running;
      const begin = () => {
        const wanted = options && options.groups !== undefined ? options.groups : undefined;
        if (wanted !== undefined) {
          const next = wanted === null ? null : normalizeGroups(wanted.length ? wanted : [GROUP_CORE]);
          if (groupsKey(next || ALL_GROUPS) !== groupsKey(selection || ALL_GROUPS)) { selection = next; resetProgress(); }
        }
        paused = false;
        controller = new AbortController();
        // A new check after completion revalidates the manifest and all files through the HTTP cache.
        if (state.phase === 'complete') {
          urls = null;
          resetProgress();
          state = { phase: 'idle', total: 0, done: 0, bytes: 0, failures: [], localMissing: false, cached: 0,
            prepared: false, selection, groups: [], available: [], planned: { files: 0, bytes: 0, known: false }, byGroup: {} };
        }
        return run();
      };
      const started = previous ? previous.then(begin, begin) : begin();
      running = started.finally(() => { running = null; });
      return running;
    },
    pause() { if (running || reading) { paused = true; controller?.abort(); } },
  };
}

export const assetDownload = createAssetDownload();
