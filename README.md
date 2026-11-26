# CutMatch

Drop a song. Get your edit. A mobile web app (PWA) prototype for TikTok editors.

- `index.html`: the whole app in one file (open it in a browser, or host it and "Add to Home Screen")
- `manifest.webmanifest`, `sw.js`, `icon-*.png`: home-screen install and offline support when hosted
- `prototype-v1.html`: the earlier prototype

## Put it on your iPhone home screen
1. Host the repo with GitHub Pages (Settings → Pages → deploy from branch `main`, folder `/`).
2. Open the Pages URL in Safari → Share → Add to Home Screen.

Song search and 30-second previews use Apple's public iTunes Search API. Matching works offline with the
built-in library; adding a Claude API key in Settings turns on AI matches. Pro is simulated (no real payments).
