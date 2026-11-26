/*
 * YT DOWNLOADER - playlist helper (runs in the page, next to main.js)
 * Copyright 2026 Archimetrix
 * Licensed under the Apache License, Version 2.0
 *
 * Two jobs, both done inside the YouTube tab that is already open (no extra tabs/windows):
 *   1. list every video of a playlist (YouTube's own /youtubei/v1/browse endpoint, same origin)
 *   2. load each video into the page's own player once, because that is where its stream session comes from,
 *      and keep that session so the download can run later while the player is free for the user.
 * Talks to content.js through the same CustomEvent bridge as main.js.
 */
(() => {
  if (window.__ytdlPlaylist) return;
  window.__ytdlPlaylist = true;

  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }));
  const on = (name, fn) => document.addEventListener(name, (e) => { let d; try { d = JSON.parse(e.detail); } catch { return; } fn(d); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const player = () => document.getElementById('movie_player');
  const cfg = (k) => { try { return window.ytcfg && window.ytcfg.get ? window.ytcfg.get(k) : undefined; } catch { return undefined; } };
  const txt = (t) => (!t ? '' : t.simpleText != null ? t.simpleText : (t.runs || []).map((r) => r.text).join(''));
  const reply = (name, reqId, fn) => fn().then((data) => emit(name + '-result', { reqId, ok: true, data }), (e) => emit(name + '-result', { reqId, ok: false, error: (e && e.message) || String(e) }));

  /* ---------------------------- playlist listing ---------------------------- */
  async function browse(body) {
    const ctx = cfg('INNERTUBE_CONTEXT');
    if (!ctx) throw new Error('YouTube isn’t ready yet. Reload the page and try again.');
    const key = cfg('INNERTUBE_API_KEY');
    const r = await fetch('/youtubei/v1/browse?prettyPrint=false' + (key ? '&key=' + encodeURIComponent(key) : ''), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Youtube-Client-Name': String(cfg('INNERTUBE_CONTEXT_CLIENT_NAME') || 1),
        'X-Youtube-Client-Version': String(cfg('INNERTUBE_CONTEXT_CLIENT_VERSION') || ''),
      },
      body: JSON.stringify({ context: ctx, ...body }),
    });
    if (!r.ok) throw new Error(`YouTube answered ${r.status} for this playlist.`);
    return r.json();
  }

  function walk(o, out) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) walk(x, out); return; }
    if (o.playlistVideoRenderer) {
      const v = o.playlistVideoRenderer;
      if (v.videoId) {
        out.items.push({
          videoId: v.videoId,
          title: txt(v.title) || v.videoId,
          author: txt(v.shortBylineText),
          duration: Number(v.lengthSeconds) || 0,
          playable: v.isPlayable !== false,
        });
      }
      return;
    }
    if (o.continuationItemRenderer) {
      const t = o.continuationItemRenderer.continuationEndpoint && o.continuationItemRenderer.continuationEndpoint.continuationCommand && o.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
      if (t) out.next = t;
      return;
    }
    for (const k in o) walk(o[k], out);
  }

  // Fallback for auto-generated mixes (RD…) that the browse endpoint can't list: read the side panel.
  function fromPanel() {
    const items = [];
    document.querySelectorAll('ytd-playlist-panel-video-renderer').forEach((el) => {
      const a = el.querySelector('a#wc-endpoint, a[href*="watch?v="]');
      let id = '';
      try { id = a ? new URL(a.href, location.href).searchParams.get('v') || '' : ''; } catch { /* ignore */ }
      if (!id) return;
      items.push({
        videoId: id,
        title: ((el.querySelector('#video-title') || {}).textContent || id).trim(),
        author: ((el.querySelector('#byline') || {}).textContent || '').trim(),
        duration: 0,
        playable: true,
      });
    });
    const t = document.querySelector('ytd-playlist-panel-renderer #header-contents .title, ytd-playlist-panel-renderer .title');
    return { title: (t && t.textContent.trim()) || 'Playlist', author: '', items };
  }

  async function listPlaylist(listId) {
    if (!/^[\w-]{2,64}$/.test(listId || '')) throw new Error('This page has no playlist.');
    let title = '', author = '';
    const items = [];
    try {
      let data = await browse({ browseId: 'VL' + listId });
      const hd = data.header && data.header.playlistHeaderRenderer;
      title = txt(hd && hd.title) || txt(data.metadata && data.metadata.playlistMetadataRenderer && data.metadata.playlistMetadataRenderer.title) || '';
      author = txt(hd && hd.ownerText) || '';
      for (let page = 0; page < 80; page++) { // 80 pages x 100 = the 5000-video playlist limit, with headroom
        const out = { items: [], next: '' };
        walk(data, out);
        items.push(...out.items);
        if (!out.next) break;
        data = await browse({ continuation: out.next });
      }
    } catch (e) {
      if (!items.length) { const p = fromPanel(); if (p.items.length) return dedupe(p); throw e; }
    }
    if (!items.length) { const p = fromPanel(); if (p.items.length) return dedupe(p); throw new Error('No videos were found in this playlist (it may be private or empty).'); }
    return dedupe({ title: title || 'Playlist', author, items });
  }
  function dedupe(p) {
    const seen = new Set();
    p.items = p.items.filter((v) => (seen.has(v.videoId) ? false : (seen.add(v.videoId), true)));
    return p;
  }

  on('ytdl:pl-list', (d) => reply('ytdl:pl-list', d.reqId, () => listPlaylist(d.listId)));

  /* --------------------------- drive the page player --------------------------- */
  let saved = null; // what the user was watching, so we can put it back afterwards

  async function gotoVideo(videoId, timeoutMs) {
    const p = player();
    if (!p || typeof p.loadVideoById !== 'function') throw new Error('The video player isn’t on this page. Open any YouTube video and resume.');
    if (!saved) {
      let id = '';
      try { id = (p.getPlayerResponse().videoDetails || {}).videoId || ''; } catch { /* ignore */ }
      saved = { id, t: (p.getCurrentTime && p.getCurrentTime()) || 0, muted: !!(p.isMuted && p.isMuted()), paused: !!(p.getPlayerState && p.getPlayerState() === 2) };
    }
    try { p.mute(); } catch { /* ignore */ }
    p.loadVideoById(videoId);
    const t0 = Date.now(), end = t0 + (timeoutMs || 90000);
    for (;;) {
      await sleep(300);
      let r = null;
      try { r = p.getPlayerResponse(); } catch { /* ignore */ }
      const same = !!(r && r.videoDetails && r.videoDetails.videoId === videoId);
      const st = r && r.playabilityStatus && r.playabilityStatus.status;
      const bad = !!(st && st !== 'OK' && (same || Date.now() - t0 > 8000));
      if ((same || bad) && !p.classList.contains('ad-showing')) {
        // Loop the clip while we wait for the stream session, so YouTube can't auto-advance to the next video.
        try { const v = p.querySelector('video'); if (v) v.loop = true; } catch { /* ignore */ }
        return { videoId, ready: same && !bad };
      }
      if (Date.now() > end) throw new Error('The video didn’t load in time.');
    }
  }
  on('ytdl:pl-goto', (d) => reply('ytdl:pl-goto', d.reqId, () => gotoVideo(d.videoId, d.timeoutMs)));

  // Wait until main.js has captured THIS video's stream session and stored its format list (see __ytdlHarvest).
  async function harvest(videoId, timeoutMs) {
    const p = player();
    const t0 = Date.now();
    let kicked = false;
    for (;;) {
      let r = 'wait';
      try { r = window.__ytdlHarvest(videoId, Date.now() - t0 > 20000); } catch { /* main.js not ready yet */ }
      if (r === 'ok') return { ok: true };
      if (typeof r === 'string' && r.startsWith('bad:')) return { ok: false, message: r.slice(4) };
      if (!kicked && Date.now() - t0 > 1500) { kicked = true; try { p.seekTo(p.getCurrentTime(), true); } catch { /* ignore */ } }
      if (Date.now() - t0 > (timeoutMs || 45000)) return { ok: false, message: 'Couldn’t read this video’s stream session. Use Retry failed to try it again.' };
      await sleep(250);
    }
  }
  on('ytdl:pl-harvest', (d) => reply('ytdl:pl-harvest', d.reqId, () => harvest(d.videoId, d.timeoutMs)));

  on('ytdl:pl-player', (d) => {
    const p = player(); if (!p) return;
    try {
      if (d.action === 'pause') p.pauseVideo();
      else if (d.action === 'restore') {
        const s = saved; saved = null;
        try { const v = p.querySelector('video'); if (v) v.loop = false; } catch { /* ignore */ }
        if (!s) return;
        if (s.id) p.loadVideoById({ videoId: s.id, startSeconds: s.t });
        if (!s.muted) p.unMute();
        if (s.paused) setTimeout(() => { try { p.pauseVideo(); } catch { /* ignore */ } }, 800);
      }
    } catch { /* ignore */ }
  });
})();
