/*
 * YT DOWNLOADER - background
 * Copyright 2026 Archimetrix
 * Licensed under the Apache License, Version 2.0
 *
 * Only job: put finished files into the folder (inside Downloads) the user chose.
 * Downloads themselves run inside the YouTube tab.
 */
'use strict';

const AUDIO_MARK_RE = /^[~_]?ytdl-audio(?:~|--)/; // Chrome may turn a leading ~ into _; keep in sync with content.js // keep in sync with content.js

function cleanName(s) {
  return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80);
}
// Chrome only allows folders inside the Downloads directory: no absolute paths, no parent (..) segments.
function cleanPath(p) {
  return String(p || '').split(/[\\/]+/).map(cleanName).filter((x) => x && x !== '..').join('/');
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // Only touch files our page saved (blob: URLs from youtube.com); leave every other download alone.
  if (typeof item.url !== 'string' || !/^blob:https:\/\/www\.youtube\.com/.test(item.url)) return;
  chrome.storage.sync.get({ baseFolder: '', videoFolder: null, audioFolder: null }).then(({ baseFolder, videoFolder, audioFolder }) => {
    let base = (item.filename || '').split(/[\\/]/).pop() || 'video';
    // The page tags audio-only files with AUDIO_MARK in the file name; strip it and use the audio folder.
    const markM = base.match(AUDIO_MARK_RE);
    const isAudio = !!markM;
    if (isAudio) base = base.slice(markM[0].length) || 'audio';
    // Older versions had one folder for everything: keep using it until the user sets the new ones.
    const dir = cleanPath(isAudio ? (audioFolder ?? baseFolder) : (videoFolder ?? baseFolder));
    suggest({ filename: dir ? `${dir}/${base}` : base, conflictAction: 'uniquify' });
  }).catch(() => suggest());
  return true;
});

/* ------------------------------ cover art ------------------------------
 * Audio downloads can carry the video's thumbnail as cover art. Normal videos have a
 * 16:9 thumbnail, but real songs (YouTube "Topic" / art tracks) are square album art
 * sitting inside a black 16:9 frame. We trim those black bars and crop to a true square,
 * so the cover looks like a normal music library entry.
 * Runs here (not in the page) because this script may fetch i.ytimg.com without CORS trouble.
 */
const LUMA_BAR = 22; // pixels at or below this brightness count as "black bar"

async function fetchThumb(videoId) {
  for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
    try {
      const r = await fetch(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${name}.jpg`, { cache: 'no-store' });
      if (!r.ok) continue;
      const blob = await r.blob();
      const bmp = await createImageBitmap(blob);
      if (bmp.width >= 200 && bmp.height >= 150) return bmp; // tiny grey placeholders are skipped
    } catch { /* try the next size */ }
  }
  return null;
}

// Bounding box of the non-black content, found on a small copy of the image.
function contentBox(bmp) {
  const w = 160, h = Math.max(1, Math.round(160 * bmp.height / bmp.width));
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const colMax = new Uint8Array(w), rowMax = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      if (l > colMax[x]) colMax[x] = l;
      if (l > rowMax[y]) rowMax[y] = l;
    }
  }
  let l = 0, r = w - 1, t = 0, b = h - 1;
  while (l < r && colMax[l] <= LUMA_BAR) l++;
  while (r > l && colMax[r] <= LUMA_BAR) r--;
  while (t < b && rowMax[t] <= LUMA_BAR) t++;
  while (b > t && rowMax[b] <= LUMA_BAR) b--;
  const sx = bmp.width / w, sy = bmp.height / h;
  return { x: Math.round(l * sx), y: Math.round(t * sy), w: Math.round((r - l + 1) * sx), h: Math.round((b - t + 1) * sy) };
}

function toB64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

async function makeCover({ videoId, mode, isTopic }) {
  if (!videoId || mode === 'off') return null;
  const bmp = await fetchThumb(videoId);
  if (!bmp) return null;
  let box = { x: 0, y: 0, w: bmp.width, h: bmp.height };
  if (mode !== 'original') {
    const cb = contentBox(bmp);
    // Only trust the trim if something sensible is left (a fully dark thumbnail must not be cut to nothing).
    if (cb.w > bmp.width * 0.2 && cb.h > bmp.height * 0.2) box = cb;
    const ratio = box.w / box.h;
    const nearSquare = ratio > 0.88 && ratio < 1.14;
    if (mode === 'square' || isTopic || nearSquare) {
      const side = Math.min(box.w, box.h);
      box = { x: box.x + Math.round((box.w - side) / 2), y: box.y + Math.round((box.h - side) / 2), w: side, h: side };
    }
  }
  const max = 1200, k = Math.min(1, max / Math.max(box.w, box.h));
  const out = new OffscreenCanvas(Math.round(box.w * k), Math.round(box.h * k));
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
  const blob = await out.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return { b64: toB64(await blob.arrayBuffer()), mime: 'image/jpeg', w: out.width, h: out.height };
}

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg || msg.type !== 'ytdl:cover') return;
  if (!sender || !/^https:\/\/www\.youtube\.com\//.test(sender.url || '')) { send(null); return; }
  makeCover(msg).then(send, () => send(null));
  return true;
});

/* ------------------------------- updates -------------------------------
 * Unpacked extensions can't update themselves, so we check the GitHub
 * Releases of the project once a day (and on demand) and tell the user.
 */
const REPO = 'Archimetrix/Yt-Downloader';
const ALARM = 'ytdl-update-check';

const parseVer = (v) => String(v || '').replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
function isNewer(a, b) { // is a > b
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}

async function fetchLatest() {
  // 1) latest GitHub release (preferred)
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const zip = (j.assets || []).find((a) => /\.zip$/i.test(a.name));
      return { version: String(j.tag_name || j.name || '').replace(/^v/i, ''), url: zip ? zip.browser_download_url : j.html_url, page: j.html_url, notes: String(j.body || '').slice(0, 600) };
    }
  } catch { /* try fallback */ }
  // 2) fallback: manifest.json on the main branch
  const r2 = await fetch(`https://raw.githubusercontent.com/${REPO}/main/manifest.json`, { cache: 'no-store' });
  if (!r2.ok) throw new Error(r2.status === 404 ? 'No release found yet (is the repository public?).' : `GitHub returned ${r2.status}.`);
  const m = await r2.json();
  return { version: String(m.version || ''), url: `https://github.com/${REPO}/releases/latest`, page: `https://github.com/${REPO}`, notes: '' };
}

async function checkForUpdate() {
  const current = chrome.runtime.getManifest().version;
  const prev = (await chrome.storage.local.get('updateInfo')).updateInfo || {};
  try {
    const latest = await fetchLatest();
    if (!latest.version) throw new Error('Could not read the latest version.');
    const available = isNewer(latest.version, current);
    const info = { ...latest, current, available, checkedAt: Date.now(), error: null, skipped: prev.skipped === latest.version ? prev.skipped : null };
    await chrome.storage.local.set({ updateInfo: info });
    await paintBadge(info);
    return info;
  } catch (e) {
    const info = { ...prev, current, checkedAt: Date.now(), error: e.message || 'Update check failed.' };
    await chrome.storage.local.set({ updateInfo: info });
    return info;
  }
}
async function paintBadge(info) {
  const show = info && info.available && info.skipped !== info.version;
  await chrome.action.setBadgeText({ text: show ? 'NEW' : '' });
  if (show) await chrome.action.setBadgeBackgroundColor({ color: '#ff3d57' });
}
async function ensureAlarm() {
  const { autoUpdateCheck = true } = await chrome.storage.sync.get({ autoUpdateCheck: true });
  if (!autoUpdateCheck) return chrome.alarms.clear(ALARM);
  if (!(await chrome.alarms.get(ALARM))) chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
}
chrome.runtime.onInstalled.addListener(async () => { await ensureAlarm(); const { autoUpdateCheck = true } = await chrome.storage.sync.get({ autoUpdateCheck: true }); if (autoUpdateCheck) checkForUpdate(); });
chrome.runtime.onStartup.addListener(async () => { await ensureAlarm(); const { updateInfo } = await chrome.storage.local.get('updateInfo'); if (!updateInfo || Date.now() - (updateInfo.checkedAt || 0) > 20 * 36e5) checkForUpdate(); else paintBadge(updateInfo); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) checkForUpdate(); });
chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && c.autoUpdateCheck) ensureAlarm(); if (area === 'local' && c.updateInfo) paintBadge(c.updateInfo.newValue); });
chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg && msg.type === 'ytdl:check-update') { checkForUpdate().then(send); return true; }
  if (msg && msg.type === 'ytdl:skip-update') {
    chrome.storage.local.get('updateInfo').then(async ({ updateInfo }) => { if (updateInfo) { updateInfo.skipped = updateInfo.version; await chrome.storage.local.set({ updateInfo }); } send(true); });
    return true;
  }
});


/* ------------------------------ star gate ------------------------------
 * Free users get FREE_LIMIT downloads. After that the page asks for a one-time
 * GitHub star, verified with the GitHub App's Device Flow (no client secret
 * needed). The access token is used once to ask "does this user star the repo?",
 * is thrown away right after, and only a "verified" flag is kept. Never re-checked.
 *
 * Polling is driven by the page (one message per poll) so this service worker can
 * sleep between polls without losing the flow. Flow state lives in storage.
 */
const GH = {
  clientId: 'Iv23lixBs8Rjj3AII6C2', // GitHub App > General > Client ID
  owner: 'Archimetrix',
  repo: 'Yt-Downloader',
};
const GH_FORM = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
const form = (o) => new URLSearchParams(o).toString();

let gateChain = Promise.resolve(); // run gate operations one at a time (no double polling)
const serial = (fn) => { const run = gateChain.then(fn, fn); gateChain = run.catch(() => {}); return run; };

async function markVerified(login) {
  await chrome.storage.local.set({ gate: { verified: true, login: login || '', at: Date.now() } });
  try { await chrome.storage.sync.set({ gateVerified: true }); } catch { /* sync unavailable: local flag is enough */ }
  await chrome.storage.local.remove(['ghFlow', 'ghTmp']); // token is gone for good
}

async function ghStarStatus(token) {
  const r = await fetch(`https://api.github.com/user/starred/${GH.owner}/${GH.repo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    cache: 'no-store',
  });
  if (r.status === 204) return { s: 'starred' };
  if (r.status === 404) return { s: 'not_starred' };
  if (r.status === 401) return { s: 'reauth' };
  return { s: 'error', status: r.status };
}

async function checkWithToken(token) {
  let res;
  try { res = await ghStarStatus(token); }
  catch { return { state: 'error', message: 'Couldn’t reach GitHub. Check your connection and try again.' }; }
  if (res.s === 'starred') {
    let login = '';
    try {
      const u = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
      if (u.ok) login = (await u.json()).login || '';
    } catch { /* optional */ }
    await markVerified(login);
    return { state: 'starred' };
  }
  if (res.s === 'not_starred') { await chrome.storage.local.set({ ghTmp: { token } }); return { state: 'not_starred' }; }
  if (res.s === 'reauth') { await chrome.storage.local.remove('ghTmp'); return { state: 'reauth' }; }
  return { state: 'error', message: `GitHub returned an unexpected answer (${res.status}). Please try again in a moment.` };
}

async function gateStart() {
  let j;
  try {
    const r = await fetch('https://github.com/login/device/code', { method: 'POST', headers: GH_FORM, body: form({ client_id: GH.clientId }) });
    j = await r.json();
  } catch { return { error: 'Couldn’t reach GitHub. Check your connection and try again.' }; }
  if (!j || !j.device_code) return { error: (j && (j.error_description || j.error)) || 'GitHub didn’t return a code.' };
  const interval = Math.max(5, Number(j.interval) || 5);
  await chrome.storage.local.set({ ghFlow: { deviceCode: j.device_code, interval, expiresAt: Date.now() + (Number(j.expires_in) || 900) * 1000, nextPollAt: Date.now() + interval * 1000 } });
  await chrome.storage.local.remove('ghTmp');
  return { userCode: j.user_code, verificationUri: j.verification_uri, interval };
}

async function gatePoll() {
  const { ghFlow: f } = await chrome.storage.local.get('ghFlow');
  if (!f) return { state: 'expired' };
  const now = Date.now();
  if (now > f.expiresAt) { await chrome.storage.local.remove('ghFlow'); return { state: 'expired' }; }
  if (now < f.nextPollAt) return { state: 'pending', interval: f.interval }; // too early, GitHub would say slow_down
  f.nextPollAt = now + f.interval * 1000;
  await chrome.storage.local.set({ ghFlow: f });
  let j;
  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: GH_FORM,
      body: form({ client_id: GH.clientId, device_code: f.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    j = await r.json();
  } catch { return { state: 'pending', interval: f.interval }; } // network blip: keep waiting
  if (j.access_token) { await chrome.storage.local.remove('ghFlow'); return checkWithToken(j.access_token); }
  switch (j.error) {
    case 'authorization_pending': return { state: 'pending', interval: f.interval };
    case 'slow_down':
      f.interval = Number(j.interval) || f.interval + 5; f.nextPollAt = Date.now() + f.interval * 1000;
      await chrome.storage.local.set({ ghFlow: f });
      return { state: 'pending', interval: f.interval };
    case 'expired_token': await chrome.storage.local.remove('ghFlow'); return { state: 'expired' };
    case 'access_denied': await chrome.storage.local.remove('ghFlow'); return { state: 'denied' };
    default: return { state: 'error', message: j.error_description || j.error || 'GitHub verification failed.' };
  }
}

async function gateRetry() {
  const { ghTmp } = await chrome.storage.local.get('ghTmp');
  if (!ghTmp || !ghTmp.token) return { state: 'reauth' };
  return checkWithToken(ghTmp.token);
}

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  const run = { 'ytdl:gate-start': gateStart, 'ytdl:gate-poll': gatePoll, 'ytdl:gate-retry': gateRetry }[msg && msg.type];
  if (!run) return;
  serial(run).then(send, () => send({ state: 'error', error: 'Something went wrong. Please try again.', message: 'Something went wrong. Please try again.' }));
  return true;
});
