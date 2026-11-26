/**
 * YT DOWNLOADER — updater.js
 * Full-tab page for the parts of "Smoother Updates Process" that need a user
 * gesture: picking the extension folder (once) and re-allowing write access.
 */
'use strict';

(() => {
  const S = YtdlSmoothUpdate;
  const view = document.getElementById('view');
  const logEl = document.getElementById('log');
  const params = new URLSearchParams(location.search);
  const current = chrome.runtime.getManifest().version;
  document.getElementById('ver').textContent = `YT DOWNLOADER · v${current}`;

  let autoTried = false;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function log(msg, cls = '') { logEl.className = `show ${cls}`.trim(); logEl.textContent = msg; }
  const getUpdate = async () => (await chrome.storage.local.get('updateInfo')).updateInfo || null;
  const hasPkg = (i) => !!(i && i.available && i.zipUrl);
  const busyDownloading = async () => { const { dlJobs = [] } = await chrome.storage.local.get('dlJobs'); return dlJobs.some((x) => x && x.status === 'running' && Date.now() - (x.ts || 0) < 20000); };
  const getEnabled = async () => (await chrome.storage.local.get({ smoothUpdatesEnabled: true })).smoothUpdatesEnabled !== false;

  const STEPS = ['Check folder', 'Download', 'Verify', 'Unpack', 'Install'];
  const PHASE_STEP = { check: 0, download: 1, verify: 2, unpack: 3, install: 4, rollback: 4, done: 5 };
  const progEl = document.getElementById('prog');
  const stepsEl = document.getElementById('steps');
  stepsEl.innerHTML = STEPS.map((t) => `<li>${t}</li>`).join('');

  function showProgress(p) {
    progEl.className = p.phase === 'done' ? 'show done' : p.phase === 'rollback' ? 'show fail' : 'show';
    document.getElementById('barFill').style.width = `${p.pct}%`;
    document.getElementById('progPct').textContent = `${p.pct}%`;
    document.getElementById('progText').textContent = p.text;
    const cur = PHASE_STEP[p.phase] ?? 0;
    [...stepsEl.children].forEach((li, i) => { li.className = i < cur ? 'done' : i === cur ? 'active' : ''; });
  }

  async function runUpdate() {
    const info = await getUpdate();
    if (!hasPkg(info)) { log(info && info.available ? 'This release has no ZIP to install automatically. Use the manual download instead.' : 'No update is available right now.'); return; }
    if (await busyDownloading()) { log('A download is still running. Let it finish (or cancel it), then update.', 'error'); return; }
    setBusy(true);
    logEl.className = '';
    showProgress({ phase: 'check', pct: 0, text: 'Starting…' });
    try {
      const r = await S.applyUpdate({
        zipUrl: info.zipUrl, sha256: info.sha256, expectedVersion: info.version, sizeHint: info.zipSize, onProgress: showProgress,
      });
      log(`Updated to v${r.version} (${r.files} files). Reloading the extension — refresh your YouTube tabs afterwards.`, 'ok');
      setTimeout(() => chrome.runtime.reload(), 1200);
    } catch (e) {
      setBusy(false);
      if (progEl.className.indexOf('fail') < 0) progEl.classList.add('fail');
      if (e.code === 'WRONG_FOLDER') { await S.clearHandle(); await render(); }
      log(e.message || String(e), 'error');
    }
  }

  function setBusy(b) { view.querySelectorAll('button').forEach((x) => { x.disabled = b; }); }

  async function pickFolder() {
    let dir;
    try { dir = await showDirectoryPicker({ id: 'yt-downloader', mode: 'readwrite' }); }
    catch (e) { if (e && e.name !== 'AbortError') log(`Couldn't open the folder picker: ${e.message}`, 'error'); return; }
    log('Checking that this is the right folder…');
    if (!(await S.verifyIsLoadedFolder(dir))) {
      log('That isn\'t the folder Chrome loaded YT DOWNLOADER from. Open chrome://extensions, check the path under "Details", and pick that exact folder (the one containing manifest.json).', 'error');
      return;
    }
    await S.saveHandle(dir);
    log(`Folder "${dir.name}" connected.`, 'ok');
    const info = await getUpdate();
    await render();
    if (hasPkg(info)) runUpdate();
  }

  async function allowAccess() {
    const h = await S.getHandle();
    if (!h) return render();
    let p = 'denied';
    try { p = await h.requestPermission({ mode: 'readwrite' }); } catch { /* ignore */ }
    await render();
    if (p !== 'granted') { log('Access was not granted.', 'error'); return; }
    const info = await getUpdate();
    if (hasPkg(info)) runUpdate();
  }

  async function render() {
    const [st, info, enabled] = await Promise.all([S.status(), getUpdate(), getEnabled()]);
    const hasUpdate = hasPkg(info);
    const pill = hasUpdate ? `<span class="pill">v${esc(info.version)} available</span>` : '<span class="pill">Up to date</span>';

    if (typeof window.showDirectoryPicker !== 'function') {
      const isBrave = !!(navigator.brave);
      view.innerHTML = `<span class="pill warn">Not available in this browser setting</span>
        <p>This browser has the folder-access feature (File System Access API) switched off, so one-click updates can't run yet.</p>
        ${isBrave ? `<ol><li>Open <code>brave://flags/#file-system-access-api</code></li><li>Set it to <b>Enabled</b></li><li>Click <b>Relaunch</b>, then reopen this page</li></ol>` : '<p>Use a Chromium browser with this feature enabled (Chrome, Edge), or update manually.</p>'}
        <div class="row">${hasUpdate ? `<button class="primary" id="manual">Download update manually</button>` : ''}</div>`;
      const m = view.querySelector('#manual'); if (m) m.onclick = () => window.open(info.url || info.page, '_blank');
      return;
    }

    if (!enabled) {
      view.innerHTML = `<p>One-click updates are switched off. Turn it on to update with one click instead of downloading and re-loading the extension by hand.</p>
        <div class="row"><button class="primary" id="enable">Turn it on</button></div>`;
      view.querySelector('#enable').onclick = async () => { await chrome.storage.local.set({ smoothUpdatesEnabled: true }); render(); };
      return;
    }

    if (!st.hasFolder) {
      view.innerHTML = `${pill}
        <p>One-time setup: tell YT DOWNLOADER which folder you loaded it from, so it can replace its own files when an update is ready.</p>
        <ol>
          <li>Open <code>chrome://extensions</code> → YT DOWNLOADER → <b>Details</b> to see the folder path.</li>
          <li>Click <b>Choose folder</b> below and pick that exact folder (the one containing <code>manifest.json</code>).</li>
          <li>Click <b>Allow</b> / <b>Edit files</b> when Chrome asks.</li>
        </ol>
        <p class="hint">Browsers refuse system folders like Documents or Downloads themselves, but a subfolder inside them is fine.</p>
        <div class="row"><button class="primary" id="pick">Choose folder${hasUpdate ? ' &amp; update' : ''}</button></div>`;
      view.querySelector('#pick').onclick = pickFolder;
      return;
    }

    if (st.permission !== 'granted') {
      view.innerHTML = `${pill} <span class="pill warn">Access needs re-allowing</span>
        <p>Chrome paused write access to <code>${esc(st.folderName)}</code> (this happens after a browser restart). One click brings it back.</p>
        <p class="hint">If Chrome offers <b>Allow on every visit</b>, choose it to avoid this next time.</p>
        <div class="row"><button class="primary" id="allow">Allow access${hasUpdate ? ' &amp; update' : ''}</button><button id="change">Choose a different folder</button></div>`;
      view.querySelector('#allow').onclick = allowAccess;
      view.querySelector('#change').onclick = pickFolder;
      return;
    }

    view.innerHTML = `${pill} <span class="pill">Folder: ${esc(st.folderName)}</span>
      <p>${hasUpdate ? `YT DOWNLOADER v${esc(info.version)} is ready to install. Your settings are kept.` : 'You\'re all set — future updates will install in one click from the popup.'}</p>
      <div class="row">${hasUpdate ? '<button class="primary" id="go">Install update now</button>' : ''}
        <button id="change">Choose a different folder</button><button id="forget">Disconnect folder</button></div>`;
    const go = view.querySelector('#go'); if (go) go.onclick = runUpdate;
    view.querySelector('#change').onclick = pickFolder;
    view.querySelector('#forget').onclick = async () => { await S.clearHandle(); log('Folder disconnected.'); render(); };

    if (hasUpdate && params.get('auto') === '1' && !autoTried) { autoTried = true; runUpdate(); }
  }

  render();
})();
