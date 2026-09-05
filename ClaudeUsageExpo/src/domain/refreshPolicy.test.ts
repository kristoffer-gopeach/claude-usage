import assert from 'node:assert/strict';
import { it } from 'node:test';
import { nextRefreshDelay } from './refreshPolicy.ts';

it('refreshes immediately on first connection or after a long absence', () => {
  assert.equal(nextRefreshDelay(0, 1000, false), 0);
  assert.equal(nextRefreshDelay(1000, 400000, true), 0);
});

it('avoids duplicate requests after reopening a menu or login view', () => {
  assert.equal(nextRefreshDelay(1000, 2000, false), 59000);
});

it('backs off failed requests and restores the normal cadence after success', () => {
  assert.equal(nextRefreshDelay(1000, 61000, true), 240000);
  assert.equal(nextRefreshDelay(1000, 61000, false), 0);
});

it('caps the wait when the device clock moves backwards', () => {
  assert.equal(nextRefreshDelay(100000, 1000, false), 60000);
});
