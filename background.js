/*
 * YT DOWNLOADER - background
 * Copyright 2026 Archimetrix
 * Licensed under the Apache License, Version 2.0
 *
 * Only job: put finished files into the folder (inside Downloads) the user chose.
 * Downloads themselves run inside the YouTube tab.
 */
'use strict';

function cleanName(s) {
  return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80);
}
// Chrome only allows folders inside the Downloads directory: no absolute paths, no parent (..) segments.
function cleanPath(p) {
  return String(p || '').split(/[\\/]+/).map(cleanName).filter((x) => x && x !== '..').join('/');
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // Only touch files our page saved (blob: URLs from youtube.com); leave every other download alone.
  if (typeof item.url !== 'string' || !item.url.startsWith('blob:https://www.youtube.com')) return;
  chrome.storage.sync.get({ baseFolder: '' }).then(({ baseFolder }) => {
    const dir = cleanPath(baseFolder);
    const base = (item.filename || '').split(/[\\/]/).pop() || 'video';
    suggest({ filename: dir ? `${dir}/${base}` : base, conflictAction: 'uniquify' });
  }).catch(() => suggest());
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
