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
```

Node 18 or newer, or any runtime with `fetch`.

## API key

Sign in at [transcriptout.com](https://transcriptout.com) and create a key on the [Keys](https://transcriptout.com/keys) page. It starts with `sk_`. New accounts start with free credits, no card.

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

## What differs

- Auto-generated tracks come grouped into readable segments of up to 180 characters rather than YouTube's short caption lines.
- Without `lang`, the English track is tried first, then the video's first track.

## Pricing

One credit per transcript. Requests refused for reasons on our side are refunded. See [pricing](https://transcriptout.com/#pricing).

## License

MIT
