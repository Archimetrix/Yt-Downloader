/*
 * YT DOWNLOADER - player UI
 * Copyright 2026 Archimetrix
 * Licensed under the Apache License, Version 2.0
 */
(() => {
  if (window.__ytdlUi) return;
  window.__ytdlUi = true;

  const DEFAULTS = { askEveryTime: true, defaultType: 'video', defaultHeight: 'best', defaultAudio: 'm4a', defaultContainer: 'mp4', maxParallel: 2 };
  let settings = { ...DEFAULTS };
  const jobs = new Map(); // jobId -> { videoId, title, mode, label, sig }
  let releaseLock = null;
  let toastTimer = null;

  try {
    chrome.storage.sync.get(DEFAULTS).then((s) => { settings = { ...DEFAULTS, ...s }; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
    });
  } catch { /* extension reloaded */ }

  const ICON = '<svg viewBox="0 0 36 36" width="100%" height="100%" aria-hidden="true"><path fill="#fff" d="M18 7a1.6 1.6 0 0 1 1.6 1.6v10.1l3.3-3.3a1.6 1.6 0 1 1 2.3 2.3l-6.1 6.1a1.6 1.6 0 0 1-2.2 0l-6.1-6.1a1.6 1.6 0 1 1 2.3-2.3l3.3 3.3V8.6A1.6 1.6 0 0 1 18 7zM10 26.2h16a1.6 1.6 0 0 1 0 3.2H10a1.6 1.6 0 0 1 0-3.2z"/></svg>';
  const HEART = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="#ff4d6d" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 2.9 5 6.2 5c2 0 3.2 1 3.8 2 .6-1 1.8-2 3.8-2 3.3 0 5.3 3.3 3.8 6.8C19.5 16.4 12 21 12 21z"/></svg>';

  const $ = (s, r = document) => r.querySelector(s);
  const player = () => document.getElementById('movie_player');
  const videoId = () => new URLSearchParams(location.search).get('v');
  const send = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const fmtSize = (n) => !n ? '' : n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? Math.round(n / 1e6) + ' MB' : Math.round(n / 1e3) + ' KB';

  /* ------------------------------- toast ------------------------------- */
  function toast({ text, ratio, cancel, sticky, tone }) {
    const p = player(); if (!p) return;
    let t = $('.ytdl-toast', p);
    if (!t) {
      t = document.createElement('div');
      t.className = 'ytdl-toast';
      t.innerHTML = '<div class="ytdl-toast-row"><span class="ytdl-toast-text"></span><button class="ytdl-toast-x" title="Cancel download">✕</button></div><div class="ytdl-bar"><i></i></div>';
      for (const ev of ['click', 'mousedown', 'dblclick']) t.addEventListener(ev, (e) => e.stopPropagation());
      $('.ytdl-toast-x', t).addEventListener('click', () => { for (const [id, j] of jobs) if (j.videoId === videoId()) send('ytdl:cancel', { jobId: id }); hideToast(); });
      p.appendChild(t);
    }
    t.dataset.tone = tone || '';
    $('.ytdl-toast-text', t).textContent = text;
    $('.ytdl-toast-x', t).style.display = cancel ? '' : 'none';
    const bar = $('.ytdl-bar', t);
    bar.style.display = ratio === undefined ? 'none' : '';
    bar.classList.toggle('ytdl-indeterminate', ratio === null);
    if (typeof ratio === 'number') $('i', bar).style.width = Math.round(ratio * 100) + '%';
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(hideToast, 6000);
  }
  function hideToast() { $('.ytdl-toast', player() || document)?.remove(); }
  function setBusy(on) { $('.ytdl-btn')?.classList.toggle('ytdl-busy', on); }

  /* ------------------------------ probing ------------------------------ */
  function probe(id) {
    return new Promise((resolve, reject) => {
      const reqId = uid();
      const timer = setTimeout(() => { document.removeEventListener('ytdl:probe-result', on); reject(new Error('The player didn’t respond. Reload the page.')); }, 5000);
      function on(e) {
        const d = JSON.parse(e.detail);
        if (d.reqId !== reqId) return;
        clearTimeout(timer); document.removeEventListener('ytdl:probe-result', on);
        d.ok ? resolve(d.data) : reject(new Error(d.error));
      }
      document.addEventListener('ytdl:probe-result', on);
      send('ytdl:probe', { reqId, videoId: id });
    });
  }

  /* ------------------------------- jobs ------------------------------- */
  // Downloads run inside this page. Several can run at once (limit in Settings);
  // clicking Download on another video never cancels a running one.
  let jobsWrite = Promise.resolve();
  function saveJobs(list) {
    jobsWrite = jobsWrite.then(async () => {
      try {
        const { dlJobs = [] } = await chrome.storage.local.get('dlJobs');
        const mine = new Set(list.map((j) => j.id));
        const rest = dlJobs.filter((j) => !mine.has(j.id));
        await chrome.storage.local.set({ dlJobs: [...list, ...rest].slice(0, 30) });
      } catch { /* extension reloaded */ }
    });
    return jobsWrite;
  }
  function dropJob(id) {
    jobsWrite = jobsWrite.then(async () => {
      try {
        const { dlJobs = [] } = await chrome.storage.local.get('dlJobs');
        await chrome.storage.local.set({ dlJobs: dlJobs.filter((j) => j.id !== id) });
      } catch { /* extension reloaded */ }
    });
    return jobsWrite;
  }
  const lastRow = new Map();
  const row_ = (id, patch) => { const j = jobs.get(id) || lastRow.get(id) || {}; const r = { id, videoId: j.videoId, title: j.title, mode: j.mode, label: j.label, ts: Date.now(), ...patch }; lastRow.set(id, r); return r; };

  function lockPage(on) {
    // While downloads run, hold a Web Lock so Chrome doesn't freeze this tab in the background.
    if (on && !releaseLock && navigator.locks) navigator.locks.request('ytdl-active', () => new Promise((res) => { releaseLock = res; })).catch(() => {});
    if (!on && releaseLock) { releaseLock(); releaseLock = null; }
  }
  const sigOf = (v, r) => [v, r.mode, r.mode === 'audio' ? (r.audioKind || r.audioItag || '') : (r.container || '') + (r.videoItag || r.height || 'best')].join('|');

  async function start(req) {
    const id = videoId();
    if (!id) return toast({ text: 'Open a video to download it.', tone: 'error' });
    const sig = sigOf(id, req);
    if ([...jobs.values()].some((j) => j.sig === sig)) return toast({ text: 'This one is already downloading.' });
    if (jobs.size >= (Number(settings.maxParallel) || 2)) {
      return toast({ text: `${jobs.size} download${jobs.size > 1 ? 's are' : ' is'} already running. Wait for one to finish, or raise the limit in the extension’s Settings.`, tone: 'error' });
    }
    const jobId = uid();
    let title = id;
    try { title = (await probe(id)).title || id; } catch { /* keep id */ }
    jobs.set(jobId, { videoId: id, title, mode: req.mode, label: req.label || '', sig });
    lockPage(true);
    saveJobs([row_(jobId, { status: 'running', phase: 'prepare', message: 'Preparing…', ratio: null })]);
    toast({ text: 'Preparing…', ratio: null, cancel: true, sticky: true });
    refreshBusy();
    send('ytdl:start', { jobId, videoId: id, ...req });
  }

  document.addEventListener('ytdl:progress', async (e) => {
    const d = JSON.parse(e.detail);
    const j = jobs.get(d.jobId);
    if (!j) return;
    const here = j.videoId === videoId();
    const label = jobs.size > 1 ? `[${j.title.slice(0, 24)}] ` : '';
    if (d.phase === 'prepare') { saveJobs([row_(d.jobId, { status: 'running', phase: 'prepare', message: d.message, ratio: null })]); if (here) toast({ text: d.message, ratio: null, cancel: true, sticky: true }); }
    else if (d.phase === 'download') { saveJobs([row_(d.jobId, { status: 'running', phase: 'download', message: d.message, ratio: d.ratio })]); if (here) toast({ text: `${label}${d.message} ${d.ratio != null ? Math.round(d.ratio * 100) + '%' : ''}`.trim(), ratio: d.ratio, cancel: true, sticky: true }); }
    else if (d.phase === 'mux') { saveJobs([row_(d.jobId, { status: 'running', phase: 'mux', message: d.message, ratio: null })]); if (here) toast({ text: d.message, ratio: null, sticky: true }); }
    else {
      jobs.delete(d.jobId);
      if (!jobs.size) lockPage(false);
      refreshBusy();
      if (d.phase === 'done') {
        // Finished: it leaves the queue and lands in History.
        addHistory(d.result);
        dropJob(d.jobId); lastRow.delete(d.jobId);
        toast({ text: `Saved: ${d.result.filename}`, tone: 'ok' });
      } else if (d.phase === 'cancelled') { dropJob(d.jobId); lastRow.delete(d.jobId); toast({ text: 'Download cancelled.' }); }
      else { saveJobs([row_(d.jobId, { status: 'error', message: d.message || 'Download failed.' })]); toast({ text: d.message || 'Download failed.', tone: 'error' }); }
    }
  });

  let histWrite = Promise.resolve();
  function addHistory(r) {
    histWrite = histWrite.then(async () => {
      try {
        const { history = [] } = await chrome.storage.local.get('history');
        history.unshift({ id: uid(), videoId: r.videoId, title: r.title, author: r.author, type: r.type, quality: r.quality, ext: r.ext, size: r.size, filename: r.filename, ts: Date.now() });
        await chrome.storage.local.set({ history: history.slice(0, 5000) });
      } catch { /* ignore */ }
    });
  }

  // Cancel requests from the extension popup.
  try {
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'local' || !c.dlCancel?.newValue) return;
      const ids = c.dlCancel.newValue.ids || [];
      for (const id of ids) if (jobs.has(id)) send('ytdl:cancel', { jobId: id });
    });
  } catch { /* ignore */ }

  // Keep the popup honest: jobs from this page are marked interrupted if the page goes away.
  setInterval(() => { for (const [id] of jobs) { const r = lastRow.get(id); if (r) saveJobs([{ ...r, ts: Date.now() }]); } }, 5000);
  window.addEventListener('beforeunload', (e) => { if (jobs.size) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('pagehide', () => { for (const [id] of jobs) saveJobs([row_(id, { status: 'error', message: 'Interrupted: the YouTube tab was closed or reloaded.' })]); });

  function refreshBusy() {
    const b = $('.ytdl-btn'); if (!b) return;
    b.classList.toggle('ytdl-busy', jobs.size > 0);
    b.dataset.count = jobs.size ? String(jobs.size) : '';
    b.title = jobs.size ? `Download (${jobs.size} running)` : 'Download';
  }

  /* -------------------------------- menu -------------------------------- */
  function closeMenu() { $('.ytdl-menu')?.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc, true); }
  const outside = (e) => { if (!e.target.closest?.('.ytdl-menu, .ytdl-btn')) closeMenu(); };
  const esc = (e) => { if (e.key === 'Escape') closeMenu(); };

  async function openMenu() {
    const p = player(); if (!p) return;
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'ytdl-menu';
    menu.innerHTML = '<div class="ytdl-menu-head">Download</div><div class="ytdl-menu-body"><div class="ytdl-muted">Loading formats…</div></div>';
    for (const ev of ['click', 'mousedown', 'dblclick', 'contextmenu']) menu.addEventListener(ev, (e) => e.stopPropagation());
    p.appendChild(menu);
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', esc, true);

    const body = $('.ytdl-menu-body', menu);
    let info;
    try { info = await probe(videoId()); }
    catch (err) { body.innerHTML = ''; body.append(note(err.message, true)); menu.append(footer()); return; }

    body.innerHTML = '';
    let fmt = ['mp4', 'webm', 'mkv'].includes(settings.defaultContainer) ? settings.defaultContainer : 'mp4';
    const seg = document.createElement('div'); seg.className = 'ytdl-seg';
    const FMTS = [['mp4', 'MP4'], ['webm', 'WebM'], ['mkv', 'MKV']];
    const videoBox = document.createElement('div');
    const renderVideo = () => {
      videoBox.textContent = '';
      for (const b of seg.children) b.classList.toggle('on', b.dataset.f === fmt);
      const list = (info.qualitiesBy && info.qualitiesBy[fmt]) || info.qualities;
      for (const q of list) {
        videoBox.append(row(q.label, `${q.container.toUpperCase()} · ${q.codec === 'h264' ? 'H.264' : q.codec.toUpperCase()}`, fmtSize(q.size), () => {
          closeMenu(); start({ mode: 'video', container: fmt, videoItag: q.itag, height: q.height, label: q.label });
        }));
      }
      if (fmt !== 'mkv' && info.qualitiesBy && list.length < (info.qualitiesBy.mkv || []).length) {
        videoBox.append(note('Higher resolutions are only offered as ' + (fmt === 'mp4' ? 'WebM or MKV.' : 'MP4 or MKV.'), false));
      }
    };
    for (const [f, label] of FMTS) {
      const b = document.createElement('button'); b.className = 'ytdl-seg-btn'; b.dataset.f = f; b.textContent = label;
      b.addEventListener('click', () => { fmt = f; try { chrome.storage.sync.set({ defaultContainer: f }); } catch { /* ignore */ } renderVideo(); });
      seg.append(b);
    }
    body.append(section('Video format'), seg, videoBox);
    renderVideo();
    if (info.audio.length) {
      body.append(section('Audio only'));
      for (const a of info.audio) {
        body.append(row(a.label, a.bitrate ? Math.round(a.bitrate / 1000) + ' kbps' : '', fmtSize(a.size), () => {
          closeMenu(); start({ mode: 'audio', audioItag: a.itag, audioKind: a.kind, label: a.label });
        }));
      }
    }
    menu.append(footer());
  }

  const section = (t) => Object.assign(document.createElement('div'), { className: 'ytdl-sec', textContent: t });
  function note(t, bad) { const d = document.createElement('div'); d.className = 'ytdl-muted' + (bad ? ' ytdl-bad' : ''); d.textContent = t; return d; }
  function row(title, sub, size, onClick) {
    const b = document.createElement('button');
    b.className = 'ytdl-row';
    b.innerHTML = '<span class="ytdl-row-main"></span><span class="ytdl-row-sub"></span><span class="ytdl-row-size"></span>';
    $('.ytdl-row-main', b).textContent = title;
    $('.ytdl-row-sub', b).textContent = sub;
    $('.ytdl-row-size', b).textContent = size;
    b.addEventListener('click', onClick);
    return b;
  }
  function footer() {
    const f = document.createElement('div');
    f.className = 'ytdl-foot';
    f.innerHTML = HEART + '<span>Made with love by Archimetrix</span><a href="https://buymeacoffee.com/archimetrix" target="_blank" rel="noopener">☕ Coffee</a><a href="https://buymeatea.online/archimetrix" target="_blank" rel="noopener">UPI</a>';
    return f;
  }

  /* ------------------------------ the button ------------------------------ */
  function onButton(e) {
    e.stopPropagation(); e.preventDefault();
    if ($('.ytdl-menu')) return closeMenu();
    if (settings.askEveryTime) return openMenu();
    // Defaults are set: skip the menu and start immediately.
    const h = settings.defaultHeight === 'best' ? null : Number(settings.defaultHeight);
    if (settings.defaultType === 'audio') start({ mode: 'audio', audioKind: settings.defaultAudio });
    else start({ mode: 'video', container: settings.defaultContainer, height: h, audioKind: settings.defaultAudio });
  }

  function inject() {
    const host = $('#movie_player .ytp-right-controls-left') || $('#movie_player .ytp-right-controls');
    if (!host || $('.ytdl-btn', host.closest('#movie_player'))) return;
    const b = document.createElement('button');
    b.className = 'ytp-button ytdl-btn';
    b.title = 'Download';
    b.setAttribute('aria-label', 'Download video or audio');
    b.innerHTML = ICON;
    b.addEventListener('click', onButton);
    host.insertBefore(b, host.firstChild);
    refreshBusy();
  }

  let scheduled = false;
  const schedule = () => { if (scheduled) return; scheduled = true; setTimeout(() => { scheduled = false; inject(); }, 400); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', () => { closeMenu(); schedule(); });
  schedule();
})();
