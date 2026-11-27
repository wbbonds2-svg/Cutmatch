#!/usr/bin/env node
// Weekly trending-sounds feed for CutMatch.
//
// 1. Asks Grok (xAI Responses API + X Search) which songs editors posted with on X in the last 7 days.
// 2. Checks every song against Apple's catalog, so made-up or misspelled songs are dropped,
//    and attaches artwork + a 30-second preview.
// 3. Writes trending.json at the repo root. The app's Trending page loads it automatically.
//
// Usage:
//   XAI_API_KEY=... node tools/trending/fetch-trending.mjs
//   node tools/trending/fetch-trending.mjs --fixture tools/trending/sample-grok-response.json   (no key, for testing)
//
// Needs Node 18+ (built-in fetch). No npm packages.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'trending.json');
const MODEL = process.env.XAI_MODEL || 'grok-4.7';
const MIN_SOUNDS = 8;        // fewer verified sounds than this = keep last week's file
const MAX_SOUNDS = 24;

const MOODS = ['hype', 'aggressive', 'dark', 'sad', 'chill', 'smooth', 'triumphant', 'nostalgic'];
const LANES = ['sports', 'anime', 'movies'];

const args = process.argv.slice(2);
const fixture = args.includes('--fixture') ? args[args.indexOf('--fixture') + 1] : null;

const day = d => d.toISOString().slice(0, 10);
const now = new Date();
const fromDate = day(new Date(now.getTime() - 7 * 864e5));
const toDate = day(new Date(now.getTime() + 864e5)); // to_date is exclusive, so include today

const norm = s => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]|feat\..*$/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const PROMPT = `You help run CutMatch, an app for TikTok fan editors (sports edits first, also anime and movie/TV edits).
Use X search to find which SONGS / AUDIOS editors are actually using for edits right now, based on X posts from ${fromDate} to today.
Look for posts sharing or talking about sports edits, anime edits, movie edits, "edit audio", "audio for edits", velocity edits, phonk edits, and posts asking "what's the song in this edit".
Rules:
- Only real, released songs with a clear title and main artist. No sped-up/slowed versions as separate entries; use the original song.
- Rank by how much editors are using it this week. Mark "hot" if it is clearly everywhere, "rising" if it is picking up fast.
- "why" = one short line (max 14 words) about why editors like it or what edits it's used for. Plain words, no hashtags, no emoji.
- "moods": 1-3 from ${MOODS.join(', ')}. "tempo": slow, mid or fast (feel, not exact BPM). "lanes": which of ${LANES.join(', ')} it's being used for.
- "evidence": up to 3 URLs of X posts you saw it in.
- Content must be fine for teens: skip songs whose main draw is explicit content.
Return 20 to 25 songs.`;

const SCHEMA = {
  type: 'object',
  properties: {
    sounds: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          artist: { type: 'string' },
          tag: { type: 'string', enum: ['hot', 'rising'] },
          why: { type: 'string' },
          moods: { type: 'array', items: { type: 'string', enum: MOODS } },
          tempo: { type: 'string', enum: ['slow', 'mid', 'fast'] },
          lanes: { type: 'array', items: { type: 'string', enum: LANES } },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'artist', 'tag', 'why', 'moods', 'tempo', 'lanes', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['sounds'],
  additionalProperties: false,
};

async function askGrok() {
  if (fixture) return JSON.parse(await readFile(path.resolve(fixture), 'utf8'));
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error('XAI_API_KEY is not set. Add it as a GitHub secret (see tools/trending/README.md).');
  const res = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: 'user', content: PROMPT }],
      tools: [{ type: 'x_search', from_date: fromDate, to_date: toDate }],
      text: { format: { type: 'json_schema', name: 'trending_sounds', schema: SCHEMA } },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`xAI API error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

function extract(resp) {
  // Responses API: output[] holds tool calls and a final message whose content has output_text.
  const texts = [];
  for (const item of resp.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) if (c.type === 'output_text' && c.text) texts.push(c.text);
  }
  const text = texts.join('\n') || resp.output_text || '';
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return { sounds: Array.isArray(json.sounds) ? json.sounds : [], citations: resp.citations || [], usage: resp.usage || null };
}

async function candidates(s) {
  const term = encodeURIComponent(`${s.title} ${s.artist}`);
  const get = async u => { try { const r = await fetch(u, { signal: AbortSignal.timeout(15_000) }); return r.ok ? r.json() : {}; } catch { return {}; } };
  // Same Apple request the app uses. Never add media=music: Apple redirects iPhones to the Music app with it.
  const [it, dz] = await Promise.all([
    get(`https://itunes.apple.com/search?term=${term}&entity=song&limit=25&country=US`),
    get(`https://api.deezer.com/search?q=${term}&limit=25`),
  ]);
  return [
    ...(it.results || []).map(x => ({ t: x.trackName, a: x.artistName, art: (x.artworkUrl100 || '').replace('100x100bb', '300x300bb'), preview: x.previewUrl || '', genre: x.primaryGenreName || '' })),
    ...(dz.data || []).map(x => ({ t: x.title, a: (x.artist && x.artist.name) || '', art: (x.album && x.album.cover_medium) || '', preview: x.preview || '', genre: '' })),
  ].filter(x => x.t && x.a);
}

async function verify(s) {
  const t = norm(s.title), a = norm(s.artist).split(' ')[0];
  const VERSION = /remix|sped|slowed|reverb|live|instrumental|acoustic|karaoke|version|edit\b|mix\b|cover/i;
  const wantsVersion = VERSION.test(s.title);
  // Exact title + right artist wins. Remixes, sped-up, live and cover versions lose unless Grok named that version.
  // A different artist is treated as a copycat upload and rejected.
  const score = x => {
    const xt = norm(x.t);
    let p = 0;
    if (xt === t) p += 4; else if (xt.startsWith(t)) p += 2; else return -1;
    if (!norm(x.a).includes(a)) return -1;
    p += 3;
    if (!wantsVersion && VERSION.test(x.t)) p -= 3;
    if (/&|,/.test(x.a) && !/&|,/.test(s.artist)) p -= 1;
    if (x.preview) p += 0.5;
    return p;
  };
  const ranked = (await candidates(s)).map(x => [score(x), x]).filter(([p]) => p >= 4).sort((p, q) => q[0] - p[0]);
  if (!ranked.length) return null;
  const hit = ranked[0][1];
  // Borrow artwork / preview / genre from another matching result when the best one lacks them.
  const same = ranked.map(r => r[1]).filter(x => norm(x.t) === norm(hit.t));
  return {
    t: hit.t.replace(/\s*\((feat|with)\.?[^)]*\)/i, ''),
    a: hit.a,
    art: hit.art || (same.find(x => x.art) || {}).art || '',
    preview: hit.preview || (same.find(x => x.preview) || {}).preview || '',
    genre: (same.find(x => x.genre) || {}).genre || '',
  };
}

const clean = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);

async function main() {
  console.log(`Searching X posts ${fromDate} → today with ${fixture ? 'FIXTURE' : MODEL}…`);
  const { sounds, citations, usage } = extract(await askGrok());
  console.log(`Grok suggested ${sounds.length} sounds. Checking each against Apple Music and Deezer…`);

  const seen = new Set(), out = [], dropped = [];
  for (const s of sounds) {
    if (out.length >= MAX_SOUNDS) break;
    const k = norm(s.title) + '|' + norm(s.artist);
    if (!s.title || !s.artist || seen.has(k)) continue;
    seen.add(k);
    const v = await verify(s);
    if (!v) { dropped.push(`${s.title} - ${s.artist}`); continue; }
    const moods = [...new Set((s.moods || []).filter(m => MOODS.includes(m)))].slice(0, 3);
    out.push({
      ...v,
      tag: s.tag === 'hot' ? 'hot' : 'rising',
      why: clean(s.why, 110),
      m: moods.length ? moods : ['hype'],
      tempo: ['slow', 'mid', 'fast'].includes(s.tempo) ? s.tempo : 'mid',
      lanes: (s.lanes || []).filter(l => LANES.includes(l)),
      evidence: (s.evidence || []).filter(u => /^https:\/\/(x|twitter)\.com\//.test(u)).slice(0, 3),
    });
  }
  if (dropped.length) console.log(`Dropped ${dropped.length} not found in Apple Music or Deezer: ${dropped.join('; ')}`);

  if (out.length < MIN_SOUNDS) {
    console.error(`Only ${out.length} verified sounds (need ${MIN_SOUNDS}). Keeping last week's trending.json.`);
    process.exit(existsSync(OUT) ? 0 : 1);
  }

  const feed = {
    updated: now.toISOString(),
    window: { from: fromDate, to: day(now) },
    source: fixture ? 'fixture' : `grok:${MODEL}+x_search`,
    sounds: out,
    citations: citations.slice(0, 50),
  };
  await writeFile(OUT, JSON.stringify(feed, null, 2) + '\n');
  console.log(`Wrote ${out.length} sounds to trending.json${usage ? ` (usage: ${JSON.stringify(usage)})` : ''}`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
