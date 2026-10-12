// Offline tests: a fake fetch stands in for the API, nothing leaves the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  TranscriptOut,
  TranscriptOutAuthError,
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptVideoUnavailableError,
} from '../dist/esm/index.js';

const VID = 'dQw4w9WgXcQ';
const LANGS = [
  { code: 'de', kind: 'auto', name: 'German (auto-generated)' },
  { code: 'es', kind: 'manual', name: 'Spanish' },
];

const ok = (data, status = 200) => ({ status, body: { ok: true, request_id: 'req_1', data } });
const err = (status, code, detail) => ({ status, body: { ok: false, code, detail, request_id: 'req_2' } });
const track = (language = 'en', kind = 'manual') => ({
  video_id: VID, language, kind,
  transcript: [{ text: 'hello', start: 0, duration: 1.5 }, { text: 'world', start: 1.5, duration: 2.25 }],
});

/** Answers by "METHOD path" from a queue and records every call. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname}`;
    calls.push({ key, query: Object.fromEntries(u.searchParams), headers: init.headers, body: init.body && JSON.parse(init.body) });
    const queue = routes[key];
    if (!queue) throw new Error(`unexpected ${key}`);
    const r = queue.length > 1 ? queue.shift() : queue[0];
    return {
      status: r.status, ok: r.status >= 200 && r.status < 300, statusText: 'x',
      headers: { get: (h) => (r.headers ?? {})[h] ?? null },
      json: async () => r.body,
    };
  };
  return { fn, calls };
}

test('fetchTranscript returns the youtube-transcript shape in milliseconds', async () => {
  const f = fakeFetch({ 'GET /v1/transcript': [ok(track())] });
  const items = await YoutubeTranscript.fetchTranscript(VID, { lang: 'en', apiKey: 'sk_test', fetch: f.fn });
  assert.deepEqual(items[1], { text: 'world', duration: 2250, offset: 1500, lang: 'en' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers.Authorization, 'Bearer sk_test');
  assert.deepEqual(f.calls[0].query, { video: VID, lang: 'en', format: 'json' });
});

test('units: s gives seconds', async () => {
  const f = fakeFetch({ 'GET /v1/transcript': [ok(track())] });
  const items = await YoutubeTranscript.fetchTranscript(VID, { apiKey: 'k', fetch: f.fn, units: 's' });
  assert.equal(items[1].offset, 1.5);
});

test('no language falls back to the first track, manual first', async () => {
  const f = fakeFetch({
    'GET /v1/transcript': [err(404, 'not_found', 'No subtitles for requested language'), ok(track('es'))],
    'GET /v1/video': [ok({ video_id: VID, available_langs: LANGS })],
  });
  const items = await YoutubeTranscript.fetchTranscript(VID, { apiKey: 'k', fetch: f.fn });
  assert.equal(items[0].lang, 'es');
  assert.deepEqual(f.calls.map((c) => c.key), ['GET /v1/transcript', 'GET /v1/video', 'GET /v1/transcript']);
  assert.equal(f.calls[2].query.kind, 'manual');
});

test('a named language that is missing raises NotAvailableLanguageError', async () => {
  const f = fakeFetch({ 'GET /v1/transcript': [err(404, 'not_found', 'No subtitles for requested language')] });
  await assert.rejects(YoutubeTranscript.fetchTranscript(VID, { lang: 'fr', apiKey: 'k', fetch: f.fn }),
    YoutubeTranscriptNotAvailableLanguageError);
});

test('error codes map to youtube-transcript errors', async () => {
  let f = fakeFetch({ 'GET /v1/transcript': [err(404, 'not_found', 'No subtitles for this video')] });
  await assert.rejects(YoutubeTranscript.fetchTranscript(VID, { lang: 'en', apiKey: 'k', fetch: f.fn }), YoutubeTranscriptDisabledError);
  f = fakeFetch({ 'GET /v1/transcript': [err(410, 'gone', 'Video unavailable/removed')] });
  await assert.rejects(YoutubeTranscript.fetchTranscript(VID, { lang: 'en', apiKey: 'k', fetch: f.fn }), YoutubeTranscriptVideoUnavailableError);
});

test('a missing key fails before any request', async () => {
  const saved = process.env.TRANSCRIPTOUT_API_KEY;
  delete process.env.TRANSCRIPTOUT_API_KEY;
  const f = fakeFetch({});
  await assert.rejects(YoutubeTranscript.fetchTranscript(VID, { fetch: f.fn }), TranscriptOutAuthError);
  assert.equal(f.calls.length, 0);
  if (saved) process.env.TRANSCRIPTOUT_API_KEY = saved;
});

test('fetchMany runs one job and collects every page', async () => {
  const bad = { status: 'error', video_id: 'xxxxxxxxxxx', code: 'gone', detail: 'Video unavailable/removed' };
  const f = fakeFetch({
    'POST /v1/transcripts': [ok({ job_id: 'j1', status: 'queued' }, 202)],
    'GET /v1/transcripts/j1': [ok({ status: 'running' }), ok({ status: 'done' })],
    'GET /v1/transcripts/j1/results': [
      ok({ results: [{ status: 'ready', cache: 'HIT', ...track() }], has_more: true, next_page_token: 't2' }),
      ok({ results: [bad], has_more: false }),
    ],
  });
  const client = new TranscriptOut({ apiKey: 'sk_test', fetch: f.fn });
  const r = await client.fetchMany([VID, 'xxxxxxxxxxx', VID], { pollIntervalMs: 0 });
  assert.deepEqual(Object.keys(r.transcripts), [VID]);
  assert.ok(r.errors.xxxxxxxxxxx instanceof YoutubeTranscriptVideoUnavailableError);
  assert.deepEqual(f.calls[0].body.videos, [VID, 'xxxxxxxxxxx']);
  assert.ok(f.calls[0].headers['Idempotency-Key']);
  assert.equal(f.calls.at(-1).query.next_page_token, 't2');
});

test('the CommonJS build loads', () => {
  const require = createRequire(import.meta.url);
  const cjs = require('../dist/cjs/index.cjs');
  assert.equal(typeof cjs.YoutubeTranscript.fetchTranscript, 'function');
});
