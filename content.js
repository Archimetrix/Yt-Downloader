/*
 * YT DOWNLOADER - player UI
 * Copyright 2026 Archimetrix
 * Licensed under the Apache License, Version 2.0
 */
(() => {
  if (window.__ytdlUi) return;
  window.__ytdlUi = true;

  const DEFAULTS = { askEveryTime: true, defaultType: 'video', defaultHeight: 'best', defaultAudio: 'opus', defaultContainer: 'mp4', maxParallel: 2, coverArt: 'auto', plBanner: true };
  let settings = { ...DEFAULTS };
  const AUDIO_MARK = 'ytdl-audio--'; // background.js strips this and saves the file to the audio folder
  const unmark = (s) => String(s || '').replace(/^[~_]?ytdl-audio(?:~|--)/, '').replace(/^ytdl-pl--(?:(?!--).)+--/, '');
  // Folder name for a playlist: safe for every OS, and never contains the "--" the marker uses as its separator.
  const cleanFolder = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').replace(/-{2,}/g, '-').replace(/^[-. ]+|[-. ]+$/g, '').slice(0, 60);
  const jobs = new Map(); // jobId -> { videoId, title, mode, label, sig }
  let releaseLock = null;
  let toastTimer = null;

  try {
    chrome.storage.sync.get(DEFAULTS).then((s) => { settings = { ...DEFAULTS, ...s }; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
      if (changes.plBanner) { try { renderPlBanner(); } catch { /* not ready yet */ } }
    });
  } catch { /* extension reloaded */ }

  const ICON = '<svg viewBox="0 0 36 36" width="100%" height="100%" aria-hidden="true"><path fill="#fff" d="M18 7a1.6 1.6 0 0 1 1.6 1.6v10.1l3.3-3.3a1.6 1.6 0 1 1 2.3 2.3l-6.1 6.1a1.6 1.6 0 0 1-2.2 0l-6.1-6.1a1.6 1.6 0 1 1 2.3-2.3l3.3 3.3V8.6A1.6 1.6 0 0 1 18 7zM10 26.2h16a1.6 1.6 0 0 1 0 3.2H10a1.6 1.6 0 0 1 0-3.2z"/></svg>';
  const HEART = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="#e0302f" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 2.9 5 6.2 5c2 0 3.2 1 3.8 2 .6-1 1.8-2 3.8-2 3.3 0 5.3 3.3 3.8 6.8C19.5 16.4 12 21 12 21z"/></svg>';

  const $ = (s, r = document) => r.querySelector(s);
  const isShorts = () => location.pathname.startsWith('/shorts/');
  const player = () => (isShorts() && document.getElementById('shorts-player')) || document.getElementById('movie_player');
  const host = () => player();
  const videoId = () => (location.pathname.match(/^\/shorts\/([\w-]{11})/) || [])[1] || new URLSearchParams(location.search).get('v');
  const send = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const fmtSize = (n) => !n ? '' : n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? Math.round(n / 1e6) + ' MB' : Math.round(n / 1e3) + ' KB';

  /* ------------------------------- toast ------------------------------- */
  function toast({ text, ratio, cancel, sticky, tone }) {
    const p = host(); if (!p) return;
    let t = $('.ytdl-toast', isShorts() ? document : p);
    if (!t) {
      t = document.createElement('div');
      t.className = 'ytdl-toast' + (isShorts() ? ' ytdl-toast-short' : '');
      t.innerHTML = '<div class="ytdl-toast-row"><span class="ytdl-toast-text"></span><button class="ytdl-toast-x" title="Cancel download">✕</button></div><div class="ytdl-bar"><i></i></div>';
      for (const ev of ['click', 'mousedown', 'dblclick']) t.addEventListener(ev, (e) => e.stopPropagation());
      $('.ytdl-toast-x', t).addEventListener('click', () => { for (const [id, j] of jobs) if (j.pl || j.videoId === videoId()) { if (j.pl) plSkip = true; send('ytdl:cancel', { jobId: id }); } if (!pl || pl.state !== 'running') hideToast(); });
      (isShorts() ? document.body : p).appendChild(t);
    }
    if (isShorts()) placeShortToast(t);
    t.dataset.tone = tone || '';
    $('.ytdl-toast-text', t).textContent = text;
    $('.ytdl-toast-x', t).style.display = cancel ? '' : 'none';
    $('.ytdl-toast-x', t).title = pl && pl.state === 'running' ? 'Skip this video' : 'Cancel download';
    const bar = $('.ytdl-bar', t);
    bar.style.display = ratio === undefined ? 'none' : '';
    bar.classList.toggle('ytdl-indeterminate', ratio === null);
    if (typeof ratio === 'number') $('i', bar).style.width = Math.round(ratio * 100) + '%';
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(hideToast, 6000);
  }
  function hideToast() { $('.ytdl-toast', isShorts() ? document : (host() || document))?.remove(); }
  // Shorts: keep the toast outside the player, beside the action rail (right) or the video (left)
  function placeShortToast(t) {
    t.style.cssText = '';
    const btn = $('.ytdl-short-btn');
    const pr = (document.getElementById('shorts-player') || btn || document.body).getBoundingClientRect();
    const br = btn?.getBoundingClientRect();
    const w = Math.min(300, Math.max(200, innerWidth * 0.3));
    const railRight = br && br.width ? br.right + 24 : pr.right + 80;
    let left;
    if (railRight + 12 + w <= innerWidth - 8) left = railRight + 12;
    else if (pr.left - 12 - w >= 8) left = pr.left - 12 - w;
    else left = Math.max(8, innerWidth - w - 8);
    t.style.width = w + 'px';
    t.style.left = left + 'px';
    const top = br && br.width ? Math.min(Math.max(br.top, 64), innerHeight - 110) : 96;
    t.style.top = top + 'px';
  }
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


  // Same bridge as probe(), for the playlist helper (playlist-main.js): request event -> '<name>-result'.
  function mainCall(name, payload, ms) {
    return new Promise((resolve, reject) => {
      const reqId = uid();
      const timer = setTimeout(() => { document.removeEventListener(name + '-result', on); reject(new Error('The page didn’t respond. Reload the page and try again.')); }, ms || 8000);
      function on(e) {
        const d = JSON.parse(e.detail);
        if (d.reqId !== reqId) return;
        clearTimeout(timer); document.removeEventListener(name + '-result', on);
        d.ok ? resolve(d.data) : reject(new Error(d.error));
      }
      document.addEventListener(name + '-result', on);
      send(name, { reqId, ...payload });
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
        else if (pl && pl.state === 'paused') { toast({ text: 'Unlocked! Resuming the playlist…', tone: 'ok' }); plRun(); }
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
  const row_ = (id, patch) => { const j = jobs.get(id) || lastRow.get(id) || {}; const r = { id, videoId: j.videoId, title: j.title, mode: j.mode, label: j.label, plPos: j.plPos || '', ts: Date.now(), ...patch }; lastRow.set(id, r); return r; };

  function lockPage(on) {
    // While downloads run, hold a Web Lock so Chrome doesn't freeze this tab in the background.
    if (on && !releaseLock && navigator.locks) navigator.locks.request('ytdl-active', () => new Promise((res) => { releaseLock = res; })).catch(() => {});
    if (!on && releaseLock) { releaseLock(); releaseLock = null; }
  }
  const sigOf = (v, r) => [v, r.mode, r.mode === 'audio' ? (r.audioKind || r.audioItag || '') : (r.container || '') + (r.videoItag || r.height || 'best')].join('|');

  const waiters = new Map(); // jobId -> resolve(), used by the playlist runner to run videos one after another
  async function start(req, opts = {}) {
    const quiet = !!opts.pl; // playlist runs report through the runner instead of popping toasts/dialogs
    const id = req.videoId || videoId();
    if (!id) { if (!quiet) toast({ text: 'Open a video to download it.', tone: 'error' }); return { blocked: 'noid' }; }
    const sig = sigOf(id, req);
    await gate.ready;
    if ([...jobs.values()].some((j) => j.sig === sig)) { if (!quiet) toast({ text: 'This one is already downloading.' }); return { blocked: 'dup' }; }
    if (!gate.unlocked && gate.used + jobs.size + starting >= FREE_LIMIT) { if (!quiet) openGate(req); return { blocked: 'gate' }; }
    if (jobs.size >= (Number(settings.maxParallel) || 2)) {
      if (!quiet) toast({ text: `${jobs.size} download${jobs.size > 1 ? 's are' : ' is'} already running. Wait for one to finish, or raise the limit in the extension’s Settings.`, tone: 'error' });
      return { blocked: 'limit' };
    }
    const jobId = uid();
    let title = id, author = '', meta = null;
    starting++;
    try {
      const pi = await probe(id);
      title = pi.title || id; author = pi.author || '';
    } catch (err) { if (quiet) { starting--; return { blocked: 'probe', message: err.message }; } /* keep id */ }
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
    jobs.set(jobId, { videoId: id, title, mode: req.mode, label: req.label || '', sig, pl: quiet, plPos: opts.pos || '' });
    const done = quiet ? new Promise((res) => waiters.set(jobId, res)) : null;
    lockPage(true);
    saveJobs([row_(jobId, { status: 'running', phase: 'prepare', message: 'Preparing…', ratio: null })]);
    toast({ text: (opts.pos ? `(${opts.pos}) ` : '') + 'Preparing…', ratio: null, cancel: true, sticky: true });
    refreshBusy();
    send('ytdl:start', { jobId, videoId: id, ...req, meta, prefix: (req.mode === 'audio' ? AUDIO_MARK : '') + (req.plFolder ? `ytdl-pl--${cleanFolder(req.plFolder) || 'Playlist'}--` : '') });
    return { jobId, done };
  }

  document.addEventListener('ytdl:progress', async (e) => {
    const d = JSON.parse(e.detail);
    const j = jobs.get(d.jobId);
    if (!j) return;
    const here = j.pl || j.videoId === videoId();
    const label = j.pl ? `(${j.plPos}) ` : jobs.size > 1 ? `[${j.title.slice(0, 24)}] ` : '';
    if (j.pl && pl) {
      const it = pl.items[pl.cur];
      if (it) { it.ratio = typeof d.ratio === 'number' ? d.ratio : null; it.message = d.message || ''; savePl(); }
    }
    if (d.phase === 'prepare') { saveJobs([row_(d.jobId, { status: 'running', phase: 'prepare', message: d.message, ratio: null })]); if (here) toast({ text: d.message, ratio: null, cancel: true, sticky: true }); }
    else if (d.phase === 'download') { saveJobs([row_(d.jobId, { status: 'running', phase: 'download', message: d.message, ratio: d.ratio })]); if (here) toast({ text: `${label}${d.message} ${d.ratio != null ? Math.round(d.ratio * 100) + '%' : ''}`.trim(), ratio: d.ratio, cancel: true, sticky: true }); }
    else if (d.phase === 'mux') { saveJobs([row_(d.jobId, { status: 'running', phase: 'mux', message: d.message, ratio: null })]); if (here) toast({ text: d.message, ratio: null, sticky: true }); }
    else {
      jobs.delete(d.jobId);
      { const w = waiters.get(d.jobId); if (w) { waiters.delete(d.jobId); w({ phase: d.phase, message: d.message, result: d.result }); } }
      if (!jobs.size && !(pl && pl.state === 'running')) lockPage(false);
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
  window.addEventListener('beforeunload', (e) => { if (jobs.size || (pl && pl.state === 'running')) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('pagehide', () => { if (pl && pl.state === 'running') { pl.state = 'paused'; pl.reason = 'Interrupted: the YouTube tab was closed or reloaded. Press Resume to continue.'; for (const it of pl.items) if (it.status === 'loading' || it.status === 'running' || it.status === 'ready') it.status = 'queued'; pl.phase = ''; savePl(true); } for (const [id] of jobs) saveJobs([row_(id, { status: 'error', message: 'Interrupted: the YouTube tab was closed or reloaded.' })]); });

  function refreshBusy() {
    for (const b of document.querySelectorAll('.ytdl-btn')) {
      b.classList.toggle('ytdl-busy', jobs.size > 0);
      b.dataset.count = jobs.size ? String(jobs.size) : '';
      b.title = jobs.size ? `Download (${jobs.size} running)` : 'Download';
    }
  }

  /* ----------------------------- playlists -----------------------------
   * The downloader can only read a video's stream session from this page's own player, so a playlist is
   * done the way a person would do it by hand, just automated: this tab's player is loaded with video 1,
   * it's downloaded, then video 2, and so on. One tab, strictly one video at a time, no new windows.
   * The queue lives in chrome.storage.local ("plQueue") so the popup's Playlist tab can show and control it.
   */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const getListId = () => new URLSearchParams(location.search).get('list') || '';
  let pl = null;        // the playlist run this tab owns: { id, listId, title, req, state, reason, cur, items:[{videoId,title,status,message,ratio}] }
  let plBusy = false;   // the runner loop is active
  let plSkip = false;   // the current video was skipped by the user (rather than the whole playlist cancelled)
  let plTimer = null;

  const plCounts = () => { const c = { queued: 0, done: 0, error: 0, skipped: 0, cancelled: 0, active: 0 }; for (const it of pl.items) { if (it.status === 'loading' || it.status === 'running') c.active++; else c[it.status] = (c[it.status] || 0) + 1; } return c; };
  function savePl(now) {
    if (!pl) return;
    const write = () => { plTimer = null; if (!pl) return; try { chrome.storage.local.set({ plQueue: { ...pl, ts: Date.now() } }); } catch { /* extension reloaded */ } };
    if (now) { clearTimeout(plTimer); write(); } else if (!plTimer) plTimer = setTimeout(write, 700);
    try { sessionStorage.setItem('ytdlPlOwner', pl.id); } catch { /* ignore */ }
    renderPlBanner();
  }

  const PL_BATCH = 100;               // videos loaded per round (their sessions stay valid for hours)
  const PL_MAX_AGE = 4 * 3600 * 1000; // a loaded video older than this is loaded again before downloading

  async function plRun() {
    if (plBusy || !pl) return;
    plBusy = true;
    pl.state = 'running'; pl.reason = ''; lockPage(true); savePl(true);
    try {
      while (pl && pl.state === 'running') {
        // Step 1: load videos into this tab's player (needs the tab left alone), unless some are already loaded
        if (!pl.items.some((x) => x.status === 'ready')) {
          const batch = pl.items.filter((x) => x.status === 'queued').slice(0, PL_BATCH);
          if (!batch.length) break;
          if (!(await plHarvest(batch))) break;
        }
        // Step 2: download the loaded videos one by one in the background (the player is free for the user)
        await plDownload();
      }
    } finally { plBusy = false; plFinish(); }
  }

  // Step 1. Each video is loaded into the page's own player once, so its stream session and format list can be kept.
  async function plHarvest(batch) {
    pl.phase = 'loading'; savePl(true);
    let ok = true;
    try {
      for (const it of batch) {
        if (!pl || pl.state !== 'running') { ok = false; break; }
        if (!document.getElementById('movie_player')) { pl.state = 'paused'; pl.reason = 'Open a YouTube video page, then press Resume (the player is needed to load the videos).'; ok = false; break; }
        const idx = pl.items.indexOf(it), pos = `${idx + 1}/${pl.items.length}`;
        pl.cur = idx; it.status = 'loading'; it.message = ''; it.ratio = null; savePl();
        toast({ text: `Loading videos… (${pos}) “${it.title.slice(0, 40)}”`, ratio: null, cancel: false, sticky: true });
        try {
          await mainCall('ytdl:pl-goto', { videoId: it.videoId }, 110000);
          if (!pl || pl.state !== 'running') { it.status = 'queued'; ok = false; break; }
          const h = await mainCall('ytdl:pl-harvest', { videoId: it.videoId }, 70000);
          if (h.ok) { it.status = 'ready'; it.at = Date.now(); } else { it.status = 'error'; it.message = h.message; }
        } catch (e) { it.status = 'error'; it.message = e.message; }
        savePl();
      }
    } finally {
      send('ytdl:pl-player', { action: 'restore' }); // hand the player back to the user
      if (pl) { for (const it of pl.items) if (it.status === 'loading') it.status = 'queued'; pl.cur = -1; savePl(true); }
    }
    return ok;
  }

  // Step 2. One download at a time, from what step 1 kept. Nothing here touches the page's player.
  async function plDownload() {
    pl.phase = 'downloading'; savePl(true);
    for (const it of pl.items) {
      if (!pl || pl.state !== 'running') return;
      if (it.status !== 'ready') continue;
      // single downloads may already be using the slots: wait our turn instead of failing
      while (pl && pl.state === 'running' && jobs.size >= (Number(settings.maxParallel) || 2)) await sleep(1000);
      if (!pl || pl.state !== 'running') return;
      if (Date.now() - (it.at || 0) > PL_MAX_AGE) { it.status = 'queued'; it.message = 'Loaded too long ago: it will be loaded again.'; savePl(); continue; }
      const idx = pl.items.indexOf(it), pos = `${idx + 1}/${pl.items.length}`;
      pl.cur = idx; plSkip = false; savePl();
      const res = await start({ ...pl.req, videoId: it.videoId }, { pl: true, pos });
      let out;
      if (res.blocked === 'gate') { pl.state = 'paused'; pl.reason = 'Unlock to continue: star the project on GitHub, then press Resume.'; openGate(null); return; } // it stays "ready"
      if (res.blocked === 'dup') out = { phase: 'skipped', message: 'Already downloading.' };
      else if (res.blocked) out = { phase: 'error', message: res.message || 'Couldn’t start this video.' };
      else { it.status = 'running'; it.ratio = 0; savePl(); out = await res.done; }
      if (!pl) return;
      if (out.phase === 'done') { it.status = 'done'; it.message = unmark(out.result && out.result.filename); }
      else if (out.phase === 'cancelled') { it.status = plSkip || pl.state === 'running' ? 'skipped' : 'cancelled'; it.message = ''; }
      else if (out.phase === 'skipped') { it.status = 'skipped'; it.message = out.message || ''; }
      else { it.status = 'error'; it.message = out.message || 'Download failed.'; }
      it.ratio = null; plSkip = false; savePl();
    }
  }

  function plFinish() {
    if (!pl) { if (!jobs.size) lockPage(false); return; }
    if (pl.state === 'running') pl.state = pl.items.some((x) => x.status === 'queued' || x.status === 'ready') ? 'paused' : 'done';
    if (pl.state === 'cancelled') for (const it of pl.items) if (it.status === 'queued' || it.status === 'loading' || it.status === 'ready') it.status = 'cancelled';
    pl.cur = -1; pl.phase = '';
    if (pl.state === 'done' || pl.state === 'cancelled') {
      send('ytdl:pl-player', { action: 'restore' }); // put the user's own video back
      const c = plCounts();
      toast({ text: pl.state === 'done' ? `Playlist finished: ${c.done} saved${c.error ? `, ${c.error} failed` : ''}${c.skipped ? `, ${c.skipped} skipped` : ''}.` : 'Playlist cancelled.', tone: c.error ? 'error' : 'ok' });
    }
    savePl(true);
    if (!jobs.size) lockPage(false);
  }

  function plCancelCurrent() { for (const [id, j] of jobs) if (j.pl) send('ytdl:cancel', { jobId: id }); }
  function plCommand(cmd) {
    if (!pl) return;
    if (cmd === 'cancel') {
      if (pl.state !== 'running' && pl.state !== 'paused') return; // nothing left to cancel
      pl.state = 'cancelled'; plCancelCurrent();
      if (!plBusy) plFinish(); else savePl(true);
    } else if (cmd === 'skip') {
      if (pl.state === 'running') { plSkip = true; plCancelCurrent(); }
    } else if (cmd === 'resume') {
      if (pl.state === 'paused') plRun();
    } else if (cmd === 'retry') {
      for (const it of pl.items) if (it.status === 'error' || it.status === 'skipped' || it.status === 'cancelled') { it.status = 'queued'; it.message = ''; }
      if (!plBusy) { pl.state = 'paused'; plRun(); } else savePl(true);
    } else if (cmd === 'clear') {
      if (plBusy) return;
      clearTimeout(plTimer); pl = null; renderPlBanner();
      try { chrome.storage.local.remove('plQueue'); sessionStorage.removeItem('ytdlPlOwner'); } catch { /* ignore */ }
    }
  }
  try {
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'local' || !c.plCmd || !c.plCmd.newValue || !pl) return;
      if (c.plCmd.newValue.id === pl.id) plCommand(c.plCmd.newValue.cmd); // only the tab that owns this run acts
    });
  } catch { /* extension reloaded */ }

  function plBegin(info, picked, req) {
    if (pl && (plBusy || pl.state === 'running')) { toast({ text: 'A playlist is already downloading. Cancel it first from the extension’s Playlist tab.', tone: 'error' }); return; }
    const items = info.items.filter((v) => picked.has(v.videoId)).map((v) => ({ videoId: v.videoId, title: v.title, status: 'queued', message: '', ratio: null }));
    if (!items.length) return;
    pl = { id: uid(), listId: getListId() || info.listId || '', title: info.title || 'Playlist', author: info.author || '', folder: req.plFolder || '', req, state: 'paused', reason: '', cur: -1, startedAt: Date.now(), items };
    plRun();
  }


  /* ---- playlist video + "use my defaults": still ask whether it's just this video or the whole playlist ---- */
  function openChoice() {
    const p = player(); if (!p) return;
    closeMenu();
    const menu = mk('div', 'ytdl-menu');
    menu.append(mk('div', 'ytdl-menu-head', 'Download'));
    const body = mk('div', 'ytdl-menu-body');
    const h = settings.defaultHeight === 'best' || !settings.defaultHeight ? 'Best' : settings.defaultHeight + 'p';
    const def = settings.defaultType === 'audio' ? `Audio · ${settings.defaultAudio === 'm4a' ? 'M4A' : 'Opus'}` : `Video · ${h} · ${String(settings.defaultContainer || 'mp4').toUpperCase()}`;
    const a = row('Only this video', `Your defaults: ${def}`, '', () => { closeMenu(); startDefault(); });
    const b = row('The whole playlist', 'Pick videos, then name its folder', '', () => { closeMenu(); openMenu({ tab: 'playlist' }); });
    a.classList.add('stack'); b.classList.add('stack');
    body.append(section('This video is part of a playlist'), a, b);
    menu.append(body, footer());
    for (const ev of ['click', 'mousedown', 'dblclick', 'contextmenu']) menu.addEventListener(ev, (e) => e.stopPropagation());
    menu.dataset.vid = videoId() || '';
    p.appendChild(menu);
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', esc, true);
  }

  /* ---- last step before a playlist run: name the folder + read the warnings. Asked every time, never remembered ---- */
  let confirmEl = null;
  const confirmEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeConfirm(); } };
  function closeConfirm() { if (confirmEl) { confirmEl.remove(); confirmEl = null; } document.removeEventListener('keydown', confirmEsc, true); }
  async function openPlaylistConfirm(info, picked, req) {
    const p = host(); if (!p) return;
    closeMenu(); closeConfirm();
    let dirs = { baseFolder: '', videoFolder: null, audioFolder: null };
    try { dirs = await chrome.storage.sync.get(dirs); } catch { /* ignore */ }
    const root = String((req.mode === 'audio' ? dirs.audioFolder ?? dirs.baseFolder : dirs.videoFolder ?? dirs.baseFolder) || '').replace(/^[\\/]+|[\\/]+$/g, '');
    const n = [...picked].length;

    const wrap = mk('div', 'ytdl-gate');
    const card = mk('div', 'ytdl-gate-card');
    wrap.append(card);
    for (const ev of ['click', 'mousedown', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'keypress', 'wheel']) wrap.addEventListener(ev, (e) => e.stopPropagation()); // keep YouTube's hotkeys out of the text box
    const x = mk('button', 'ytdl-gate-x', '✕'); x.setAttribute('aria-label', 'Close'); x.addEventListener('click', closeConfirm);

    const what = req.mode === 'audio' ? `Audio · ${req.label}` : `Video · ${req.label} · ${String(req.container).toUpperCase()}`;
    const input = mk('input', 'ytdl-input'); input.type = 'text'; input.maxLength = 60; input.value = cleanFolder(info.title) || 'Playlist'; input.spellcheck = false;
    const where = mk('div', 'ytdl-pl-where');
    const paint = () => { where.textContent = `Saved to: Downloads / ${root ? root + ' / ' : ''}${cleanFolder(input.value) || 'Playlist'} /`; };
    input.addEventListener('input', paint); paint();

    const warn = mk('div', 'ytdl-pl-warn');
    warn.append(mk('b', null, 'How this works: please read before you start'));
    const ul = mk('ul');
    for (const [b, t] of [
      ['Step 1: loading. ', 'This tab loads your videos one by one, a few seconds each. Leave YouTube alone until that finishes: don’t click, scroll, search or open other videos in it.'],
      ['Step 2: downloading. ', 'Once every video is loaded, downloads run one after another in the background. You can then use YouTube normally and do other work.'],
      ['Until everything is saved, ', 'don’t close or reload this YouTube tab, and don’t close the browser, or the downloads stop.'],
      ['Please wait patiently. ', 'The total time depends on your network speed and on video processing, and a long playlist takes a while.'],
    ]) { const li = mk('li'); li.append(mk('b', null, b), mk('span', null, t)); ul.append(li); }
    warn.append(ul);

    const go = mk('button', 'ytdl-gate-btn primary', 'I understand, start downloading');
    const start_ = () => { const name = cleanFolder(input.value) || 'Playlist'; closeConfirm(); plBegin(info, picked, { ...req, plFolder: name }); };
    go.addEventListener('click', start_);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') start_(); });
    const back = mk('button', 'ytdl-gate-btn text', 'Back'); back.addEventListener('click', () => { closeConfirm(); openMenu({ tab: 'playlist' }); });

    card.append(x, mk('h2', 'ytdl-gate-title', 'Download this playlist'),
      mk('p', 'ytdl-gate-p', `${n} video${n === 1 ? '' : 's'} · ${what}`),
      mk('label', 'ytdl-pl-label', 'Name this playlist’s folder'), input, where, warn, go, back);
    p.appendChild(wrap); confirmEl = wrap;
    document.addEventListener('keydown', confirmEsc, true);
    input.focus(); input.select();
  }

  /* ---- always-visible banner while a playlist runs (or is paused) ---- */
  let plBannerGone = '', plBannerTimerFor = '';
  function renderPlBanner() {
    let b = $('.ytdl-plbanner');
    if (!pl || (pl.state !== 'running' && pl.state !== 'paused')) { if (b) b.remove(); return; }
    const c = plCounts(), n = pl.items.length, fin = c.done + c.error + c.skipped + c.cancelled;
    const loaded = n - c.queued - c.loading;
    const loading = pl.state === 'running' && pl.phase === 'loading';
    // The running bar can be switched off for good (eye button / Settings) and closes itself 7 s after the loading step is over.
    // The paused bar always stays: it holds the Resume button.
    if (pl.state === 'running') {
      if (settings.plBanner === false || plBannerGone === pl.id) { if (b) b.remove(); return; }
      if (!loading && plBannerTimerFor !== pl.id) { plBannerTimerFor = pl.id; const id = pl.id; setTimeout(() => { plBannerGone = id; renderPlBanner(); }, 7000); }
    }
    const key = [pl.state, pl.phase, fin, loaded, n, pl.reason].join('|');
    if (b && b.dataset.k === key) return;
    if (!b) { b = mk('div', 'ytdl-plbanner'); for (const ev of ['click', 'mousedown', 'keydown']) b.addEventListener(ev, (e) => e.stopPropagation()); document.body.appendChild(b); }
    b.dataset.k = key; b.dataset.state = pl.state; b.dataset.phase = loading ? 'loading' : 'downloading'; b.textContent = '';
    const txt = mk('div', 'ytdl-plbanner-txt');
    if (pl.state === 'running') {
      if (loading) txt.append(mk('b', null, `Step 1 of 2 · Loading your videos (${loaded} of ${n})`),
        mk('span', null, 'Leave this YouTube tab alone for a moment: don’t click, scroll or open other videos. It loads each video one by one. When this finishes you can use YouTube normally.'));
      else txt.append(mk('b', null, `Step 2 of 2 · Downloading in the background · video ${Math.min(fin + 1, n)} of ${n}`),
        mk('span', null, 'You can use YouTube normally now. Don’t close or reload this tab, and don’t close the browser, or the downloads stop. It depends on your network speed and video processing, so please wait patiently.'));
      const cancel = mk('button', 'ytdl-plbanner-btn', 'Cancel playlist'); cancel.addEventListener('click', () => plCommand('cancel'));
      const eye = mk('button', 'ytdl-plbanner-btn ytdl-plbanner-eye');
      eye.title = 'Hide this bar for all playlists (turn it back on in the extension’s Settings)'; eye.setAttribute('aria-label', 'Hide this bar for all playlists');
      eye.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M2 12s3.6-7 10-7c2 0 3.7.7 5.1 1.6M22 12s-3.6 7-10 7c-2 0-3.7-.7-5.1-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/></svg>';
      eye.addEventListener('click', () => { settings.plBanner = false; try { chrome.storage.sync.set({ plBanner: false }); } catch { /* ignore */ } renderPlBanner(); });
      b.append(txt, eye, cancel);
    } else {
      txt.append(mk('b', null, 'Playlist download paused'), mk('span', null, pl.reason || 'Press Resume to continue.'));
      const res = mk('button', 'ytdl-plbanner-btn go', 'Resume'); res.addEventListener('click', () => plCommand('resume'));
      const cancel = mk('button', 'ytdl-plbanner-btn', 'Cancel'); cancel.addEventListener('click', () => plCommand('cancel'));
      b.append(txt, res, cancel);
    }
  }

  // A reload mid-run: bring the queue back as "paused" so one click continues where it stopped.
  (async () => {
    try {
      const owner = sessionStorage.getItem('ytdlPlOwner'); if (!owner) return;
      const { plQueue } = await chrome.storage.local.get('plQueue');
      if (!plQueue || plQueue.id !== owner || plQueue.state === 'done' || plQueue.state === 'cancelled' || pl) return;
      pl = plQueue;
      for (const it of pl.items) if (it.status === 'loading' || it.status === 'running' || it.status === 'ready') it.status = 'queued';
      pl.state = 'paused'; pl.cur = -1; pl.phase = ''; pl.reason = 'Interrupted by a page reload. Press Resume to continue.'; savePl(true);
    } catch { /* ignore */ }
  })();

  /* -------------------------------- menu -------------------------------- */
  function closeMenu() { $('.ytdl-menu')?.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc, true); }
  const outside = (e) => { if (!e.target.closest?.('.ytdl-menu, .ytdl-btn')) closeMenu(); };
  const esc = (e) => { if (e.key === 'Escape') closeMenu(); };

  async function openMenu(opts = {}) {
    const p = player(); if (!p) return;
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'ytdl-menu';
    menu.innerHTML = '<div class="ytdl-menu-head">Download</div><div class="ytdl-menu-body"><div class="ytdl-muted">Loading formats…</div></div>';
    for (const ev of ['click', 'mousedown', 'dblclick', 'contextmenu']) menu.addEventListener(ev, (e) => e.stopPropagation());
    menu.dataset.vid = videoId() || '';
    if (isShorts()) { menu.classList.add('ytdl-menu-fixed'); document.body.appendChild(menu); placeShortMenu(menu); }
    else p.appendChild(menu);
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
    const single = document.createElement('div');
    single.append(section('Video format'), seg, videoBox);
    renderVideo();
    if (info.audio.length) {
      single.append(section('Audio only'));
      for (const a of info.audio) {
        single.append(row(a.label, a.bitrate ? Math.round(a.bitrate / 1000) + ' kbps' : '', fmtSize(a.size), () => {
          closeMenu(); start({ mode: 'audio', audioItag: a.itag, audioKind: a.kind, label: a.label });
        }));
      }
    }
    // On a playlist page the menu gets a second view next to the normal video/audio choices.
    if (getListId()) {
      const plBox = document.createElement('div');
      const tabs = document.createElement('div'); tabs.className = 'ytdl-seg ytdl-seg-top';
      let built = false;
      const show = (which) => {
        for (const b of tabs.children) b.classList.toggle('on', b.dataset.t === which);
        single.hidden = which !== 'single'; plBox.hidden = which !== 'playlist';
        if (which === 'playlist' && !built) { built = true; buildPlaylistView(plBox, menu); }
      };
      for (const [k, l] of [['single', 'This video'], ['playlist', 'Playlist']]) {
        const b = document.createElement('button'); b.className = 'ytdl-seg-btn'; b.dataset.t = k; b.textContent = l;
        b.addEventListener('click', () => show(k)); tabs.append(b);
      }
      body.append(tabs, single, plBox);
      show(opts.tab === 'playlist' ? 'playlist' : 'single');
    } else body.append(single);
    menu.append(footer());
  }

  /* ---- the playlist view of the menu ---- */
  const fmtDur = (n) => { n = Number(n) || 0; if (!n) return ''; const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), sec = n % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0'); };
  async function buildPlaylistView(box, menu) {
    box.append(note('Loading playlist…', false));
    let info;
    try { info = await mainCall('ytdl:pl-list', { listId: getListId() }, 90000); info.listId = getListId(); }
    catch (e) { box.textContent = ''; box.append(note(e.message, true)); return; }
    if (!menu.isConnected) return;
    box.textContent = '';
    const st = {
      type: settings.defaultType === 'audio' ? 'audio' : 'video',
      fmt: ['mp4', 'webm', 'mkv'].includes(settings.defaultContainer) ? settings.defaultContainer : 'mp4',
      height: settings.defaultHeight && settings.defaultHeight !== 'best' ? String(settings.defaultHeight) : 'best',
      akind: settings.defaultAudio === 'm4a' ? 'm4a' : 'opus',
      picked: new Set(info.items.filter((v) => v.playable).map((v) => v.videoId)),
    };
    const seg = (pairs, get, set) => {
      const d = mk('div', 'ytdl-seg');
      for (const [k, l] of pairs) { const b = mk('button', 'ytdl-seg-btn', l); b.dataset.k = k; b.addEventListener('click', () => { set(k); sync(); }); d.append(b); }
      d._sync = () => { for (const b of d.children) b.classList.toggle('on', b.dataset.k === get()); };
      return d;
    };
    const typeSeg = seg([['video', 'Video'], ['audio', 'Audio only']], () => st.type, (k) => { st.type = k; });
    const fmtSeg = seg([['mp4', 'MP4'], ['webm', 'WebM'], ['mkv', 'MKV']], () => st.fmt, (k) => { st.fmt = k; });
    const audSeg = seg([['opus', 'Opus (WebM)'], ['m4a', 'M4A (AAC)']], () => st.akind, (k) => { st.akind = k; });
    const sel = mk('select', 'ytdl-sel');
    for (const [v, l] of [['best', 'Best available'], ['2160', 'Up to 2160p (4K)'], ['1440', 'Up to 1440p'], ['1080', 'Up to 1080p'], ['720', 'Up to 720p'], ['480', 'Up to 480p'], ['360', 'Up to 360p']]) { const o = mk('option', null, l); o.value = v; sel.append(o); }
    sel.value = st.height; if (sel.value !== st.height) sel.value = 'best';
    sel.addEventListener('change', () => { st.height = sel.value; });
    const vOpts = mk('div'); vOpts.append(fmtSeg, sel);
    const aOpts = mk('div'); aOpts.append(audSeg);

    const go = mk('button', 'ytdl-gate-btn primary ytdl-pl-go');
    const count = mk('span', 'ytdl-pl-count');
    const list = mk('div', 'ytdl-pl-list');
    const boxes = new Map();
    const refreshCount = () => { const n = st.picked.size; count.textContent = `${n} of ${info.items.length} selected`; go.textContent = n ? `Download ${n} video${n > 1 ? 's' : ''} · one after another` : 'Select at least one video'; go.disabled = !n; };
    info.items.forEach((v, i) => {
      const lab = mk('label', 'ytdl-pl-item' + (v.playable ? '' : ' off'));
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = st.picked.has(v.videoId); cb.disabled = !v.playable;
      cb.addEventListener('change', () => { cb.checked ? st.picked.add(v.videoId) : st.picked.delete(v.videoId); refreshCount(); });
      boxes.set(v.videoId, cb);
      lab.append(cb, mk('span', 'ytdl-pl-n', String(i + 1)), mk('span', 'ytdl-pl-t', v.playable ? v.title : v.title + ' (unavailable)'), mk('span', 'ytdl-pl-d', fmtDur(v.duration)));
      list.append(lab);
    });
    const pickWhere = (fn) => { st.picked.clear(); info.items.forEach((v, i) => { const on = v.playable && fn(v, i); if (on) st.picked.add(v.videoId); boxes.get(v.videoId).checked = !!on; }); refreshCount(); };
    const link = (t, fn) => { const b = mk('button', 'ytdl-pl-link', t); b.type = 'button'; b.addEventListener('click', fn); return b; };
    const here = info.items.findIndex((v) => v.videoId === videoId());
    const tools = mk('div', 'ytdl-pl-tools');
    tools.append(link('All', () => pickWhere(() => true)), link('None', () => pickWhere(() => false)));
    if (here > 0) tools.append(link('From this video', () => pickWhere((v, i) => i >= here)));
    tools.append(count);

    go.addEventListener('click', () => {
      const h = st.height === 'best' ? null : Number(st.height);
      const req = st.type === 'audio'
        ? { mode: 'audio', audioKind: st.akind, label: st.akind === 'opus' ? 'Opus' : 'M4A' }
        : { mode: 'video', container: st.fmt, height: h, label: h ? `≤${h}p` : 'Best' };
      closeMenu(); openPlaylistConfirm(info, st.picked, req);
    });
    function sync() { typeSeg._sync(); fmtSeg._sync(); audSeg._sync(); vOpts.hidden = st.type !== 'video'; aOpts.hidden = st.type !== 'audio'; }

    box.append(mk('div', 'ytdl-pl-title', info.title), mk('div', 'ytdl-pl-sub', `${info.items.length} videos${info.author ? ' · ' + info.author : ''}`),
      section('Download as'), typeSeg, vOpts, aOpts, section('Videos'), tools, list, go);
    sync(); refreshCount();
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
    if (settings.askEveryTime) return openMenu();           // the menu has "This video | Playlist" tabs on playlist videos
    if (getListId() && !isShorts()) return openChoice();    // defaults are set, but a playlist video still gets the choice
    startDefault();
  }
  function startDefault() {
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

  /* --------------------------- the Shorts button --------------------------- */
  function placeShortMenu(menu) {
    const r = $('.ytdl-short-btn')?.getBoundingClientRect();
    menu.style.left = 'auto'; menu.style.top = 'auto';
    if (r && r.width) {
      menu.style.right = Math.max(12, innerWidth - r.left + 14) + 'px';
      menu.style.bottom = Math.max(12, Math.min(innerHeight - r.bottom, innerHeight - 160)) + 'px';
    } else { menu.style.right = '24px'; menu.style.bottom = '24px'; }
  }

  // Finds the Remix/Share button in the Shorts action rail and returns the rail's own child
  // (the "slot") to insert after. Looks buttons up by id or label so it survives markup changes.
  function findRailAnchor(reel) {
    const root = $('ytd-reel-player-overlay-renderer', reel) || reel;
    let el = null;
    for (const sel of ['#remix-button', 'button[aria-label^="Remix" i]', '#share-button', 'button[aria-label^="Share" i]', '[aria-label^="Share" i]']) { el = $(sel, root); if (el) break; }
    if (!el) return null;
    let node = el;
    for (let i = 0; i < 7 && node.parentElement && node.parentElement !== root; i++) {
      const par = node.parentElement;
      if (par.children.length >= 3 && !par.classList.contains('ytdl-short-slot')) return node;
      node = par;
    }
    return null;
  }

  let railMiss = 0;
  function injectShort() {
    if (!isShorts()) { railMiss = 0; return; }
    const reel = $('ytd-reel-video-renderer[is-active]') || $('ytd-shorts ytd-reel-video-renderer');
    if (!reel || $('.ytdl-short-slot', reel)) return;
    const anchor = findRailAnchor(reel);
    // give the rail a moment to render; only then fall back to a floating button inside the player
    if (!anchor && ++railMiss < 8) return;
    const slot = document.createElement('div');
    slot.className = 'ytdl-short-slot';
    const b = document.createElement('button');
    b.className = 'ytdl-btn ytdl-short-btn';
    b.type = 'button';
    b.title = 'Download';
    b.setAttribute('aria-label', 'Download this Short');
    b.innerHTML = ICON;
    b.addEventListener('click', onButton);
    const label = document.createElement('span');
    label.className = 'ytdl-short-label';
    label.textContent = 'Download';
    slot.append(b, label);
    for (const ev of ['mousedown', 'dblclick', 'contextmenu']) slot.addEventListener(ev, (e) => e.stopPropagation());
    if (anchor) anchor.after(slot);
    else { slot.classList.add('ytdl-short-float'); (player() || reel).appendChild(slot); }
    railMiss = 0;
    refreshBusy();
  }

  /* On /playlist pages there's no player, so offer a floating button that jumps into the first video
     (one normal page load in this same tab) and opens the Playlist picker there. */
  function injectPlaylistPill() {
    const old = $('.ytdl-plpill');
    const lid = location.pathname === '/playlist' ? getListId() : '';
    if (!lid) { if (old) old.remove(); return; }
    if (old && old.dataset.lid === lid) return;
    if (old) old.remove();
    const b = document.createElement('button');
    b.className = 'ytdl-plpill'; b.dataset.lid = lid; b.type = 'button'; b.textContent = '⬇ Download playlist';
    b.addEventListener('click', () => {
      const a = [...document.querySelectorAll('a[href*="/watch?v="]')].find((x) => /[?&]list=/.test(x.getAttribute('href') || ''));
      if (!a) { b.textContent = 'Scroll a little so the videos load, then retry'; setTimeout(() => { b.textContent = '⬇ Download playlist'; }, 3500); return; }
      try { sessionStorage.setItem('ytdlPlPending', lid); } catch { /* ignore */ }
      location.assign(a.href);
    });
    document.body.appendChild(b);
  }
  function openPendingPlaylist() {
    let pend = ''; try { pend = sessionStorage.getItem('ytdlPlPending') || ''; } catch { /* ignore */ }
    if (!pend || location.pathname !== '/watch' || getListId() !== pend || !$('.ytdl-btn') || $('.ytdl-menu')) return;
    try { sessionStorage.removeItem('ytdlPlPending'); } catch { /* ignore */ }
    openMenu({ tab: 'playlist' });
  }

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return; scheduled = true;
    setTimeout(() => {
      scheduled = false;
      inject(); injectShort(); injectPlaylistPill(); openPendingPlaylist();
      { const st = $('.ytdl-toast.ytdl-toast-short'); if (st) { if (isShorts()) placeShortToast(st); else st.remove(); } }
      // the menu belongs to the video it was opened on: close it if the user scrolled to another Short
      const m = $('.ytdl-menu'); if (m && m.dataset.vid && m.dataset.vid !== videoId()) closeMenu();
    }, 400);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', () => { closeMenu(); schedule(); });
  schedule();
})();
