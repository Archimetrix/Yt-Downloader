# vendor/mediabunny.js

A tree-shaken browser build of **mediabunny 1.66.3** (https://github.com/Vanilagy/mediabunny, MPL-2.0).
It is loaded as a content script right before `main.js` (see `manifest.json`), hands its classes to
`main.js` through a temporary global (`__ytdlMediabunny`, deleted immediately), and is otherwise unmodified.
The MPL-2.0 notice is preserved at the end of the file.

SHA-256: `8636401bba5416fc2c26e842cd217a6eacacd5e4e7600f94417bd40da310d4a7`

## Rebuild (to verify, or to update MediaBunny)

```
npm i mediabunny@1.66.3 esbuild
```

`entry.js`:
```js
import { Output, Mp4OutputFormat, MkvOutputFormat, WebMOutputFormat, BufferTarget,
  Input, ALL_FORMATS, BlobSource,
  EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacketSink } from 'mediabunny';
globalThis.__ytdlMediabunny = { Output, Mp4OutputFormat, MkvOutputFormat, WebMOutputFormat, BufferTarget,
  Input, ALL_FORMATS, BlobSource, EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacketSink };
```

```
npx esbuild entry.js --bundle --minify --format=iife --target=chrome111 --legal-comments=eof --outfile=vendor/mediabunny.js
```

To move to a newer MediaBunny, change the version in the first command and rebuild; `main.js` only uses the classes listed above.
