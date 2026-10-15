# transcriptout

`youtube-transcript` works locally and breaks on servers, because YouTube blocks cloud IP ranges. `transcriptout` keeps the same interface and fetches through [TranscriptOut](https://transcriptout.com/?utm_source=transcriptout-js&utm_medium=readme), so there are no proxies to run and nothing to block on your side.

Migration is one line.

```js
// import { YoutubeTranscript } from 'youtube-transcript';
import { YoutubeTranscript } from 'transcriptout';

const items = await YoutubeTranscript.fetchTranscript('dQw4w9WgXcQ', { lang: 'en' });
// [{ text, offset, duration, lang }, ...]
```

## Install

```bash
npm install transcriptout
```

Node 18 or newer, or any runtime with `fetch`.

## API key

Sign in at [transcriptout.com](https://transcriptout.com/?utm_source=transcriptout-js&utm_medium=readme) and create a key on the [Keys](https://transcriptout.com/keys?utm_source=transcriptout-js&utm_medium=readme) page. It starts with `sk_`. New accounts start with free credits, no card.

The package reads the key from the `TRANSCRIPTOUT_API_KEY` environment variable, so your code stays the same as with youtube-transcript. Set it in the terminal you run your code from.

```bash
# macOS and Linux
export TRANSCRIPTOUT_API_KEY=sk_your_key

# Windows PowerShell
$env:TRANSCRIPTOUT_API_KEY="sk_your_key"
```

That lasts until the terminal is closed. For a project, put the line `TRANSCRIPTOUT_API_KEY=sk_your_key` in a `.env` file and run `node --env-file=.env app.js` (Node 20.6 or newer) or load it with `dotenv`. On a server, add the variable in your host's settings (Vercel, Render, Fly, Docker and so on).

Or pass the key in code.

```js
const items = await YoutubeTranscript.fetchTranscript('dQw4w9WgXcQ', { lang: 'en', apiKey: 'sk_your_key' });
const client = new TranscriptOut({ apiKey: 'sk_your_key' });
```

Keep the key out of git. An error saying `No API key` means the variable is not set in the process that runs your code.

## What stays the same

- `YoutubeTranscript.fetchTranscript(videoId, { lang })` and the standalone `fetchTranscript`
- The result shape `{ text, offset, duration, lang }`, with times in milliseconds like youtube-transcript 1.3. Pass `units: 's'` for seconds.
- Error classes `YoutubeTranscriptDisabledError`, `YoutubeTranscriptNotAvailableLanguageError`, `YoutubeTranscriptVideoUnavailableError`, `YoutubeTranscriptTooManyRequestError` and the rest
- Video URLs and ids are both accepted

## What is new

Many videos in one call, up to 4,000 per job, with retries handled on our side.

```js
import { TranscriptOut } from 'transcriptout';

const client = new TranscriptOut();   // reads TRANSCRIPTOUT_API_KEY
const { transcripts, errors } = await client.fetchMany(videoIds, { lang: 'en' });
```

## Reference

Everything the package exports, in one place.

### Functions and classes

| Call | Returns | What it does | Cost |
| --- | --- | --- | --- |
| `YoutubeTranscript.fetchTranscript(videoId, config?)` | `TranscriptResponse[]` | One video's transcript, the youtube-transcript entry point | 1 credit. Without `lang`, a video with no English track takes extra calls to list the tracks and fetch the first |
| `fetchTranscript(videoId, config?)` | `TranscriptResponse[]` | The same as a standalone function | as above |
| `new TranscriptOut(config?)` | client | Holds the key and options for repeated calls | free |
| `client.fetchTranscript(videoId, lang?)` | `TranscriptResponse[]` | One video's transcript | as above |
| `client.fetchMany(videoIds, options?)` | `FetchManyResult` | Many videos through one batch job, up to 4,000 per job. Longer lists run as several jobs | 1 credit per video |

A video id or a full YouTube URL works everywhere a `videoId` is asked for.

### `config`

| Option | Default | What it does |
| --- | --- | --- |
| `lang` | English, then the first track | Language code, for example `'de'`. Only for `fetchTranscript` |
| `apiKey` | `TRANSCRIPTOUT_API_KEY` | Your `sk_` key |
| `units` | `'ms'` | `'ms'` or `'s'` for `offset` and `duration` |
| `maxRetries` | `3` | Retries on 429 and 503, honouring `Retry-After`. Those are not charged |
| `fetch` | `globalThis.fetch` | Your own `fetch`, for older runtimes or tests |

### `fetchMany` options

| Option | Default | What it does |
| --- | --- | --- |
| `lang` | `'en'` | One language for the whole job |
| `kind` | manual, else auto | `'manual'` or `'auto'` |
| `pollIntervalMs` | `3000` | How often the job status is checked |
| `onProgress` | none | Called with the job status after every check |

### What comes back

| Type | Fields |
| --- | --- |
| `TranscriptResponse` | `text`, `offset`, `duration`, `lang` |
| `FetchManyResult` | `transcripts` (id to `TranscriptResponse[]`), `errors` (id to error), `jobIds` |

### Errors

The youtube-transcript error classes keep their names, all subclasses of `YoutubeTranscriptError`.

| Error | When |
| --- | --- |
| `YoutubeTranscriptDisabledError` | The video has no subtitles at all |
| `YoutubeTranscriptNotAvailableError` | No track for this request |
| `YoutubeTranscriptNotAvailableLanguageError` | No track in the language asked for |
| `YoutubeTranscriptVideoUnavailableError` | The video is gone or age restricted |
| `YoutubeTranscriptTooManyRequestError` | Too many requests per minute, still refused after retries |
| `TranscriptOutAuthError` | No key, or the key was rejected |
| `TranscriptOutInsufficientCreditsError` | The account has no credits left |
| `TranscriptOutError` | Any other refusal. Carries `status`, `code` and `requestId` |

## What differs

- Auto-generated tracks come grouped into readable segments of up to 180 characters rather than YouTube's short caption lines.
- Without `lang`, the English track is tried first, then the video's first track.

## Pricing

One credit per transcript. Requests refused for reasons on our side are refunded. See [pricing](https://transcriptout.com/?utm_source=transcriptout-js&utm_medium=readme#pricing).

## License

MIT
