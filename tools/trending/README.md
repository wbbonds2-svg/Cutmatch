# Weekly trending sounds (Grok + X)

Every Monday a GitHub Action asks Grok (xAI) to search the last 7 days of X posts for the songs
editors are using. Each song is checked against Apple Music and Deezer (made-up or misspelled songs
are dropped, and original versions win over remixes), then saved to `trending.json`. The app's
Trending page loads that file; if it's missing or more than 3 weeks old, the built-in picks show instead.

## One-time setup
1. Get an API key at https://console.x.ai → API Keys.
2. In GitHub: repo **Settings → Secrets and variables → Actions → New repository secret**.
   Name: `XAI_API_KEY`, value: your key.
3. Make sure this workflow is on the `main` branch (scheduled workflows only run from the default branch).
4. **Actions → Weekly trending sounds → Run workflow** to fill the first week right away.

The key stays in GitHub's secret store. It is never in the app or the repo.

## Cost
Grok 4.7 tokens plus X Search ($5 per 1,000 posts fetched). Expect roughly $1–2 per weekly run.
Set a monthly spending limit in the xAI console to be safe.

## Run it yourself
```
XAI_API_KEY=... node tools/trending/fetch-trending.mjs
node tools/trending/fetch-trending.mjs --fixture tools/trending/sample-grok-response.json   # test without a key
```
`sample-grok-response.json` is fake test data, not real trending sounds.
