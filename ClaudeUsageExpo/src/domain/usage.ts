export type UsageWindow = {
  id: 'five-hour' | 'weekly' | 'scoped';
  title: string;
  utilization: number;
  resetsAt: Date | null;
};

export type UsageSnapshot = {
  windows: UsageWindow[];
  fetchedAt: Date;
};

type JsonRecord = Record<string, unknown>;

export function parseUsagePayload(body: string, fetchedAt = new Date()): UsageSnapshot {
  const payload = asRecord(JSON.parse(body));
  const windows: UsageWindow[] = [];

  const fiveHour = parseWindow(payload.five_hour, 'five-hour', '5-hour window');
  const weekly = parseWindow(payload.seven_day, 'weekly', 'Weekly window');

  if (fiveHour) windows.push(fiveHour);
  if (weekly) windows.push(weekly);

  windows.push(...parseScopedWindows(payload.limits));

  if (windows.length === 0) {
    throw new Error('Claude returned usage data in an unsupported format.');
  }

  return { windows, fetchedAt };
}

export function parseCodexUsagePayload(body: string, fetchedAt = new Date()): UsageSnapshot {
  const payload = asRecord(JSON.parse(body), 'Codex returnerade ett ogiltigt svar.');
  const rateLimits = getRecord(payload.rate_limit) ?? getRecord(payload.rateLimits) ?? payload;
  const primary = parseCodexWindow(rateLimits.primary_window ?? rateLimits.primary, fetchedAt);
  const secondary = parseCodexWindow(rateLimits.secondary_window ?? rateLimits.secondary, fetchedAt);
  const candidates = [primary, secondary].filter((window): window is ParsedCodexWindow => window !== null);

  const windows = mapCodexWindowsByDuration(candidates);

  if (windows.length === 0) {
    throw new Error('Codex returnerade usage-data i ett format som appen inte stöder.');
  }

  return { windows, fetchedAt };
}

export function createExperimentReport(snapshot: UsageSnapshot, durationSeconds: number): string {
  const lines = snapshot.windows.map((window) => {
    const reset = window.resetsAt?.toISOString() ?? 'unavailable';
    return `${window.title}: ${formatNumber(window.utilization)}% | reset: ${reset}`;
  });

  return [
    'EXP-001 app observation',
    `Observed at: ${snapshot.fetchedAt.toISOString()}`,
    `Refresh duration: ${durationSeconds.toFixed(2)} s`,
    ...lines,
  ].join('\n');
}

/**
 * Cached snapshots survive app restarts so the dashboard can render the last known
 * state immediately instead of opening on a spinner. Dates have to be written as ISO
 * strings, because JSON.parse would otherwise hand back plain strings for resetsAt.
 */
type StoredSnapshot = {
  windows: { id: UsageWindow['id']; title: string; utilization: number; resetsAt: string | null }[];
  fetchedAt: string;
};

const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function serializeSnapshot(snapshot: UsageSnapshot): StoredSnapshot {
  return {
    fetchedAt: snapshot.fetchedAt.toISOString(),
    windows: snapshot.windows.map((window) => ({
      id: window.id,
      title: window.title,
      utilization: window.utilization,
      resetsAt: window.resetsAt?.toISOString() ?? null,
    })),
  };
}

export function deserializeSnapshot(value: unknown): UsageSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.windows)) return null;

  const fetchedAt = parseDate(value.fetchedAt);
  if (!fetchedAt) return null;

  const windows = value.windows.flatMap((item): UsageWindow[] => {
    if (!isRecord(item) || typeof item.utilization !== 'number' || typeof item.title !== 'string') {
      return [];
    }
    if (item.id !== 'five-hour' && item.id !== 'weekly' && item.id !== 'scoped') return [];

    return [{
      id: item.id,
      title: item.title,
      utilization: clampUtilization(item.utilization),
      resetsAt: parseDate(item.resetsAt),
    }];
  });

  return windows.length === 0 ? null : { windows, fetchedAt };
}

/**
 * A cached snapshot is only worth showing while none of its windows has reset. Once a
 * reset time has passed the utilization it reports is provably wrong, not merely old.
 */
export function hasSnapshotExpired(snapshot: UsageSnapshot, now = new Date()): boolean {
  if (now.getTime() - snapshot.fetchedAt.getTime() > SNAPSHOT_MAX_AGE_MS) return true;
  return snapshot.windows.some((window) => window.resetsAt !== null && window.resetsAt.getTime() <= now.getTime());
}

export function clampUtilization(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function parseWindow(
  value: unknown,
  id: UsageWindow['id'],
  title: string,
): UsageWindow | null {
  if (!isRecord(value) || typeof value.utilization !== 'number') return null;

  return {
    id,
    title,
    utilization: clampUtilization(value.utilization),
    resetsAt: parseDate(value.resets_at),
  };
}

/**
 * Claude can return a weekly cap per model. Every one of them is worth showing, because
 * knowing that Opus sits at 85 percent while Sonnet sits at 12 is what actually decides
 * which model to reach for. This used to sort the list and keep only the busiest entry,
 * which silently hid every other model the account had a cap for.
 */
function parseScopedWindows(value: unknown): UsageWindow[] {
  if (!Array.isArray(value)) return [];

  const candidates = value.flatMap((item): UsageWindow[] => {
    if (!isRecord(item) || item.kind !== 'weekly_scoped' || typeof item.percent !== 'number') {
      return [];
    }

    const scope = isRecord(item.scope) ? item.scope : null;
    const model = scope && isRecord(scope.model) ? scope.model : null;
    const title = model && typeof model.display_name === 'string' ? model.display_name : 'Model limit';

    return [{
      id: 'scoped',
      title,
      utilization: clampUtilization(item.percent),
      resetsAt: parseDate(item.resets_at),
    }];
  });

  return candidates.sort((left, right) => right.utilization - left.utilization);
}

function parseCodexWindow(
  value: unknown,
  fetchedAt: Date,
): ParsedCodexWindow | null {
  if (!isRecord(value)) return null;

  const usedPercent = readFiniteNumber(value.used_percent ?? value.usedPercent);
  if (usedPercent === null) return null;

  const resetAt = value.reset_at ?? value.resetsAt;
  const resetAfterSeconds = readFiniteNumber(value.reset_after_seconds ?? value.resetAfterSeconds);
  const durationSeconds = readFiniteNumber(
    value.limit_window_seconds ?? value.limitWindowSeconds ?? value.window_duration_seconds,
  );

  return {
    utilization: clampUtilization(usedPercent),
    durationSeconds,
    resetsAt:
      parseUnixDate(resetAt) ??
      (resetAfterSeconds !== null
        ? new Date(fetchedAt.getTime() + resetAfterSeconds * 1000)
        : null),
  };
}

type ParsedCodexWindow = Pick<UsageWindow, 'utilization' | 'resetsAt'> & {
  durationSeconds: number | null;
};

function mapCodexWindowsByDuration(candidates: ParsedCodexWindow[]): UsageWindow[] {
  const remaining = [...candidates];
  const take = (predicate: (window: ParsedCodexWindow) => boolean): ParsedCodexWindow | null => {
    const index = remaining.findIndex(predicate);
    return index === -1 ? null : remaining.splice(index, 1)[0];
  };

  // Codex can return a weekly-only limit in primary_window. The declared duration,
  // rather than the primary/secondary position, identifies what the window means.
  //
  // Observed live 2026-09-04: primary_window declared 18000 seconds and secondary_window
  // 604800, so five hours and seven days exactly, and the mapping below matched both.
  // `used_percent` came back as whole integers (1 and 63) with no fractional part, which
  // sets the floor for anything that measures change between two readings.
  const fiveHour =
    take((window) => window.durationSeconds === 18_000) ??
    take((window) => window.durationSeconds !== null && window.durationSeconds < 86_400);
  const weekly =
    take((window) => window.durationSeconds === 604_800) ??
    take((window) => window.durationSeconds !== null && window.durationSeconds >= 86_400);

  const fallbackFiveHour = fiveHour ?? remaining.shift() ?? null;
  const fallbackWeekly = weekly ?? remaining.shift() ?? null;
  const windows: UsageWindow[] = [];

  if (fallbackFiveHour) {
    windows.push({ ...fallbackFiveHour, id: 'five-hour', title: '5-hour window' });
  }
  if (fallbackWeekly) {
    windows.push({ ...fallbackWeekly, id: 'weekly', title: 'Weekly window' });
  }

  return windows;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseUnixDate(value: unknown): Date | null {
  if (typeof value === 'string' && !Number.isFinite(Number(value))) return parseDate(value);
  const timestamp = readFiniteNumber(value);
  if (timestamp === null) return null;
  const date = new Date(timestamp > 10_000_000_000 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function asRecord(value: unknown, errorMessage = 'Claude returned an invalid response.'): JsonRecord {
  if (!isRecord(value)) throw new Error(errorMessage);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
}
