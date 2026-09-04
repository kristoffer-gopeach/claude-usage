import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appendSample,
  buildActivityBuckets,
  computeBurnRate,
  computeRecentDelta,
  deserializeHistory,
  pruneHistory,
  windowKey,
  type UsageSample,
} from './history.ts';
import type { UsageSnapshot } from './usage.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Epoch-anchored so nothing here depends on when the suite runs. */
const NOW = new Date('2026-09-04T20:00:00.000Z');
const at = (offsetMs: number) => NOW.getTime() + offsetMs;

function sample(offsetMs: number, values: Record<string, number>): UsageSample {
  return { at: at(offsetMs), values };
}

function snapshot(offsetMs: number, utilization: number): UsageSnapshot {
  return {
    fetchedAt: new Date(at(offsetMs)),
    windows: [{ id: 'five-hour', title: '5-hour window', utilization, resetsAt: null }],
  };
}

describe('windowKey', () => {
  it('keeps the two fixed windows on their plain id', () => {
    assert.equal(windowKey({ id: 'five-hour', title: '5-hour window', utilization: 0, resetsAt: null }), 'five-hour');
    assert.equal(windowKey({ id: 'weekly', title: 'Weekly window', utilization: 0, resetsAt: null }), 'weekly');
  });

  it('qualifies scoped windows by title so two model caps cannot collide', () => {
    const opus = windowKey({ id: 'scoped', title: 'Opus 4.5', utilization: 85, resetsAt: null });
    const sonnet = windowKey({ id: 'scoped', title: 'Sonnet 4.5', utilization: 12, resetsAt: null });

    assert.equal(opus, 'scoped:Opus 4.5');
    assert.notEqual(opus, sonnet);
  });
});

describe('appendSample', () => {
  it('replaces the last sample when a poll repeats inside the minimum gap', () => {
    const history = [sample(-2 * MINUTE, { 'five-hour': 40 })];

    // 30s later, inside MIN_SAMPLE_GAP_MS of 45s.
    const next = appendSample(history, snapshot(-2 * MINUTE + 30_000, 41), NOW);

    assert.equal(next.length, 1, 'a repeated poll must not become a second sample');
    assert.equal(next[0].values['five-hour'], 41, 'but it should carry the fresher value');
  });

  it('appends once the gap is wide enough to carry information', () => {
    const history = [sample(-2 * MINUTE, { 'five-hour': 40 })];

    const next = appendSample(history, snapshot(-MINUTE, 42), NOW);

    assert.equal(next.length, 2);
    assert.deepEqual(
      next.map((entry) => entry.values['five-hour']),
      [40, 42],
    );
  });

  it('records every window in the snapshot under its own key', () => {
    const next = appendSample(
      [],
      {
        fetchedAt: new Date(at(0)),
        windows: [
          { id: 'five-hour', title: '5-hour window', utilization: 10, resetsAt: null },
          { id: 'scoped', title: 'Opus 4.5', utilization: 85, resetsAt: null },
        ],
      },
      NOW,
    );

    assert.deepEqual(next[0].values, { 'five-hour': 10, 'scoped:Opus 4.5': 85 });
  });
});

describe('pruneHistory', () => {
  it('drops samples past the 48 hour horizon and keeps the rest in order', () => {
    const kept = pruneHistory(
      [sample(-3 * HOUR, { a: 1 }), sample(-49 * HOUR, { a: 2 }), sample(-1 * HOUR, { a: 3 })],
      NOW,
    );

    assert.deepEqual(
      kept.map((entry) => entry.values.a),
      [1, 3],
      'the 49 hour old sample should be gone and the survivors sorted oldest first',
    );
  });

  it('caps the log so a long session cannot grow it without bound', () => {
    const many = Array.from({ length: 640 }, (_, index) => sample(-index * MINUTE, { a: index }));

    const kept = pruneHistory(many, NOW);

    assert.equal(kept.length, 600);
    assert.equal(kept[kept.length - 1].values.a, 0, 'the newest sample must survive');
  });
});

describe('computeBurnRate', () => {
  it('returns null with a single reading, because one point is not a rate', () => {
    assert.equal(computeBurnRate([sample(-HOUR, { 'five-hour': 10 })], 'five-hour', 10, NOW), null);
  });

  it('returns null when the readings are closer together than the minimum span', () => {
    const history = [sample(-5 * MINUTE, { 'five-hour': 10 }), sample(0, { 'five-hour': 30 })];

    assert.equal(computeBurnRate(history, 'five-hour', 30, NOW), null);
  });

  it('returns null when the rise is small enough to be payload rounding', () => {
    const history = [sample(-2 * HOUR, { 'five-hour': 10 }), sample(0, { 'five-hour': 10.4 })];

    assert.equal(computeBurnRate(history, 'five-hour', 10.4, NOW), null);
  });

  it('measures percent per hour and projects when the window runs out', () => {
    // 20 points over 2 hours is 10 per hour; 40 remaining means 4 hours left.
    const history = [sample(-2 * HOUR, { 'five-hour': 40 }), sample(0, { 'five-hour': 60 })];

    const rate = computeBurnRate(history, 'five-hour', 60, NOW);

    assert.ok(rate);
    assert.equal(rate.percentPerHour, 10);
    assert.equal(rate.spanMs, 2 * HOUR);
    assert.equal(rate.sampleCount, 2);
    assert.equal(rate.exhaustsAt?.getTime(), NOW.getTime() + 4 * HOUR);
  });

  it('ignores everything before a reset, so the previous period cannot skew the rate', () => {
    // A busy period that ended in a reset, then a slow one. Measuring across the reset
    // would read as a fall; measuring the whole log would inflate the span.
    const history = [
      sample(-6 * HOUR, { 'five-hour': 10 }),
      sample(-5 * HOUR, { 'five-hour': 90 }),
      sample(-2 * HOUR, { 'five-hour': 5 }),
      sample(0, { 'five-hour': 15 }),
    ];

    const rate = computeBurnRate(history, 'five-hour', 15, NOW);

    assert.ok(rate);
    assert.equal(rate.sampleCount, 2, 'only the two readings since the reset count');
    assert.equal(rate.spanMs, 2 * HOUR);
    assert.equal(rate.percentPerHour, 5);
  });

  it('reports no exhaustion when the window is already full', () => {
    const history = [sample(-2 * HOUR, { 'five-hour': 80 }), sample(0, { 'five-hour': 100 })];

    const rate = computeBurnRate(history, 'five-hour', 100, NOW);

    assert.ok(rate);
    assert.equal(rate.exhaustsAt?.getTime(), NOW.getTime(), 'nothing remains, so it is out now');
  });

  it('ignores keys the log has no readings for', () => {
    const history = [sample(-2 * HOUR, { 'five-hour': 10 }), sample(0, { 'five-hour': 30 })];

    assert.equal(computeBurnRate(history, 'weekly', 30, NOW), null);
  });
});

describe('computeRecentDelta', () => {
  const live = [sample(-MINUTE, { 'five-hour': 40 }), sample(0, { 'five-hour': 41 })];

  it('reports the rise between the two newest readings', () => {
    const delta = computeRecentDelta(live, 'five-hour', NOW, at(0));

    assert.ok(delta);
    assert.equal(Math.round(delta.risePercent * 10) / 10, 1);
    assert.equal(delta.spanMs, MINUTE);
  });

  it('stays silent on a cold start, when both readings came from storage', () => {
    // This was a real bug: history survives a restart, so two stored readings kept
    // claiming activity with nothing measured in this session. The guard is that the
    // newest sample must be the one this session actually took.
    assert.equal(
      computeRecentDelta(live, 'five-hour', NOW, null),
      null,
      'no live sample means no claim',
    );
    assert.equal(
      computeRecentDelta(live, 'five-hour', NOW, at(-MINUTE)),
      null,
      'a live timestamp that is not the newest sample is also not enough',
    );
  });

  it('stays silent once the newest reading is too old to be "right now"', () => {
    const stale = [sample(-10 * MINUTE, { 'five-hour': 40 }), sample(-5 * MINUTE, { 'five-hour': 41 })];

    assert.equal(computeRecentDelta(stale, 'five-hour', NOW, at(-5 * MINUTE)), null);
  });

  it('stays silent when the two readings are effectively the same moment', () => {
    const tooClose = [sample(-10_000, { 'five-hour': 40 }), sample(0, { 'five-hour': 41 })];

    assert.equal(computeRecentDelta(tooClose, 'five-hour', NOW, at(0)), null);
  });

  it('stays silent when the rise is below the noise floor', () => {
    // Codex returns whole integers, so anything under a tenth of a point is not real.
    const flat = [sample(-MINUTE, { 'five-hour': 40 }), sample(0, { 'five-hour': 40.05 })];

    assert.equal(computeRecentDelta(flat, 'five-hour', NOW, at(0)), null);
  });

  it('stays silent when utilization fell, because a reset is not activity', () => {
    const reset = [sample(-MINUTE, { 'five-hour': 90 }), sample(0, { 'five-hour': 2 })];

    assert.equal(computeRecentDelta(reset, 'five-hour', NOW, at(0)), null);
  });
});

describe('buildActivityBuckets', () => {
  it('returns null when the log is too thin to say anything', () => {
    assert.equal(buildActivityBuckets([sample(0, { 'five-hour': 10 })], 'five-hour', NOW), null);
  });

  it('returns null rather than a row of empty bars when too few slots saw work', () => {
    // Two active slots, one below the minimum of three.
    const history = [
      sample(-60 * MINUTE, { 'five-hour': 10 }),
      sample(-40 * MINUTE, { 'five-hour': 20 }),
      sample(-20 * MINUTE, { 'five-hour': 30 }),
    ];

    assert.equal(buildActivityBuckets(history, 'five-hour', NOW), null);
  });

  it('spreads consumption across fifteen slots once there is enough activity', () => {
    const history = Array.from({ length: 8 }, (_, index) =>
      sample(-(7 - index) * 20 * MINUTE, { 'five-hour': 10 + index * 5 }),
    );

    const buckets = buildActivityBuckets(history, 'five-hour', NOW);

    assert.ok(buckets);
    assert.equal(buckets.length, 15);
    assert.ok(
      buckets.filter((bucket) => bucket.rise > 0).length >= 3,
      'the busy slots should carry a rise',
    );
    assert.ok(
      buckets.every((bucket) => bucket.rise >= 0),
      'a bucket can never report negative consumption',
    );
    assert.ok(
      buckets[buckets.length - 1].from < NOW.getTime(),
      'the newest slot should end at the current moment',
    );
  });

  it('reports zero rather than a guess for a slot the limit reset inside', () => {
    const history = [
      sample(-100 * MINUTE, { 'five-hour': 10 }),
      sample(-80 * MINUTE, { 'five-hour': 40 }),
      sample(-60 * MINUTE, { 'five-hour': 70 }),
      sample(-40 * MINUTE, { 'five-hour': 5 }),
      sample(-20 * MINUTE, { 'five-hour': 12 }),
      sample(0, { 'five-hour': 20 }),
    ];

    const buckets = buildActivityBuckets(history, 'five-hour', NOW);

    assert.ok(buckets);
    assert.ok(
      buckets.every((bucket) => bucket.rise >= 0),
      'the reset must not surface as negative consumption',
    );
  });
});

describe('deserializeHistory', () => {
  it('returns an empty log for anything that is not an array', () => {
    for (const value of [null, undefined, 42, 'x', {}]) {
      assert.deepEqual(deserializeHistory(value), []);
    }
  });

  it('keeps well formed samples and drops the rest', () => {
    const restored = deserializeHistory([
      { at: 1, values: { 'five-hour': 10 } },
      { at: 'nope', values: { 'five-hour': 10 } },
      { at: 2, values: null },
      { at: 3 },
      null,
      { at: Number.NaN, values: { 'five-hour': 10 } },
      { at: 4, values: {} },
    ]);

    assert.deepEqual(restored, [{ at: 1, values: { 'five-hour': 10 } }]);
  });

  it('drops non-finite readings inside an otherwise valid sample', () => {
    const restored = deserializeHistory([
      { at: 1, values: { good: 10, bad: Number.POSITIVE_INFINITY, alsoBad: 'x' } },
    ]);

    assert.deepEqual(restored, [{ at: 1, values: { good: 10 } }]);
  });
});
