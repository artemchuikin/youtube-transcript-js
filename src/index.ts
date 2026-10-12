/**
 * transcriptout: the youtube-transcript interface, served by TranscriptOut.
 *
 *   // import { YoutubeTranscript } from 'youtube-transcript';
 *   import { YoutubeTranscript } from 'transcriptout';
 *   const items = await YoutubeTranscript.fetchTranscript('dQw4w9WgXcQ', { lang: 'en' });
 *
 * The key comes from `apiKey` or the TRANSCRIPTOUT_API_KEY environment variable. Fetching goes
 * through TranscriptOut, so there is nothing for YouTube to block on your server.
 */

const DEFAULT_BASE_URL = 'https://api.transcriptout.com';
const USER_AGENT = 'transcriptout-js/0.1.1';
/** One batch job takes at most this many videos; longer lists run as several jobs. */
const BATCH_MAX = 4000;

// ---- errors, under the names youtube-transcript exports -----------------------------------------

export class YoutubeTranscriptError extends Error {
  constructor(message: any) {
    super(`[YoutubeTranscript] 🚨 ${message}`);
    this.name = new.target.name;
  }
}

export class YoutubeTranscriptTooManyRequestError extends YoutubeTranscriptError {
  constructor() {
    super('Too many requests for this API key. Slow down or retry after a minute');
  }
}

export class YoutubeTranscriptVideoUnavailableError extends YoutubeTranscriptError {
  constructor(videoId: string) {
    super(`The video is no longer available (${videoId})`);
  }
}

export class YoutubeTranscriptDisabledError extends YoutubeTranscriptError {
  constructor(videoId: string) {
    super(`Transcript is disabled on this video (${videoId})`);
  }
}

export class YoutubeTranscriptNotAvailableError extends YoutubeTranscriptError {
  constructor(videoId: string) {
    super(`No transcripts are available for this video (${videoId})`);
  }
}

export class YoutubeTranscriptNotAvailableLanguageError extends YoutubeTranscriptError {
  constructor(lang: string, availableLangs: string[], videoId: string) {
    const tail = availableLangs.length ? ` Available languages: ${availableLangs.join(', ')}` : '';
    super(`No transcripts are available in ${lang} this video (${videoId}).${tail}`);
  }
}

/** A refusal from the TranscriptOut API itself. Branch on `code`, not on the message. */
export class TranscriptOutError extends YoutubeTranscriptError {
  constructor(message: string, readonly status: number, readonly code?: string, readonly requestId?: string) {
    super(requestId ? `${message} (request_id ${requestId})` : message);
  }
}

export class TranscriptOutAuthError extends TranscriptOutError {}
export class TranscriptOutInsufficientCreditsError extends TranscriptOutError {}

// ---- types ----------------------------------------------------------------------------------------

export interface TranscriptConfig {
  lang?: string;
  fetch?: typeof globalThis.fetch;
  /** Your TranscriptOut key (`sk_…`). Defaults to TRANSCRIPTOUT_API_KEY. */
  apiKey?: string;
  baseUrl?: string;
  /**
   * Units of `offset` and `duration`. youtube-transcript 1.3 returns milliseconds for current
   * YouTube tracks, so that is the default. Use 's' for seconds.
   */
  units?: 'ms' | 's';
  /** Retries on 429 and 503, honouring Retry-After. Those are not charged. Default 3. */
  maxRetries?: number;
}

export interface TranscriptResponse {
  text: string;
  duration: number;
  offset: number;
  lang?: string;
}

export interface FetchManyOptions {
  lang?: string;
  kind?: 'manual' | 'auto';
  pollIntervalMs?: number;
  onProgress?: (status: Record<string, unknown>) => void;
}

export interface FetchManyResult {
  transcripts: Record<string, TranscriptResponse[]>;
  errors: Record<string, YoutubeTranscriptError>;
  jobIds: string[];
}

interface Segment { text: string; start: number; duration: number }
interface TrackRef { code: string; kind: string; name?: string }
interface TranscriptData {
  video_id: string;
  language: string;
  kind: string;
  transcript: Segment[];
  available_langs?: TrackRef[];
}

// ---- the client ------------------------------------------------------------------------------------

function envKey(): string | undefined {
  const proc = (globalThis as any).process;
  return proc?.env?.TRANSCRIPTOUT_API_KEY;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TranscriptOut {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly maxRetries: number;
  private readonly units: 'ms' | 's';

  constructor(config: Omit<TranscriptConfig, 'lang'> = {}) {
    this.apiKey = config.apiKey ?? envKey();
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.maxRetries = config.maxRetries ?? 3;
    this.units = config.units ?? 'ms';
  }

  /** The transcript in `lang`, or in the video's first track when no language is given. */
  async fetchTranscript(videoId: string, lang?: string): Promise<TranscriptResponse[]> {
    try {
      const data = await this.track(videoId, lang ?? 'en');
      return this.shape(data);
    } catch (e) {
      // youtube-transcript without a language takes the video's first track, whatever it is.
      if (lang || !(e instanceof YoutubeTranscriptNotAvailableLanguageError)) throw e;
    }
    const video = await this.call('GET', '/v1/video', { id: videoId }, undefined, videoId);
    const tracks: TrackRef[] = video?.available_langs ?? [];
    if (!tracks.length) throw new YoutubeTranscriptDisabledError(videoId);
    const first = tracks.find((t) => t.kind === 'manual') ?? tracks[0];
    return this.shape(await this.track(videoId, first.code, first.kind));
  }

  /**
   * Transcripts for many videos through the batch endpoint, up to 4,000 per job. One request
   * submits the list, TranscriptOut works through it and retries what it can. Needs a user key.
   */
  async fetchMany(videoIds: string[], options: FetchManyOptions = {}): Promise<FetchManyResult> {
    const ids = [...new Set(videoIds.filter(Boolean))];
    const lang = options.lang ?? 'en';
    const result: FetchManyResult = { transcripts: {}, errors: {}, jobIds: [] };
    for (let i = 0; i < ids.length; i += BATCH_MAX) {
      const body: Record<string, unknown> = { videos: ids.slice(i, i + BATCH_MAX), lang, format: 'json' };
      if (options.kind) body.kind = options.kind;
      const idem = { 'Idempotency-Key': (globalThis as any).crypto?.randomUUID?.() ?? `${Date.now()}-${i}` };
      const job = await this.call('POST', '/v1/transcripts', undefined, body, '', idem);
      result.jobIds.push(job.job_id);
      for (;;) {
        const status = await this.call('GET', `/v1/transcripts/${job.job_id}`);
        options.onProgress?.(status);
        if (status.status === 'done' || status.status === 'cancelled') break;
        await sleep(options.pollIntervalMs ?? 3000);
      }
      let token: string | undefined;
      for (;;) {
        const query: Record<string, string> = { limit: '500' };
        if (token) query.next_page_token = token;
        const page = await this.call('GET', `/v1/transcripts/${job.job_id}/results`, query);
        for (const item of page.results ?? []) {
          if (item.status === 'ready') result.transcripts[item.video_id] = this.shape(item);
          else result.errors[item.video_id] = errorFor(item.http_status ?? STATUS_FOR_CODE[item.code] ?? 500, item.code, String(item.detail ?? ''), item.video_id);
        }
        token = page.next_page_token;
        if (!page.has_more || !token) break;
      }
    }
    return result;
  }

  private async track(videoId: string, lang: string, kind?: string): Promise<TranscriptData> {
    const query: Record<string, string> = { video: videoId, lang, format: 'json' };
    if (kind) query.kind = kind;
    try {
      return await this.call('GET', '/v1/transcript', query, undefined, videoId);
    } catch (e) {
      if (e instanceof YoutubeTranscriptNotAvailableError && !(e instanceof YoutubeTranscriptDisabledError)) {
        throw new YoutubeTranscriptNotAvailableLanguageError(lang, [], videoId);
      }
      throw e;
    }
  }

  private shape(data: TranscriptData): TranscriptResponse[] {
    const k = this.units === 'ms' ? 1000 : 1;
    return (data.transcript ?? []).map((s) => ({
      text: s.text,
      duration: Math.round(s.duration * k * 1000) / 1000,
      offset: Math.round(s.start * k * 1000) / 1000,
      lang: data.language,
    }));
  }

  private async call(method: string, path: string, query?: Record<string, string>, body?: unknown,
                     videoId = '', extra: Record<string, string> = {}): Promise<any> {
    if (!this.apiKey) {
      throw new TranscriptOutAuthError(
        'No API key. Pass apiKey or set TRANSCRIPTOUT_API_KEY. Get a free key at https://transcriptout.com/dashboard', 401);
    }
    const url = `${this.baseUrl}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'User-Agent': USER_AGENT, ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      // ⚠️ 502 is not retried: the request reached YouTube and is charged, a silent retry would spend again.
      if ((res.status === 429 || res.status === 503) && attempt < this.maxRetries) {
        const after = Number(res.headers.get('Retry-After'));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : Math.min(2 ** (attempt + 1), 30) * 1000);
        continue;
      }
      let json: any = null;
      try { json = await res.json(); } catch { /* not JSON */ }
      if (res.ok && (json?.ok ?? true)) return json?.data ?? json;
      throw errorFor(res.status, json?.code, typeof json?.detail === 'string' ? json.detail : res.statusText, videoId, json?.request_id);
    }
  }
}

// Batch results name a refusal by its machine code only, the HTTP status is not part of an item.
const STATUS_FOR_CODE: Record<string, number> = {
  bad_request: 400, unauthorized: 401, insufficient_credits: 402, forbidden: 403,
  not_found: 404, gone: 410, rate_limited: 429, unavailable_for_legal_reasons: 451,
  upstream_error: 502, service_unavailable: 503,
};

function errorFor(status: number, code: string | undefined, detail: string, videoId: string, requestId?: string): YoutubeTranscriptError {
  if (status === 401 || status === 403) return new TranscriptOutAuthError(detail || 'Unauthorized', status, code, requestId);
  if (status === 402) return new TranscriptOutInsufficientCreditsError(detail || 'Insufficient credits', status, code, requestId);
  if (status === 429) return new YoutubeTranscriptTooManyRequestError();
  if (videoId && status === 404) {
    // "No subtitles for this video" means none at all; any other 404 names a language.
    if (/for this video/.test(detail) && !/language/.test(detail)) return new YoutubeTranscriptDisabledError(videoId);
    return new YoutubeTranscriptNotAvailableError(videoId);
  }
  if (videoId && (status === 410 || status === 451)) return new YoutubeTranscriptVideoUnavailableError(videoId);
  return new TranscriptOutError(detail || `HTTP ${status}`, status, code, requestId);
}

// ---- the youtube-transcript entry points ----------------------------------------------------------

export class YoutubeTranscript {
  /**
   * Fetch transcript from a YouTube video.
   * @param videoId Video url or video identifier
   * @param config Language and TranscriptOut options
   */
  static fetchTranscript(videoId: string, config?: TranscriptConfig): Promise<TranscriptResponse[]> {
    return new TranscriptOut(config).fetchTranscript(videoId, config?.lang);
  }
}

export function fetchTranscript(videoId: string, config?: TranscriptConfig): Promise<TranscriptResponse[]> {
  return YoutubeTranscript.fetchTranscript(videoId, config);
}
