// Shared by the 3D guitar and the 3D pad: fetch a .glb with progress + timeout, a per-key in-memory cache (a model loaded once is instant next time),
// and the "buffering" overlay (spinner, caption, progress %, slow-connection hint, and the error state with Retry).
const SLOW_MS = 8000, TIMEOUT_MS = 30000;

async function fetchBuf(url, onProgress) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !total) return await r.arrayBuffer();
    const rd = r.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onProgress?.(Math.min(1, got / total)); }
    const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out.buffer;
  } catch (e) { throw ac.signal.aborted ? new Error('timed out') : e; } finally { clearTimeout(timer); }
}

// cache: Map key -> {p, frac, ls}. Failed loads are dropped so Retry really re-fetches.
export function loadGLB(cache, key, libP, url, onProgress) {
  let e = cache.get(key);
  if (!e) {
    e = { frac: null, ls: new Set(), done: false };
    e.p = (async () => {
      const buf = await fetchBuf(url, (f) => { e.frac = f; e.ls.forEach((l) => l(f)); });
      const T = await libP();
      return new T.GLTFLoader().parseAsync(buf, url.replace(/[^/]*$/, ''));
    })();
    e.p.then(() => { e.done = true; }, () => { if (cache.get(key) === e) cache.delete(key); });
    cache.set(key, e);
  }
  if (onProgress) { e.ls.add(onProgress); if (e.frac != null) onProgress(e.frac); }
  return e.p;
}
export const isCached = (cache, key) => !!cache.get(key)?.done;

const R = 20, C = 2 * Math.PI * R;
// Overlay: .m3d-load > [spinner svg][caption][hint]. States: show(label) / progress(f) / error(msg, retry) / hide().
export function createLoadBox(host) {
  const el = document.createElement('div'); el.className = 'm3d-load'; el.hidden = true;
  el.setAttribute('role', 'status');
  el.innerHTML = `<svg class="m3d-spin" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle class="m3d-ring" cx="24" cy="24" r="${R}"/><circle class="m3d-arc" cx="24" cy="24" r="${R}"/></svg>
<div class="m3d-cap"></div><div class="m3d-hint"></div><button type="button" class="btn m3d-retry" hidden>Retry</button>`;
  host.appendChild(el);
  const $ = (s) => el.querySelector(s), cap = $('.m3d-cap'), hint = $('.m3d-hint'), btn = $('.m3d-retry'), arc = $('.m3d-arc');
  let timer = 0, label = '', retry = null;
  btn.addEventListener('click', () => retry?.());
  const api = {
    el,
    show(l, lite = false) {
      label = l; clearTimeout(timer); el.hidden = false; el.classList.remove('err'); el.classList.toggle('scrim', lite);
      el.classList.remove('det'); arc.style.strokeDasharray = ''; btn.hidden = true; cap.textContent = label; hint.textContent = '';
      timer = setTimeout(() => { hint.textContent = 'Slow connection: still loading'; }, SLOW_MS);
    },
    progress(f) {
      if (el.hidden || el.classList.contains('err') || !(f >= 0)) return;
      el.classList.add('det'); arc.style.strokeDasharray = `${(C * f).toFixed(1)} ${C.toFixed(1)}`;
      cap.textContent = `${label} ${Math.round(f * 100)}%`;
    },
    error(msg, fn) { clearTimeout(timer); el.hidden = false; el.classList.add('err', 'scrim'); cap.textContent = msg; hint.textContent = ''; retry = fn; btn.hidden = !fn; },
    hide() { clearTimeout(timer); el.hidden = true; },
    get visible() { return !el.hidden; },
  };
  return api;
}

// The "simple view" note shown above the 2D drawing when the model could not be loaded.
export function createFallbackNote(anchor, retry) {
  const n = document.createElement('div'); n.className = 'm3d-note'; n.setAttribute('role', 'status');
  n.innerHTML = '<span>Showing the simple view</span><button type="button" class="btn m3d-retry">Retry</button>';
  n.querySelector('button').addEventListener('click', retry);
  anchor.parentNode.insertBefore(n, anchor);
  return n;
}
