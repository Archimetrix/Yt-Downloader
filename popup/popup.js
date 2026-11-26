// YT DOWNLOADER - popup. Apache-2.0.
const DEFAULTS = { askEveryTime: true, defaultType: 'video', defaultHeight: 'best', defaultAudio: 'opus', defaultContainer: 'mp4', autoUpdateCheck: true, maxParallel: 2, coverArt: 'auto', plBanner: true };
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

const STALE_MS = 20000; // a running job that stops reporting means its tab is gone
/* ----------------------------- PLAYLIST ----------------------------- *
 * The page script (content.js) owns the run and writes it to storage ("plQueue");
 * this tab only shows it and sends commands back ("plCmd"). */
const PL_STATUS = { queued: 'Waiting', loading: 'Loading…', ready: 'Loaded, waiting', running: 'Downloading', done: 'Saved', error: 'Failed', skipped: 'Skipped', cancelled: 'Cancelled' };
// Finished playlist: show a summary card (thumbnail, name, counts, link) instead of every video.
function playlistUrl(q, items) {
  const id = q.listId, first = items[0] && items[0].videoId;
  if (!id) return '';
  return /^RD/.test(id) && first ? `https://www.youtube.com/watch?v=${first}&list=${id}` : `https://www.youtube.com/playlist?list=${id}`;
}
function showPlaylistDone(q, items, c) {
  const url = playlistUrl(q, items), first = items[0] && items[0].videoId;
  for (const id of ['#pdthumb', '#pdtitle']) { const a = $(id); if (url) { a.href = url; a.title = 'Open playlist on YouTube'; } else { a.removeAttribute('href'); a.removeAttribute('title'); } }
  $('#pdtitle').textContent = q.title || 'Playlist';
  const thumb = $('#pdthumb'); thumb.textContent = '';
  if (first) thumb.append(withFallback(el('img'), first));
  const meta = $('#pdmeta'); meta.textContent = '';
  const part = (text, cls) => { if (meta.childNodes.length) meta.append(' · '); const s = el('span', cls, text); meta.append(s); };
  part(`${items.length} video${items.length === 1 ? '' : 's'}`);
  part(`${c.done} downloaded`, c.done ? 'ok' : '');
  if (c.error) part(`${c.error} failed`, 'bad');
  if (c.skipped) part(`${c.skipped} skipped`);
  if (c.cancelled) part(`${c.cancelled} cancelled`);
  $('#pdfolder').textContent = q.folder ? `Folder: ${q.folder}` : '';
}
async function renderPlaylist() {
  const { plQueue } = await chrome.storage.local.get('plQueue');
  const q = plQueue;
  const stale = !!q && q.state === 'running' && Date.now() - (q.ts || 0) > STALE_MS * 2;
  $('#pempty').classList.toggle('show', !q);
  const finished = !!q && q.state === 'done' && !stale;
  $('#pbox').hidden = !q || finished;
  $('#pdone').hidden = !finished;
  const live = !!q && q.state === 'running' && !stale;
  $('#pbadge').hidden = !live;
  if (!q) { $('#psummary').textContent = ''; $('#pdone').hidden = true; for (const id of ['#presume', '#pskip', '#pretry', '#pcancel', '#pclear', '#pnote']) $(id).hidden = true; $('#plist').textContent = ''; return; }

  const items = q.items || [];
  const c = { queued: 0, ready: 0, done: 0, error: 0, skipped: 0, cancelled: 0, loading: 0, running: 0 };
  for (const it of items) c[it.status] = (c[it.status] || 0) + 1;
  const fin = c.done + c.error + c.skipped + c.cancelled;
  const cur = q.cur >= 0 ? q.cur + 1 : Math.min(fin + 1, items.length);
  $('#pbadge').textContent = String(Math.max(0, items.length - fin));
  $('#ptitle').textContent = q.title || 'Playlist';
  $('#psub').textContent = q.folder ? `Folder: ${q.folder}` : '';
  const curIt = items[q.cur];
  const curPart = curIt && typeof curIt.ratio === 'number' ? curIt.ratio : 0;
  $('#pbar i').style.width = items.length ? Math.round(((c.done + c.error + c.skipped + c.cancelled + (live ? curPart : 0)) / items.length) * 100) + '%' : '0%';
  const parts = [];
  if (c.done) parts.push(`${c.done} saved`); if (c.error) parts.push(`${c.error} failed`); if (c.skipped) parts.push(`${c.skipped} skipped`);
  const state = stale ? 'Interrupted' : { running: q.phase === 'loading' ? `Loading ${Math.min(c.done + c.error + c.skipped + c.cancelled + c.ready + c.running + c.loading, items.length)} of ${items.length}` : `Video ${cur} of ${items.length}`, paused: 'Paused', done: 'Finished', cancelled: 'Cancelled' }[q.state] || q.state;
  $('#psummary').textContent = finished ? 'Finished' : [state, ...parts].join(' · ');
  const note = stale ? 'Interrupted: the YouTube tab was closed or reloaded. Clear this playlist and start it again.' : q.state === 'paused' ? (q.reason || 'Paused.') : q.state === 'running' ? (q.phase === 'loading' ? 'Step 1 of 2: the YouTube tab is loading your videos one by one. Leave that tab alone until this finishes.' : 'Step 2 of 2: downloading in the background. You can use YouTube normally, but don’t close or reload that tab or the browser until everything is saved. Please wait patiently; it depends on your network speed and video processing.') : '';
  $('#pnote').hidden = !note; $('#pnote').textContent = note;
  $('#presume').hidden = stale || q.state !== 'paused';
  $('#pskip').hidden = !live;
  $('#pretry').hidden = stale || !(c.error || c.skipped || c.cancelled);
  $('#pcancel').hidden = !(live || q.state === 'paused') || stale;
  $('#pclear').hidden = live;

  const row = (it, i) => {
    const li = el('li', 'pitem ' + it.status + (i === q.cur ? ' cur' : ''));
    let st = PL_STATUS[it.status] || it.status;
    if (it.status === 'running' && typeof it.ratio === 'number') st = `${Math.round(it.ratio * 100)}%`;
    if (it.status === 'error' && it.message) st = it.message;
    li.append(el('span', 'pn', String(i + 1)), el('span', 'pt', it.title || it.videoId), el('span', 'ps', st));
    li.title = it.status === 'error' && it.message ? `${it.title}\n${it.message}` : it.title || '';
    return li;
  };
  const list = $('#plist'); list.textContent = '';
  if (finished) {
    // only what needs attention stays listed; the rest is summarised in the card
    showPlaylistDone(q, items, c);
    items.forEach((it, i) => { if (it.status === 'error') list.append(row(it, i)); });
    return;
  }
  // show a window around the current video so a 1000-video playlist stays light
  const start = Math.max(0, (q.cur >= 0 ? q.cur : fin) - 4), end = Math.min(items.length, start + 60);
  if (start > 0) list.append(el('li', 'pmore', `${start} earlier video${start > 1 ? 's' : ''}`));
  for (let i = start; i < end; i++) list.append(row(items[i], i));
  if (end < items.length) list.append(el('li', 'pmore', `${items.length - end} more in the queue`));
}
const plCmd = async (cmd) => { const { plQueue } = await chrome.storage.local.get('plQueue'); if (plQueue) await chrome.storage.local.set({ plCmd: { id: plQueue.id, cmd, n: Date.now() } }); };
$('#presume').addEventListener('click', () => plCmd('resume'));
$('#pskip').addEventListener('click', () => plCmd('skip'));
$('#pretry').addEventListener('click', () => plCmd('retry'));
$('#pcancel').addEventListener('click', () => plCmd('cancel'));
$('#pclear').addEventListener('click', async () => { await plCmd('clear'); await chrome.storage.local.remove('plQueue'); renderPlaylist(); });
setInterval(renderPlaylist, 5000);
renderPlaylist();

/* ------------------------------ QUEUE ------------------------------ */
// Only downloads that are running (or failed and need attention) live here.
// Finished downloads are moved to History by the page script.
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
    const kind = (j.mode === 'audio' ? 'Audio' : 'Video') + (j.label ? ' · ' + j.label : '') + (j.plPos ? ' · Playlist ' + j.plPos : '');
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
  if (c.plQueue) renderPlaylist();
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
const radio = (name) => document.querySelector(`input[name=${name}]:checked`);
function paintSettings() {
  const ask = radio('mode').value === 'ask';
  $('#defrow').hidden = ask;
  $('#modehint').textContent = ask ? 'A menu lets you pick format and quality for each download.' : 'Downloads start at once with the choices below. No questions asked.';
}
async function loadSettings() {
  const s = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  const f = await chrome.storage.sync.get(['baseFolder', 'videoFolder', 'audioFolder']);
  // older versions had a single folder: keep using it for both until the user changes it
  const oldFolder = f.baseFolder || '';
  $('#videofolder').value = f.videoFolder ?? oldFolder;
  $('#audiofolder').value = f.audioFolder ?? oldFolder;
  document.querySelector(`input[name=mode][value=${s.askEveryTime ? 'ask' : 'default'}]`).checked = true;
  document.querySelector(`input[name=type][value=${s.defaultType === 'audio' ? 'audio' : 'video'}]`).checked = true;
  $('#height').value = s.defaultHeight; $('#audio').value = s.defaultAudio;
  $('#container').value = ['mp4', 'webm', 'mkv'].includes(s.defaultContainer) ? s.defaultContainer : 'mp4';
  $('#cover').value = ['auto', 'square', 'original', 'off'].includes(s.coverArt) ? s.coverArt : 'auto';
  $('#autoupdate').value = s.autoUpdateCheck ? '1' : '0'; $('#parallel').value = String(s.maxParallel); $('#plbanner').value = s.plBanner === false ? '0' : '1';
  paintSettings();
}
function saveSettings() {
  paintSettings();
  chrome.storage.sync.set({
    askEveryTime: radio('mode').value === 'ask',
    defaultType: radio('type').value, defaultHeight: $('#height').value, defaultAudio: $('#audio').value, defaultContainer: $('#container').value,
    autoUpdateCheck: $('#autoupdate').value === '1', videoFolder: $('#videofolder').value.trim(), audioFolder: $('#audiofolder').value.trim(),
    maxParallel: Number($('#parallel').value), coverArt: $('#cover').value, plBanner: $('#plbanner').value === '1',
  });
}
document.querySelectorAll('input[name=mode], input[name=type], #height, #audio, #container, #parallel, #plbanner, #cover, #autoupdate, #videofolder, #audiofolder').forEach((e) => e.addEventListener('change', saveSettings));
loadSettings();

/* ------------------------------ UPDATES ------------------------------ */
const ago = (ts) => { if (!ts) return 'never'; const m = Math.round((Date.now() - ts) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
const IS_STORE = !!chrome.runtime.getManifest().update_url; // store builds update themselves
const CAN_PICK = typeof window.showDirectoryPicker === 'function';
let smooth = { hasFolder: false, permission: 'none', enabled: true, store: IS_STORE };
let applying = false;
const openUpdater = (auto) => { chrome.tabs.create({ url: chrome.runtime.getURL('updater.html' + (auto ? '?auto=1' : '')) }); window.close(); };
const oneClickReady = (info) => !!(info && info.zipUrl && !IS_STORE && CAN_PICK && smooth.enabled !== false);

function renderUpdate(info) {
  const cur = chrome.runtime.getManifest().version;
  $('#curver').textContent = cur;
  if (!info) return;
  const show = info.available && info.skipped !== info.version;
  $('#upbanner').hidden = !show;
  if (show) {
    const one = oneClickReady(info);
    $('#uptitle').textContent = `Update available: v${info.version}`;
    if (!applying) {
      $('#upsub').className = '';
      $('#upsub').textContent = one
        ? (smooth.hasFolder && smooth.permission === 'granted' ? `You have v${cur}. One click installs it.` : `You have v${cur}. One-time setup, then one click.`)
        : (IS_STORE ? `You have v${cur}. The store installs it automatically.` : `You have v${cur}. Download the ZIP to update.`);
    }
    $('#upget').href = info.url || info.page;
    $('#upnow').hidden = !one;
    $('#upget').className = one ? 'uplink' : 'upbtn uplink primary';
    $('#upget').textContent = one ? 'Manual' : 'Download';
  }
}
function showProgress(p) {
  if (!p) return;
  const bar = $('#upbar'); bar.hidden = false; bar.classList.toggle('err', p.phase === 'error');
  bar.firstElementChild.style.width = (p.phase === 'error' ? 100 : p.pct) + '%';
  $('#upsub').className = p.phase === 'error' ? 'err' : '';
  $('#upsub').textContent = p.phase === 'done' ? 'Updated. Refresh your YouTube tabs after it reloads.' : p.text;
}
async function refreshSmooth() {
  try { smooth = (await chrome.runtime.sendMessage({ type: 'ytdl:smooth-status' })) || smooth; } catch { /* worker asleep: keep defaults */ }
  const st = $('#smoothstatus'), btn = $('#smoothsetup');
  let txt, label = 'Set up';
  if (IS_STORE || smooth.store) { txt = 'Updates install automatically from the store'; label = null; }
  else if (smooth.unsupported) { txt = 'One-click updates: not available in this build'; label = null; }
  else if (!CAN_PICK) { txt = 'One-click updates need folder access, which this browser has off'; label = 'Details'; }
  else if (smooth.enabled === false) { txt = 'One-click updates: off'; label = 'Turn on'; }
  else if (!smooth.hasFolder) { txt = 'One-click updates: not set up'; label = 'Set up'; }
  else if (smooth.permission !== 'granted') { txt = `One-click updates: re-allow access to “${smooth.folderName}”`; label = 'Allow'; }
  else { txt = `One-click updates ready · ${smooth.folderName}`; label = 'Manage'; }
  st.textContent = txt; btn.hidden = !label; if (label) btn.textContent = label;
  loadUpdate();
}
async function loadUpdate() { renderUpdate((await chrome.storage.local.get('updateInfo')).updateInfo); }
$('#upcheck').addEventListener('click', async (e) => {
  const b = e.currentTarget; b.disabled = true; b.textContent = 'Checking…';
  try { const i = await chrome.runtime.sendMessage({ type: 'ytdl:check-update' }); renderUpdate(i); if (i && !i.error && !i.available) { b.textContent = 'Up to date ✓'; await new Promise((r) => setTimeout(r, 1800)); } } catch { /* ignore */ }
  b.disabled = false; b.textContent = 'Check now';
});
$('#smoothsetup').addEventListener('click', () => openUpdater(false));
$('#upnow').addEventListener('click', async () => {
  const info = (await chrome.storage.local.get('updateInfo')).updateInfo;
  if (!oneClickReady(info)) { window.open(info && (info.url || info.page), '_blank'); return; }
  if (!smooth.hasFolder || smooth.permission !== 'granted') return openUpdater(true); // folder pick / re-allow needs a user gesture on a full page
  applying = true; $('#upnow').disabled = true; showProgress({ phase: 'check', pct: 0, text: 'Starting…' });
  let r = null;
  try { r = await chrome.runtime.sendMessage({ type: 'ytdl:smooth-apply' }); } catch { /* the extension is reloading */ }
  if (r && r.ok) return; // the extension reloads itself; this popup closes with it
  applying = false; $('#upnow').disabled = false;
  if (r) {
    showProgress({ phase: 'error', pct: 0, text: r.message || 'Update failed.' });
    if (['NO_FOLDER', 'NEEDS_PERMISSION', 'WRONG_FOLDER'].includes(r.code)) setTimeout(() => openUpdater(true), 1200);
  }
});
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.smoothProgress && applying) showProgress(c.smoothProgress.newValue); });
$('#upskip').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'ytdl:skip-update' }); loadUpdate(); });
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.updateInfo) renderUpdate(c.updateInfo.newValue); });
refreshSmooth();

{ const av = document.querySelector('.avatar'); const hide = () => { av.style.display = 'none'; }; av.addEventListener('error', hide, { once: true }); if (av.complete && av.naturalWidth === 0) hide(); }
