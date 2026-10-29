<div align="center">

<img src="icons/store-512.png" alt="YT DOWNLOADER logo" width="140">

# YT DOWNLOADER

**Download YouTube videos and audio in MP4, WebM, MKV or M4A, at any quality, right from the player.**

![Extension version](https://img.shields.io/badge/version-1.1.1-ff3d57?style=for-the-badge)
![Manifest](https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Chrome](https://img.shields.io/badge/Chrome-111%2B-34A853?style=for-the-badge&logo=googlechrome&logoColor=white)
![Chromium](https://img.shields.io/badge/Chromium--based-supported-FF8A3D?style=for-the-badge)
![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge)

[Install](#-installation) · [Features](#-features) · [Formats](#-formats--quality) · [Updates](#-updates) · [Troubleshooting](#-troubleshooting) · [Support](#-support-the-project)

</div>

---

## At a glance

| | |
|---|---|
| **Extension name** | YT DOWNLOADER |
| **Extension version** | `1.1.1` |
| **Manifest version** | `3` (MV3) |
| **Browsers** | Google Chrome 111 or newer, and other Chromium-based browsers with MV3 support (Edge, Brave, Opera, Vivaldi). Only Chrome is tested. Firefox and Safari are not supported. |
| **Permissions** | `storage`, `downloads`, `alarms` |
| **Runs on** | `https://www.youtube.com/*` |
| **Author** | [Archimetrix](https://github.com/Archimetrix) |
| **License** | Apache License 2.0 |

---
## 📦 Installation

**The extension is installed as an unpacked extension for all chromium browsers like(Chrome,brave,edge,opera,helium,vivaldi etc.).**

1. Download the latest zip from [Releases](https://github.com/Archimetrix/Yt-Downloader/releases) and unzip it into a folder you will keep.
2. Open `chrome://extensions` or just go to your browser extension settings and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder (the one that contains `manifest.json`).
4. Open any `youtube.com/watch` page. The download button appears in the player controls.

**Firefox Browser- get from addon store.**
<p float="left">
  <a href="https://addons.mozilla.org/en-US/firefox/addon/yt_downloader/" target="_blank">
    <img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" alt="Get the Add-on for Firefox" height="56">
  </a>
</p>

## ✨ Features

### Download from the player
- A download button is added to the YouTube player controls on every video page.
- Click it to choose **format and quality** from a menu, or set defaults and download with one click.
- Several downloads can run at once (1 to 4, your choice). Starting a new one never cancels a running one.
- A progress toast in the player has a cancel button, and a counter on the button shows how many downloads are running.

### Choose your format
- **Video:** MP4 (H.264), WebM (VP9 / AV1) or MKV.
- **Audio only:** M4A (AAC) or WebM (Opus).
- The in-player menu has an **MP4 / WebM / MKV** switch and remembers your last choice.
- Every quality row shows the real codec and the file size before you download.

### Queue
- Shows **only active downloads**, each with thumbnail, title, live progress and a cancel button.
- **Cancel all** with one click.
- When a download finishes it leaves the queue and goes to History. Failed downloads stay with the reason until you dismiss them.

### History
- Finished downloads, **grouped by day** (Today, Yesterday, then dates).
- Each entry shows thumbnail, title, quality, format, file size, **time and date**.
- **Search** by title or channel, and filter by **All / Video / Audio**.
- Stays smooth with thousands of entries. Only the rows on screen are drawn, so scrolling never stutters. Keeps up to **5,000** entries.
- Click an entry to reopen the video, remove single entries, clear everything (with a confirm step), or open your downloads folder.

### Settings
- Ask every time, or download straight with your defaults.
- Default type (video or audio), video format, quality (144p up to 4K), and audio format.
- Save into a **sub-folder of Downloads** (for example `Music/YouTube`).
- Number of simultaneous downloads.
- Daily update check on or off.

### Interface
- Modern card-based popup with **light and dark themes** that follow your browser.
- Footer with **Buy me a coffee** and **UPI Support** buttons.

---

## 🎞 Formats & quality

| Option | Container | Codecs | Best for |
|---|---|---|---|
| **MP4** | `.mp4` | H.264 + AAC (AV1 for resolutions where H.264 isn't offered) | Maximum compatibility: phones, TVs, editors |
| **WebM** | `.webm` | VP9 / AV1 + Opus | Smaller files, 1440p and 4K |
| **MKV** | `.mkv` | Any codec above | Keeping the best quality, VLC and most players |
| **M4A** | `.m4a` | AAC | Audio only, most compatible |
| **WebM (Opus)** | `.webm` | Opus | Audio only, best quality |

Notes:
- Available qualities depend on the video. If your chosen quality isn't offered, the closest lower one is used.
- At high resolutions YouTube often doesn't offer H.264, so MP4 may show AV1, or those resolutions may only appear in WebM and MKV. The menu tells you when that happens.
- No conversion is done. Streams are downloaded and joined as they are, so **MP3, WAV and re-encoding are not supported**.

---

## 📦 Installation

The extension is installed as an unpacked extension.

1. Download the latest zip from [Releases](https://github.com/Archimetrix/Yt-Downloader/releases) and unzip it into a folder you will keep.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder (the one that contains `manifest.json`).
4. Open any `youtube.com/watch` page. The download button appears in the player controls.

---

## 🚀 Usage

1. Open a YouTube video and click the download button in the player.
2. Pick **MP4 / WebM / MKV**, then a quality. For audio only, choose M4A or Opus.
3. Watch it in the **Queue** tab. When it finishes, find it in **History**.

> **Keep the YouTube tab open while a download runs.** You can switch to other tabs or apps, but closing or reloading that tab stops the download. If Chrome asks to allow multiple automatic downloads for youtube.com, choose **Allow**.

Very long or 4K videos are joined in memory, so for those use a lower quality or fewer parallel downloads.

---

## 🔄 Updates

Unpacked extensions can't update themselves, so YT DOWNLOADER checks this repository's **GitHub Releases** for you.

- Checks **once a day** in the background, when Chrome starts, and when you press **Check now** in Settings.
- When a newer version exists, the toolbar icon shows a **NEW** badge and the popup shows a banner with a **Download** button. You can **Skip** a version.
- The daily check can be turned off in Settings → Updates.

**To update:**
1. Download the new zip from the banner.
2. Replace the contents of your extension folder with the new files.
3. Open `chrome://extensions` and press the **reload** icon on YT DOWNLOADER.

---

## 🧩 How it works

- `main.js` runs in the page. It learns the playback session from the player's own requests, pulls the chosen tracks with the open-source [`googlevideo`](https://github.com/LuanRT/googlevideo) SABR client, and joins them with [`mediabunny`](https://github.com/Vanilagy/mediabunny).
- The finished file is saved as a normal browser download.
- `content.js` adds the player button, menu and progress toast.
- `background.js` applies your save-folder choice and runs the update checker.
- `popup/` is the Queue, History and Settings interface.

### Project structure
```
manifest.json        extension manifest (MV3)
background.js        save folder + update checker
content.js / .css    player button, menu, toast
main.js              download engine (runs in the page)
popup/               popup UI (html, css, js)
icons/               logo in all required sizes
```

---

## 🛠 Troubleshooting

| Problem | Fix |
|---|---|
| "The player didn't respond" | Reload the YouTube page and try again. |
| "Couldn't read the player session" | Let the video play for a second, then try again. |
| Download stops | Don't close or reload the YouTube tab while it runs. |
| Fails on long or 4K videos | Use a lower quality, or set "At the same time" to 1. |
| Several files blocked by Chrome | Allow automatic downloads for youtube.com when prompted. |
| Quality missing in MP4 | Switch to WebM or MKV. |
| "No release found yet" in Updates | Normal until the repository is public and has a release. |

---

## 🚫 Not supported currently
- Playlist downloading.
- Live streams, and videos YouTube won't play for your account (age, sign-in, region, members-only).
- MP3 or any re-encoding.
- Firefox (may support later ), Safari and non-Chromium browsers.

---

## ☕ Support the project

If this saves you time, you can support its development:

- ☕ [Buy me a coffee](https://buymeacoffee.com/archimetrix)
- 🇮🇳 [UPI Support](https://buymeatea.online/archimetrix)

*Made with ❤️ by Archimetrix.*

---

## ⚖ Legal & disclaimer

> **Important:** YT DOWNLOADER is an **unofficial** project and is **not affiliated with, endorsed by, or sponsored by YouTube or Google**.

- **Personal use only.** Download only content you **own**, that is **public domain or openly licensed**, or that you have **permission** to download.
- **Terms of Service.** Downloading from YouTube may violate YouTube's Terms of Service and copyright or anti-circumvention laws where you live. You are solely responsible for checking what is lawful for you.
- **Use at your own risk.** The software is provided **"as is", without warranty of any kind**. The author and contributors are **not liable** for any misuse, copyright claim, account action, loss, or damage arising from its use.
- **No data collection.** Settings and history stay in your browser. The extension only contacts YouTube, `i.ytimg.com`, and GitHub (update check, avatar).
- **Not for the Chrome Web Store.** Store policy does not allow YouTube downloaders, so this project is distributed only through GitHub.

Read the full text in [`DISCLAIMER.md`](DISCLAIMER.md). Code is licensed under the Apache License 2.0 (`LICENSE`, `NOTICE`); third-party libraries keep their own licenses (`THIRD_PARTY_NOTICES.md`).

## What's new in 1.2.0

- **Cover art for audio downloads** (Settings > Cover art): the thumbnail is embedded in the file together with the song title and artist.
  *Auto* detects real songs (square album art inside a black 16:9 frame) and saves a clean square cover. Normal videos keep their wide thumbnail. Other choices: always square, original thumbnail, or none. M4A is the most compatible; Opus (WebM) files also carry the cover, but some players ignore it.
- **Save folders**: type a folder name in Settings; use `/` for sub-folders, e.g. `YouTube/Videos` and `YouTube/Audios`. Missing folders are created inside Downloads.

## What's new in 1.4.0

- **YouTube only.** YouTube Music (music.youtube.com) support was removed. The extension now runs on www.youtube.com only.
- **Cleaner settings.** Settings are grouped into Download button, Video, Audio, Save to and More, with one row per option.
- **Quieter free downloads.** The "free downloads left" messages are gone; you just see "Saved: ...".
