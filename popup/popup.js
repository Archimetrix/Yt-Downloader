// YT DOWNLOADER - popup. Apache-2.0.
const DEFAULTS = { askEveryTime: true, defaultType: 'video', defaultHeight: 'best', defaultAudio: 'm4a', defaultContainer: 'mp4', autoUpdateCheck: true, baseFolder: '', maxParallel: 2 };
const $ = (s) => document.querySelector(s);
const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="54"><rect width="96" height="54" fill="#8884"/><path d="M40 17l20 10-20 10z" fill="#8888"/></svg>');
const thumbUrl = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
const size = (n) => !n ? '' : n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? Math.round(n / 1e6) + ' MB' : Math.round(n / 1e3) + ' KB';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const withFallback = (img, id) => { img.alt = ''; img.decoding = 'async'; img.src = thumbUrl(id); img.addEventListener('error', () => { img.src = PLACEHOLDER; }, { once: true }); return img; };

/* ------------------------------- tabs ------------------------------- */
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab, .panel').forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  $('#' + t.dataset.tab).classList.add('active');
  if (t.dataset.tab === 'history') paintHistory(true);
}));

/* ------------------------------ QUEUE ------------------------------ */
// Only downloads that are running (or failed and need attention) live here.
// Finished downloads are moved to History by the page script.
const STALE_MS = 20000; // a running job that stops reporting means its tab is gone
const qNodes = new Map();
async function renderJobs() {
  const { dlJobs = [] } = await chrome.storage.local.get('dlJobs');
  const now = Date.now();
  const jobs = dlJobs
    .map((j) => (j.status === 'running' && now - j.ts > STALE_MS ? { ...j, status: 'error', message: 'Interrupted: the YouTube tab was closed or reloaded.' } : j))
    .filter((j) => j.status === 'running' || j.status === 'error');
  const running = jobs.filter((j) => j.status === 'running');

  $('#qbadge').hidden = !running.length; $('#qbadge').textContent = running.length;
  $('#qempty').classList.toggle('show', jobs.length === 0);
  $('#qtip').hidden = !running.length;
  $('#qsummary').textContent = running.length ? `${running.length} downloading` : jobs.length ? 'Needs attention' : '';
  $('#qcancel').hidden = !running.length;

  const list = $('#qlist'), seen = new Set();
  for (const j of jobs) {
    seen.add(j.id);
    let n = qNodes.get(j.id);
    if (!n) {
      const li = el('li', 'qcard');
      const img = withFallback(el('img', 'thumb'), j.videoId); img.loading = 'lazy';
      const info = el('div', 'info');
      const title = el('div', 'title'); const meta = el('div', 'meta');
      const err = el('div', 'meta err'); const bar = el('div', 'bar'); const fill = el('i'); bar.append(fill);
      info.append(title, meta, err, bar);
      const btn = el('button', 'iconbtn', '✕');
      btn.addEventListener('click', async () => {
        const cur = n.job;
        if (cur.status === 'running') await chrome.storage.local.set({ dlCancel: { ids: [cur.id], n: Date.now() } });
        else await chrome.storage.local.set({ dlJobs: ((await chrome.storage.local.get('dlJobs')).dlJobs || []).filter((x) => x.id !== cur.id) });
      });
      li.append(img, info, btn);
      n = { li, title, meta, err, bar, fill, btn, job: j };
      qNodes.set(j.id, n); list.append(li);
    }
    n.job = j;
    n.li.classList.toggle('error', j.status === 'error');
    n.title.textContent = j.title || j.videoId;
    const kind = (j.mode === 'audio' ? 'Audio' : 'Video') + (j.label ? ' · ' + j.label : '');
    let status = j.message || 'Working…';
    const pct = j.phase === 'download' && typeof j.ratio === 'number' ? Math.round(j.ratio * 100) : null;
    if (j.status === 'running' && pct != null) status = `Downloading ${pct}%`;
    if (j.status === 'error') status = 'Failed';
    n.meta.textContent = `${kind} · ${status}`;
    n.err.hidden = !(j.status === 'error' && j.message); n.err.textContent = j.message || '';
    n.bar.hidden = j.status !== 'running';
    n.bar.classList.toggle('ind', pct == null);
    n.fill.style.width = pct != null ? pct + '%' : '';
    n.btn.title = j.status === 'running' ? 'Cancel' : 'Dismiss';
  }
  for (const [id, n] of qNodes) if (!seen.has(id)) { n.li.remove(); qNodes.delete(id); }
}
$('#qcancel').addEventListener('click', async () => {
  const { dlJobs = [] } = await chrome.storage.local.get('dlJobs');
  await chrome.storage.local.set({ dlCancel: { ids: dlJobs.filter((j) => j.status === 'running').map((j) => j.id), n: Date.now() } });
});
setInterval(renderJobs, 5000); // refreshes the "interrupted" detection
renderJobs();

/* ----------------------------- HISTORY -----------------------------
 * Windowed list: only the rows on screen exist in the DOM, so it stays
 * perfectly smooth with thousands of entries. Rows are grouped by day.
 */
const HEAD_H = 34, ITEM_H = 76, BUFFER_PX = 400;
let allHistory = [], rows = [], offs = [], filter = 'all', query = '';
const vp = $('#hvp'), spacer = $('#hspacer');
const hNodes = new Map();

const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
function dayLabel(ts) {
  const diff = Math.round((dayStart(Date.now()) - dayStart(ts)) / 864e5);
  const d = new Date(ts);
  const full = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  if (diff === 0) return ['Today', d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })];
  if (diff === 1) return ['Yesterday', d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })];
  return [full, ''];
}
const timeLabel = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function buildRows() {
  const q = query.trim().toLowerCase();
  const items = allHistory.filter((h) => (filter === 'all' || h.type === filter) && (!q || (h.title || '').toLowerCase().includes(q) || (h.author || '').toLowerCase().includes(q)));
  rows = []; let lastDay = null;
  for (const h of items) {
    const ds = dayStart(h.ts);
    if (ds !== lastDay) { lastDay = ds; rows.push({ t: 'h', key: 'h' + ds, ts: h.ts }); }
    rows.push({ t: 'i', key: 'i' + h.id, h });
  }
  offs = []; let y = 0;
  for (const r of rows) { offs.push(y); y += r.t === 'h' ? HEAD_H : ITEM_H; }
  spacer.style.height = y + 8 + 'px';

  const none = items.length === 0;
  $('#hempty').classList.toggle('show', none);
  vp.style.display = none ? 'none' : '';
  $('#hclear').hidden = !allHistory.length;
  $('#hcount').textContent = allHistory.length ? (items.length === allHistory.length ? `${items.length} download${items.length === 1 ? '' : 's'}` : `${items.length} of ${allHistory.length}`) : '';
  $('#hempty-t').textContent = allHistory.length ? 'No matches' : 'No downloads yet';
  $('#hempty-s').textContent = allHistory.length ? 'Try a different search or filter.' : 'Finished downloads show up here with their date and time.';
}

function makeRow(r) {
  const n = el('div', 'vrow');
  if (r.t === 'h') {
    n.className += ' dayhead';
    const [a, b] = dayLabel(r.ts);
    const strong = el('b', null, a); n.append(strong);
    if (b) n.append(' · ' + b);
    return n;
  }
  const h = r.h;
  n.className += ' hitem';
  n.title = 'Open on YouTube';
  const img = withFallback(el('img', 'thumb'), h.videoId);
  const info = el('div', 'info');
  const title = el('div', 'title', h.title || h.videoId);
  const meta = el('div', 'meta');
  const badge = el('span', 'badge', h.quality || (h.type === 'audio' ? 'Audio' : 'Video'));
  const tag = el('span', 'tag', (h.ext || '').toUpperCase() || (h.type === 'audio' ? 'AUDIO' : 'VIDEO'));
  meta.append(badge); if (tag.textContent !== badge.textContent) meta.append(tag); meta.append([h.type === 'audio' ? 'Audio' : 'Video', size(h.size)].filter(Boolean).join(' · '));
  const when = el('div', 'when', `${timeLabel(h.ts)} · ${new Date(h.ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`);
  info.append(title, meta, when);
  const acts = el('div', 'acts');
  const del = el('button', 'iconbtn', '✕'); del.title = 'Remove from history';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    const cur = (await chrome.storage.local.get('history')).history || [];
    await chrome.storage.local.set({ history: cur.filter((x) => x.id !== h.id) });
  });
  acts.append(del);
  n.append(img, info, acts);
  n.addEventListener('click', () => chrome.tabs.create({ url: 'https://www.youtube.com/watch?v=' + encodeURIComponent(h.videoId) }));
  return n;
}

function findStart(y) { // last row whose offset <= y
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offs[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}
function paintHistory(force) {
  if (force) { for (const n of hNodes.values()) n.remove(); hNodes.clear(); }
  if (!rows.length) { for (const n of hNodes.values()) n.remove(); hNodes.clear(); return; }
  const top = Math.max(0, vp.scrollTop - BUFFER_PX), bottom = vp.scrollTop + (vp.clientHeight || 400) + BUFFER_PX;
  const need = new Set();
  for (let i = findStart(top); i < rows.length && offs[i] < bottom; i++) {
    const r = rows[i]; need.add(r.key);
    let n = hNodes.get(r.key);
    if (!n) { n = makeRow(r); hNodes.set(r.key, n); spacer.append(n); }
    n.style.transform = `translateY(${offs[i]}px)`;
  }
  for (const [k, n] of hNodes) if (!need.has(k)) { n.remove(); hNodes.delete(k); }
}
let raf = 0;
vp.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintHistory(false); }); }, { passive: true });

async function loadHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  allHistory = history;
  buildRows(); paintHistory(true);
}
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local') return;
  if (c.history) loadHistory();
  if (c.dlJobs) renderJobs();
});
loadHistory();

let st = 0;
$('#hsearch').addEventListener('input', (e) => { clearTimeout(st); st = setTimeout(() => { query = e.target.value; vp.scrollTop = 0; buildRows(); paintHistory(true); }, 120); });
$('#hchips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
  vp.scrollTop = 0; buildRows(); paintHistory(true);
});
$('#hfolder').addEventListener('click', () => { try { chrome.downloads.showDefaultFolder(); } catch { /* ignore */ } });
let clearArmed = 0;
$('#hclear').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  if (!clearArmed) { clearArmed = setTimeout(() => { clearArmed = 0; b.textContent = 'Clear all'; }, 3000); b.textContent = 'Tap again to confirm'; return; }
  clearTimeout(clearArmed); clearArmed = 0; b.textContent = 'Clear all';
  await chrome.storage.local.set({ history: [] });
});

/* ----------------------------- SETTINGS ----------------------------- */
async function loadSettings() {
  const s = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  document.querySelector(`input[name=mode][value=${s.askEveryTime ? 'ask' : 'default'}]`).checked = true;
  $('#type').value = s.defaultType; $('#height').value = s.defaultHeight; $('#audio').value = s.defaultAudio;
  $('#container').value = ['mp4', 'webm', 'mkv'].includes(s.defaultContainer) ? s.defaultContainer : 'mp4';
  $('#autoupdate').value = s.autoUpdateCheck ? '1' : '0'; $('#basefolder').value = s.baseFolder; $('#parallel').value = String(s.maxParallel);
  $('#videoFields').style.display = s.defaultType === 'audio' ? 'none' : '';
}
function saveSettings() {
  const type = $('#type').value;
  $('#videoFields').style.display = type === 'audio' ? 'none' : '';
  chrome.storage.sync.set({
    askEveryTime: document.querySelector('input[name=mode]:checked').value === 'ask',
    defaultType: type, defaultHeight: $('#height').value, defaultAudio: $('#audio').value, defaultContainer: $('#container').value,
    autoUpdateCheck: $('#autoupdate').value === '1', baseFolder: $('#basefolder').value.trim(), maxParallel: Number($('#parallel').value),
  });
}
document.querySelectorAll('input[name=mode], #type, #height, #audio, #container, #parallel, #autoupdate, #basefolder').forEach((e) => e.addEventListener('change', saveSettings));
loadSettings();

/* ------------------------------ UPDATES ------------------------------ */
const ago = (ts) => { if (!ts) return 'never'; const m = Math.round((Date.now() - ts) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
function renderUpdate(info) {
  const cur = chrome.runtime.getManifest().version;
  $('#curver').textContent = cur;
  if (!info) { $('#upstatus').firstChild.textContent = 'Version '; return; }
  const show = info.available && info.skipped !== info.version;
  $('#upbanner').hidden = !show;
  if (show) {
    $('#uptitle').textContent = `Update available: v${info.version}`;
    $('#upsub').textContent = `You have v${cur}. See Settings for how to update.`;
    $('#upget').href = info.url || info.page;
  }
  $('#upstatus').innerHTML = '';
  $('#upstatus').append(info.error ? `Couldn't check: ${info.error}` : info.available ? `Update v${info.version} available` : `Up to date (v${cur}) · checked ${ago(info.checkedAt)}`);
}
async function loadUpdate() { renderUpdate((await chrome.storage.local.get('updateInfo')).updateInfo); }
$('#upcheck').addEventListener('click', async (e) => {
  const b = e.currentTarget; b.disabled = true; b.textContent = 'Checking…';
  try { renderUpdate(await chrome.runtime.sendMessage({ type: 'ytdl:check-update' })); } catch { /* ignore */ }
  b.disabled = false; b.textContent = 'Check now';
});
$('#upskip').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'ytdl:skip-update' }); loadUpdate(); });
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.updateInfo) renderUpdate(c.updateInfo.newValue); });
loadUpdate();
