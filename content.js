/*
 * YT DOWNLOADER - player UI
 * Copyright 2026 Archimetrix
 * Licensed under the Apache License, Version 2.0
 */
(() => {
  if (window.__ytdlUi) return;
  window.__ytdlUi = true;

  const DEFAULTS = { askEveryTime: true, defaultType: 'video', defaultHeight: 'best', defaultAudio: 'opus', defaultContainer: 'mp4', maxParallel: 2, coverArt: 'auto' };
  let settings = { ...DEFAULTS };
  const AUDIO_MARK = 'ytdl-audio--'; // background.js strips this and saves the file to the audio folder
  const unmark = (s) => String(s || '').replace(/^[~_]?ytdl-audio(?:~|--)/, '');
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
  const host = () => player();
  const videoId = () => new URLSearchParams(location.search).get('v');
  const send = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const fmtSize = (n) => !n ? '' : n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? Math.round(n / 1e6) + ' MB' : Math.round(n / 1e3) + ' KB';

  /* ------------------------------- toast ------------------------------- */
  function toast({ text, ratio, cancel, sticky, tone }) {
    const p = host(); if (!p) return;
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
  function hideToast() { $('.ytdl-toast', host() || document)?.remove(); }
  function setBusy(on) { document.querySelectorAll('.ytdl-btn').forEach((b) => b.classList.toggle('ytdl-busy', on)); }

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


  /* ------------------------------ star gate ------------------------------
   * 2 free downloads, then a friendly one-time GitHub star check.
   * Once verified the flag is stored forever and nothing is ever re-checked.
   */
  const FREE_LIMIT = 2;
  const REPO_URL = 'https://github.com/Archimetrix/Yt-Downloader';
  const gate = { unlocked: false, used: 0, ready: null };
  let starting = 0; // downloads that passed the gate but haven't registered as jobs yet

  gate.ready = (async () => {
    try {
      const [l, s] = await Promise.all([chrome.storage.local.get({ gate: null, freeUsed: 0 }), chrome.storage.sync.get({ gateVerified: false })]);
      gate.unlocked = !!(l.gate && l.gate.verified) || !!s.gateVerified;
      gate.used = Number(l.freeUsed) || 0;
    } catch { /* extension reloaded */ }
  })();
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local') {
        if (ch.gate && ch.gate.newValue && ch.gate.newValue.verified) gate.unlocked = true;
        if (ch.freeUsed) gate.used = Number(ch.freeUsed.newValue) || 0;
      }
      if (area === 'sync' && ch.gateVerified && ch.gateVerified.newValue) gate.unlocked = true;
    });
  } catch { /* extension reloaded */ }

  async function bumpFree() {
    try {
      const { freeUsed = 0 } = await chrome.storage.local.get('freeUsed');
      gate.used = (Number(freeUsed) || 0) + 1;
      await chrome.storage.local.set({ freeUsed: gate.used });
    } catch { gate.used += 1; }
  }

  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  async function ask(msg) {
    try { return (await chrome.runtime.sendMessage(msg)) || { state: 'error', message: 'No answer from the extension.' }; }
    catch { return { state: 'error', error: 'The extension was updated or reloaded. Please refresh this page.', message: 'The extension was updated or reloaded. Please refresh this page.' }; }
  }

  let gateEl = null, gateStop = null;
  const gateEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeGate(); } };
  function closeGate() {
    if (gateStop) { gateStop(); gateStop = null; }
    if (gateEl) { gateEl.remove(); gateEl = null; }
    document.removeEventListener('keydown', gateEsc, true);
  }

  function openGate(req) {
    const p = host(); if (!p) return;
    closeMenu(); closeGate();
    const pendingVideo = videoId();
    const wrap = mk('div', 'ytdl-gate');
    const card = mk('div', 'ytdl-gate-card');
    wrap.append(card);
    for (const ev of ['click', 'mousedown', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'wheel']) wrap.addEventListener(ev, (e) => e.stopPropagation());
    p.appendChild(wrap); gateEl = wrap;
    document.addEventListener('keydown', gateEsc, true);

    let alive = true, timer = 0, tick = null;
    const stopPoll = () => { clearTimeout(timer); tick = null; document.removeEventListener('visibilitychange', onVis); };
    gateStop = () => { alive = false; stopPoll(); };

    const show = (...nodes) => {
      card.textContent = '';
      const x = mk('button', 'ytdl-gate-x', '✕'); x.title = 'Maybe later'; x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', closeGate);
      card.append(x, ...nodes);
    };
    const link = (text, cls) => { const a = mk('a', 'ytdl-gate-btn ' + cls, text); a.href = REPO_URL; a.target = '_blank'; a.rel = 'noopener'; return a; };
    const btn = (text, cls, fn) => { const b = mk('button', 'ytdl-gate-btn ' + cls, text); b.addEventListener('click', () => fn(b)); return b; };

    /* ---- screen 1: the ask ---- */
    const intro = (msg) => {
      stopPoll();
      const steps = mk('ol', 'ytdl-gate-steps');
      const s1 = mk('li'); s1.append(mk('b', null, 'Star the project on GitHub'), mk('span', null, ' (free, one click)'));
      const s2 = mk('li'); s2.append(mk('b', null, 'Verify with GitHub'), mk('span', null, ' (about 20 seconds, only once)'));
      steps.append(s1, s2);
      const row = mk('div', 'ytdl-gate-row');
      row.append(link('⭐  Star on GitHub', 'ghost'), btn('Verify with GitHub', 'primary', begin));
      const later = btn('Maybe later', 'text', closeGate);
      show(
        mk('div', 'ytdl-gate-emoji', '💛'),
        mk('h2', 'ytdl-gate-title', 'Enjoying YT DOWNLOADER?'),
        mk('p', 'ytdl-gate-p', `You’ve used your ${FREE_LIMIT} free downloads. This project is 100% free to use, forever. No limits, no ads, no paywall. Ever.`),
        mk('p', 'ytdl-gate-p', 'If it’s useful to you, please support it with a free GitHub star. It helps other people discover it and encourages me to keep building and improving it.'),
        steps,
        ...(msg ? [mk('div', 'ytdl-gate-note', msg)] : []),
        row, later,
        mk('p', 'ytdl-gate-fine', 'We only check whether you’ve starred this one repository (read-only). Your star is verified once, then never checked again.'),
      );
    };

    /* ---- screen 2: device code ---- */
    const begin = async (b) => {
      if (b) { b.disabled = true; b.textContent = 'Contacting GitHub…'; }
      const r = await ask({ type: 'ytdl:gate-start' });
      if (!alive) return;
      if (r.error) return intro(r.error);
      codeScreen(r);
    };

    function codeScreen(r) {
      const uri = /^https:\/\/github\.com\//.test(r.verificationUri || '') ? r.verificationUri : 'https://github.com/login/device';
      let interval = Number(r.interval) || 5;
      const code = mk('div', 'ytdl-gate-code', r.userCode);
      const open = btn('Copy code & open GitHub', 'primary', (b) => {
        try { navigator.clipboard.writeText(r.userCode); b.textContent = 'Code copied ✓ Paste it on GitHub'; } catch { b.textContent = 'Opening GitHub…'; }
        window.open(uri, '_blank', 'noopener');
      });
      const wait = mk('div', 'ytdl-gate-wait'); wait.append(mk('i', 'ytdl-gate-spin'), mk('span', null, 'Waiting for you to authorize on GitHub…'));
      const done = btn('I’ve authorized it', 'text', () => { clearTimeout(timer); tick(); });
      const cancel = btn('Cancel', 'text', () => intro());
      const small = mk('div', 'ytdl-gate-row center'); small.append(done, cancel);
      show(
        mk('div', 'ytdl-gate-emoji', '🔐'),
        mk('h2', 'ytdl-gate-title', 'Authorize on GitHub'),
        mk('p', 'ytdl-gate-p', 'Open GitHub, enter this code and approve. This page will notice automatically.'),
        code, open, wait, small,
      );
      tick = async () => {
        if (!alive) return;
        const res = await ask({ type: 'ytdl:gate-poll' });
        if (!alive || !tick) return; // closed or cancelled while waiting
        switch (res.state) {
          case 'pending': interval = Number(res.interval) || interval; clearTimeout(timer); timer = setTimeout(tick, interval * 1000 + 400); break;
          case 'starred': success(); break;
          case 'not_starred': notStarred(false); break;
          case 'denied': intro('GitHub authorization was cancelled. Tap “Verify with GitHub” to try again.'); break;
          case 'expired': intro('That code expired. Tap “Verify with GitHub” for a fresh one.'); break;
          case 'reauth': intro('The GitHub session expired. Tap “Verify with GitHub” to try again.'); break;
          default: intro(res.message || res.error || 'Verification failed. Please try again.');
        }
      };
      timer = setTimeout(tick, interval * 1000 + 400);
      document.addEventListener('visibilitychange', onVis);
    }
    // poll right away when the user comes back to this tab from GitHub
    function onVis() { if (!document.hidden && alive && tick) { clearTimeout(timer); tick(); } }

    /* ---- screen 3: no star yet ---- */
    function notStarred(again) {
      stopPoll();
      const retry = btn('Retry check', 'primary', async (b) => {
        b.disabled = true; b.textContent = 'Checking…';
        const res = await ask({ type: 'ytdl:gate-retry' });
        if (!alive) return;
        if (res.state === 'starred') return success();
        if (res.state === 'not_starred') return notStarred(true);
        if (res.state === 'reauth') return intro('The GitHub session expired. Tap “Verify with GitHub” to check again.');
        b.disabled = false; b.textContent = 'Retry check';
        const n = card.querySelector('.ytdl-gate-note') || mk('div', 'ytdl-gate-note'); n.textContent = res.message || 'Couldn’t check right now. Please try again.';
        card.querySelector('.ytdl-gate-row').before(n);
      });
      const row = mk('div', 'ytdl-gate-row'); row.append(link('⭐  Open repo & star it', 'ghost'), retry);
      const repoLine = mk('p', 'ytdl-gate-fine'); const a = mk('a', null, REPO_URL.replace('https://', '')); a.href = REPO_URL; a.target = '_blank'; a.rel = 'noopener'; repoLine.append(a);
      show(
        mk('div', 'ytdl-gate-emoji', '⭐'),
        mk('h2', 'ytdl-gate-title', 'Almost there. One star to go'),
        mk('p', 'ytdl-gate-p', 'We couldn’t find your star on Archimetrix/Yt-Downloader yet. Please star the repository first, then come back and press Retry check.'),
        ...(again ? [mk('div', 'ytdl-gate-note', 'Still no star found. Make sure you starred it with the same GitHub account you just authorized.')] : []),
        row, repoLine,
      );
    }

    /* ---- screen 4: done ---- */
    function success() {
      stopPoll(); gate.unlocked = true;
      show(
        mk('div', 'ytdl-gate-emoji', '🎉'),
        mk('h2', 'ytdl-gate-title', 'Thank you! You’re all set'),
        mk('p', 'ytdl-gate-p', 'Everything is unlocked, permanently. You’ll never be asked again. Your support truly means a lot. 💛'),
      );
      setTimeout(() => {
        if (!alive) return;
        closeGate();
        if (req && videoId() === pendingVideo) start(req);
        else toast({ text: 'Unlocked! Click Download to continue.', tone: 'ok' });
      }, 1800);
    }

    intro();
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
    const id = req.videoId || videoId();
    if (!id) return toast({ text: 'Open a video to download it.', tone: 'error' });
    const sig = sigOf(id, req);
    await gate.ready;
    if ([...jobs.values()].some((j) => j.sig === sig)) return toast({ text: 'This one is already downloading.' });
    if (!gate.unlocked && gate.used + jobs.size + starting >= FREE_LIMIT) return openGate(req);
    if (jobs.size >= (Number(settings.maxParallel) || 2)) {
      return toast({ text: `${jobs.size} download${jobs.size > 1 ? 's are' : ' is'} already running. Wait for one to finish, or raise the limit in the extension’s Settings.`, tone: 'error' });
    }
    const jobId = uid();
    let title = id, author = '', meta = null;
    starting++;
    try {
      const pi = await probe(id);
      title = pi.title || id; author = pi.author || '';
    } catch { /* keep id */ }
    try {
      // Audio files get the song name, artist and (optionally) the thumbnail as cover art.
      if (req.mode === 'audio') {
        const isTopic = /\s-\sTopic$/i.test(author);
        meta = { title: title === id ? '' : title, artist: author.replace(/\s-\sTopic$/i, '') };
        const mode = ['auto', 'square', 'original', 'off'].includes(settings.coverArt) ? settings.coverArt : 'auto';
        if (mode !== 'off') {
          const cover = await Promise.race([
            chrome.runtime.sendMessage({ type: 'ytdl:cover', videoId: id, mode, isTopic }),
            new Promise((res) => setTimeout(() => res(null), 10000)),
          ]).catch(() => null);
          if (cover && cover.b64) meta.cover = cover;
        }
      }
    } catch { /* cover art is optional: carry on without it */ }
    finally { starting--; }
    jobs.set(jobId, { videoId: id, title, mode: req.mode, label: req.label || '', sig });
    lockPage(true);
    saveJobs([row_(jobId, { status: 'running', phase: 'prepare', message: 'Preparing…', ratio: null })]);
    toast({ text: 'Preparing…', ratio: null, cancel: true, sticky: true });
    refreshBusy();
    send('ytdl:start', { jobId, videoId: id, ...req, meta, prefix: req.mode === 'audio' ? AUDIO_MARK : '' });
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
        if (!gate.unlocked) await bumpFree();
        toast({ text: `Saved: ${unmark(d.result.filename)}`, tone: 'ok' });
      } else if (d.phase === 'cancelled') { dropJob(d.jobId); lastRow.delete(d.jobId); toast({ text: 'Download cancelled.' }); }
      else { saveJobs([row_(d.jobId, { status: 'error', message: d.message || 'Download failed.' })]); toast({ text: d.message || 'Download failed.', tone: 'error' }); }
    }
  });

  let histWrite = Promise.resolve();
  function addHistory(r) {
    histWrite = histWrite.then(async () => {
      try {
        const { history = [] } = await chrome.storage.local.get('history');
        history.unshift({ id: uid(), videoId: r.videoId, title: r.title, author: r.author, type: r.type, quality: r.quality, ext: r.ext, size: r.size, filename: unmark(r.filename), ts: Date.now() });
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
    for (const b of document.querySelectorAll('.ytdl-btn')) {
      b.classList.toggle('ytdl-busy', jobs.size > 0);
      b.dataset.count = jobs.size ? String(jobs.size) : '';
      b.title = jobs.size ? `Download (${jobs.size} running)` : 'Download';
    }
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
