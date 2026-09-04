import type { UsageSnapshot, UsageWindow } from './usage';

/**
 * The app already polls once a minute and throws every reading away. Keeping a short
 * rolling log turns the same data into a rate, which answers the question a single
 * percentage cannot: will this last until the limit resets?
 *
 * Everything here is pure so it can be tested without a device or a live account.
 */

export type UsageSample = {
  /** Epoch milliseconds. */
  at: number;
  /** Utilization per window key at that moment. */
  values: Record<string, number>;
};

const MAX_SAMPLES = 600;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** Below this span the two readings are too close together to imply a rate. */
const MIN_SPAN_MS = 10 * 60 * 1000;
/** Below this rise the change is indistinguishable from rounding in the payload. */
const MIN_RISE_PERCENT = 0.5;
/** Samples closer together than this add noise without adding information. */
const MIN_SAMPLE_GAP_MS = 45 * 1000;

export function windowKey(window: UsageWindow): string {
  return window.id === 'scoped' ? `scoped:${window.title}` : window.id;
}

export function appendSample(
  history: UsageSample[],
  snapshot: UsageSnapshot,
  now = new Date(),
): UsageSample[] {
  const values: Record<string, number> = {};
  for (const window of snapshot.windows) values[windowKey(window)] = window.utilization;

  const at = snapshot.fetchedAt.getTime();
  const latest = history[history.length - 1];

  // A repeated poll that returned the same snapshot should not become a second sample.
  if (latest && at - latest.at < MIN_SAMPLE_GAP_MS) {
    return [...history.slice(0, -1), { at, values }];
  }

  return pruneHistory([...history, { at, values }], now);
}

export function pruneHistory(history: UsageSample[], now = new Date()): UsageSample[] {
  const cutoff = now.getTime() - MAX_AGE_MS;
  const fresh = history.filter((sample) => sample.at >= cutoff).sort((left, right) => left.at - right.at);
  return fresh.length > MAX_SAMPLES ? fresh.slice(fresh.length - MAX_SAMPLES) : fresh;
}

export type BurnRate = {
  percentPerHour: number;
  spanMs: number;
  sampleCount: number;
  /** When the window would reach 100 percent at this rate, or null if it never would. */
  exhaustsAt: Date | null;
};

/**
 * Rate is measured only across the current window period. A drop in utilization means the
 * limit reset, and readings from before that reset say nothing about the period in play.
 */
export function computeBurnRate(
  history: UsageSample[],
  key: string,
  currentUtilization: number,
  now = new Date(),
): BurnRate | null {
  const series = history
    .filter((sample) => typeof sample.values[key] === 'number')
    .map((sample) => ({ at: sample.at, value: sample.values[key] }));

  const segment = takeCurrentPeriod(series);
  if (segment.length < 2) return null;

  const first = segment[0];
  const last = segment[segment.length - 1];
  const spanMs = last.at - first.at;
  const rise = last.value - first.value;

  if (spanMs < MIN_SPAN_MS || rise < MIN_RISE_PERCENT) return null;

  const percentPerHour = rise / (spanMs / 3_600_000);
  const remaining = Math.max(0, 100 - currentUtilization);
  const hoursLeft = percentPerHour > 0 ? remaining / percentPerHour : null;

  return {
    percentPerHour,
    spanMs,
    sampleCount: segment.length,
    exhaustsAt: hoursLeft === null ? null : new Date(now.getTime() + hoursLeft * 3_600_000),
  };
}

export type RecentDelta = {
  /** Percentage points consumed across the measured gap. */
  risePercent: number;
  spanMs: number;
};

/** Below this rise the change cannot be told apart from noise in the payload. */
const MIN_PULSE_RISE_PERCENT = 0.1;
/** Older than this and it is no longer "right now". */
const MAX_PULSE_SPAN_MS = 3 * 60 * 1000;
/** Younger than this and the two readings are effectively the same moment. */
const MIN_PULSE_SPAN_MS = 20 * 1000;

/**
 * The honest version of "something is working right now". A rise between the two most
 * recent readings means quota was consumed on this account, which is all the usage
 * endpoint can support. It says nothing about who or what consumed it, deliberately:
 * it could be another device, another session, or a script the user forgot about.
 *
 * `requireSampleAt` guards against the case this got wrong at first: history survives a
 * restart, so two stored readings from a previous session would keep claiming activity on
 * a cold start without anything having been measured. Passing the timestamp of a reading
 * taken in this session forces the claim to rest on a live measurement.
 *
 * `null` means no reading has been taken in this session, so the answer is no. It used to
 * mean "skip the check", which had the default pointing the wrong way for a guard: a
 * caller that simply omitted the argument got the old bug back. The one call site already
 * checked before calling, so this only closes the trap for the next one.
 */
export function computeRecentDelta(
  history: UsageSample[],
  key: string,
  now = new Date(),
  requireSampleAt: number | null,
): RecentDelta | null {
  const series = history
    .filter((sample) => typeof sample.values[key] === 'number')
    .map((sample) => ({ at: sample.at, value: sample.values[key] }));

  if (series.length < 2) return null;

  const last = series[series.length - 1];
  const previous = series[series.length - 2];

  // Nothing has been measured in this session, so there is nothing to claim.
  if (requireSampleAt === null || last.at !== requireSampleAt) return null;

  // A stale log should not keep claiming activity after the app has been closed a while.
  if (now.getTime() - last.at > MAX_PULSE_SPAN_MS) return null;

  const spanMs = last.at - previous.at;
  const risePercent = last.value - previous.value;

  if (spanMs < MIN_PULSE_SPAN_MS || spanMs > MAX_PULSE_SPAN_MS) return null;
  if (risePercent < MIN_PULSE_RISE_PERCENT) return null;

  return { risePercent, spanMs };
}

function takeCurrentPeriod(series: { at: number; value: number }[]): { at: number; value: number }[] {
  let start = 0;
  for (let index = 1; index < series.length; index += 1) {
    if (series[index].value < series[index - 1].value) start = index;
  }
  return series.slice(start);
}

export type ActivityBucket = {
  /** Start of the bucket, epoch milliseconds. */
  from: number;
  /** Percentage points consumed inside the bucket. */
  rise: number;
};

const BUCKET_MS = 20 * 60 * 1000;
const BUCKET_COUNT = 15;
/** Fewer active buckets than this and a strip of bars would pretend to be information. */
const MIN_ACTIVE_BUCKETS = 3;

/**
 * Consumption per 20 minute slot over the last five hours. A single percentage shows a
 * level; this shows where the work actually happened, which is what makes a burst of
 * activity visible at all.
 *
 * Returns null rather than a row of empty bars when the log is too thin to say anything.
 */
export function buildActivityBuckets(
  history: UsageSample[],
  key: string,
  now = new Date(),
): ActivityBucket[] | null {
  const series = history
    .filter((sample) => typeof sample.values[key] === 'number')
    .map((sample) => ({ at: sample.at, value: sample.values[key] }))
    .sort((left, right) => left.at - right.at);

  if (series.length < 2) return null;

  // Align the last bucket to the current moment so the newest work sits at the edge.
  const end = now.getTime();
  const buckets: ActivityBucket[] = [];

  for (let index = BUCKET_COUNT - 1; index >= 0; index -= 1) {
    const to = end - index * BUCKET_MS;
    const from = to - BUCKET_MS;
    const before = valueAtOrBefore(series, from);
    const inside = valueAtOrBefore(series, to);

    // A negative difference means the limit reset inside the slot, and how much was used
    // before that reset cannot be recovered. Zero is the honest answer, not a guess.
    const rise = before === null || inside === null ? 0 : Math.max(0, inside - before);
    buckets.push({ from, rise });
  }

  const active = buckets.filter((bucket) => bucket.rise > 0).length;
  return active < MIN_ACTIVE_BUCKETS ? null : buckets;
}

function valueAtOrBefore(series: { at: number; value: number }[], at: number): number | null {
  let found: number | null = null;
  for (const sample of series) {
    if (sample.at > at) break;
    found = sample.value;
  }
  return found;
}

type StoredSample = { at: number; values: Record<string, number> };

export function deserializeHistory(value: unknown): UsageSample[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): UsageSample[] => {
    if (typeof item !== 'object' || item === null) return [];
    const sample = item as Partial<StoredSample>;
    if (typeof sample.at !== 'number' || !Number.isFinite(sample.at)) return [];
    if (typeof sample.values !== 'object' || sample.values === null) return [];

    const values: Record<string, number> = {};
    for (const [key, raw] of Object.entries(sample.values)) {
      if (typeof raw === 'number' && Number.isFinite(raw)) values[key] = raw;
    }

    return Object.keys(values).length === 0 ? [] : [{ at: sample.at, values }];
  });
}
