import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampUtilization,
  deserializeSnapshot,
  hasSnapshotExpired,
  parseCodexUsagePayload,
  parseUsagePayload,
  serializeSnapshot,
  type UsageSnapshot,
} from './usage.ts';

const NOW = new Date('2026-09-04T20:00:00.000Z');
const HOUR = 60 * 60 * 1000;

describe('parseUsagePayload', () => {
  it('reads the five hour and weekly windows', () => {
    const snapshot = parseUsagePayload(
      JSON.stringify({
        five_hour: { utilization: 62, resets_at: '2026-09-04T21:50:00.000Z' },
        seven_day: { utilization: 41, resets_at: '2026-09-07T11:00:00.000Z' },
      }),
      NOW,
    );

    assert.equal(snapshot.fetchedAt, NOW);
    assert.deepEqual(
      snapshot.windows.map((window) => [window.id, window.utilization]),
      [
        ['five-hour', 62],
        ['weekly', 41],
      ],
    );
    assert.equal(snapshot.windows[0].resetsAt?.toISOString(), '2026-09-04T21:50:00.000Z');
  });

  it('keeps every scoped model cap, busiest first', () => {
    // This used to keep only the busiest entry, which silently hid every other model the
    // account had a cap for. Knowing Opus is at 85 while Sonnet is at 12 is the point.
    const snapshot = parseUsagePayload(
      JSON.stringify({
        five_hour: { utilization: 10 },
        limits: [
          { kind: 'weekly_scoped', percent: 12, scope: { model: { display_name: 'Sonnet 4.5' } } },
          { kind: 'weekly_scoped', percent: 85, scope: { model: { display_name: 'Opus 4.5' } } },
          { kind: 'something_else', percent: 99 },
        ],
      }),
      NOW,
    );

    const scoped = snapshot.windows.filter((window) => window.id === 'scoped');

    assert.deepEqual(
      scoped.map((window) => [window.title, window.utilization]),
      [
        ['Opus 4.5', 85],
        ['Sonnet 4.5', 12],
      ],
    );
  });

  it('names a scoped cap that arrives without a model', () => {
    const snapshot = parseUsagePayload(
      JSON.stringify({ five_hour: { utilization: 1 }, limits: [{ kind: 'weekly_scoped', percent: 5 }] }),
      NOW,
    );

    assert.equal(snapshot.windows[1].title, 'Model limit');
  });

  it('clamps a utilization outside nought to a hundred', () => {
    const snapshot = parseUsagePayload(
      JSON.stringify({ five_hour: { utilization: 140 }, seven_day: { utilization: -3 } }),
      NOW,
    );

    assert.deepEqual(
      snapshot.windows.map((window) => window.utilization),
      [100, 0],
    );
  });

  it('leaves resetsAt null when the payload has no usable date', () => {
    const snapshot = parseUsagePayload(
      JSON.stringify({ five_hour: { utilization: 20, resets_at: 'not a date' } }),
      NOW,
    );

    assert.equal(snapshot.windows[0].resetsAt, null);
  });

  it('throws rather than reporting an empty snapshot it cannot read', () => {
    assert.throws(() => parseUsagePayload(JSON.stringify({ unexpected: true }), NOW), /unsupported format/);
    assert.throws(() => parseUsagePayload('{ not json', NOW));
  });
});

describe('parseCodexUsagePayload', () => {
  it('identifies windows by declared duration, not by primary or secondary position', () => {
    // Codex can put a weekly-only limit in primary_window, so position means nothing.
    // Observed live: primary declared 18000 seconds and secondary 604800.
    const snapshot = parseCodexUsagePayload(
      JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 63, limit_window_seconds: 604_800 },
          secondary_window: { used_percent: 1, limit_window_seconds: 18_000 },
        },
      }),
      NOW,
    );

    assert.deepEqual(
      snapshot.windows.map((window) => [window.id, window.utilization]),
      [
        ['five-hour', 1],
        ['weekly', 63],
      ],
      'the 18000 second window is the five hour one wherever it appeared',
    );
  });

  it('falls back to a duration threshold when the exact seconds differ', () => {
    const snapshot = parseCodexUsagePayload(
      JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 30, limit_window_seconds: 21_600 },
          secondary_window: { used_percent: 70, limit_window_seconds: 1_209_600 },
        },
      }),
      NOW,
    );

    assert.deepEqual(
      snapshot.windows.map((window) => [window.id, window.utilization]),
      [
        ['five-hour', 30],
        ['weekly', 70],
      ],
    );
  });

  it('turns a relative reset into an absolute time', () => {
    const snapshot = parseCodexUsagePayload(
      JSON.stringify({
        rate_limit: { primary_window: { used_percent: 5, reset_after_seconds: 3600, limit_window_seconds: 18_000 } },
      }),
      NOW,
    );

    assert.equal(snapshot.windows[0].resetsAt?.getTime(), NOW.getTime() + HOUR);
  });

  it('accepts the camelCase spelling of the same fields', () => {
    const snapshot = parseCodexUsagePayload(
      JSON.stringify({ rateLimits: { primary: { usedPercent: 44, limitWindowSeconds: 18_000 } } }),
      NOW,
    );

    assert.equal(snapshot.windows[0].utilization, 44);
  });

  it('throws on a shape it cannot read', () => {
    assert.throws(() => parseCodexUsagePayload(JSON.stringify({ rate_limit: {} }), NOW), /stöder/);
  });
});

describe('serializeSnapshot and deserializeSnapshot', () => {
  const snapshot: UsageSnapshot = {
    fetchedAt: NOW,
    windows: [
      { id: 'five-hour', title: '5-hour window', utilization: 62, resetsAt: new Date(NOW.getTime() + HOUR) },
      { id: 'scoped', title: 'Opus 4.5', utilization: 85, resetsAt: null },
    ],
  };

  it('survives a round trip through storage unchanged', () => {
    const restored = deserializeSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(snapshot))));

    assert.ok(restored);
    assert.equal(restored.fetchedAt.getTime(), NOW.getTime());
    assert.deepEqual(
      restored.windows.map((window) => [window.id, window.title, window.utilization]),
      [
        ['five-hour', '5-hour window', 62],
        ['scoped', 'Opus 4.5', 85],
      ],
    );
    assert.equal(restored.windows[0].resetsAt?.getTime(), NOW.getTime() + HOUR);
    assert.equal(restored.windows[1].resetsAt, null);
  });

  it('returns null for anything that is not a stored snapshot', () => {
    for (const value of [null, undefined, 42, 'x', {}, { windows: [] }, { fetchedAt: 'bad', windows: [] }]) {
      assert.equal(deserializeSnapshot(value), null, `should reject ${JSON.stringify(value)}`);
    }
  });

  it('drops windows with an unknown id or a missing number', () => {
    const restored = deserializeSnapshot({
      fetchedAt: NOW.toISOString(),
      windows: [
        { id: 'five-hour', title: 'ok', utilization: 10, resetsAt: null },
        { id: 'made-up', title: 'nope', utilization: 10, resetsAt: null },
        { id: 'weekly', title: 'no number', resetsAt: null },
        { id: 'weekly', utilization: 10, resetsAt: null },
      ],
    });

    assert.ok(restored);
    assert.deepEqual(
      restored.windows.map((window) => window.title),
      ['ok'],
    );
  });
});

describe('hasSnapshotExpired', () => {
  const fresh = (offsetMs: number, resetsAt: Date | null): UsageSnapshot => ({
    fetchedAt: new Date(NOW.getTime() + offsetMs),
    windows: [{ id: 'five-hour', title: '5-hour window', utilization: 10, resetsAt }],
  });

  it('treats a recent snapshot with a future reset as current', () => {
    assert.equal(hasSnapshotExpired(fresh(-60_000, new Date(NOW.getTime() + HOUR)), NOW), false);
  });

  it('expires once a window has passed its own reset time', () => {
    assert.equal(
      hasSnapshotExpired(fresh(-60_000, new Date(NOW.getTime() - 1)), NOW),
      true,
      'the numbers describe a period that is over',
    );
  });

  it('expires an old snapshot even when nothing has reset yet', () => {
    assert.equal(hasSnapshotExpired(fresh(-48 * HOUR, new Date(NOW.getTime() + HOUR)), NOW), true);
  });
});

describe('clampUtilization', () => {
  it('holds the value inside nought to a hundred', () => {
    assert.equal(clampUtilization(-5), 0);
    assert.equal(clampUtilization(0), 0);
    assert.equal(clampUtilization(42.5), 42.5);
    assert.equal(clampUtilization(100), 100);
    assert.equal(clampUtilization(1000), 100);
  });
});
