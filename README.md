# transcriptout

`youtube-transcript` works locally and breaks on servers, because YouTube blocks cloud IP ranges. `transcriptout` keeps the same interface and fetches through [TranscriptOut](https://transcriptout.com), so there are no proxies to run and nothing to block on your side.

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
export TRANSCRIPTOUT_API_KEY=sk_...
```

Get a free key at [transcriptout.com](https://transcriptout.com). New accounts start with free credits, no card. Node 18 or newer, or any runtime with `fetch`.

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

## What differs

- Auto-generated tracks come grouped into readable segments of up to 180 characters rather than YouTube's short caption lines.
- Without `lang`, the English track is tried first, then the video's first track.

## Pricing

One credit per transcript. Requests refused for reasons on our side are refunded. See [pricing](https://transcriptout.com/#pricing).

## License

MIT
