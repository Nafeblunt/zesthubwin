import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const file = new URL('./time-ago.js', import.meta.url);
const scope = {};
runInNewContext(existsSync(file) ? readFileSync(file, 'utf8') : '', scope);
const now = Date.parse('2026-11-15T12:00:00Z');
for (const [age, expected] of [
  [0, 'Just now'], [59, 'Just now'], [60, '1 minute ago'], [119, '1 minute ago'], [120, '2 minutes ago'],
  [3599, '59 minutes ago'], [3600, '1 hour ago'], [7200, '2 hours ago'],
  [86399, '23 hours ago'], [86400, '1 day ago'], [172800, '2 days ago'],
  [604800, '1 week ago'], [1209600, '2 weeks ago'], [2592000, '1 month ago'],
  [5184000, '2 months ago'], [31536000, '1 year ago'], [63072000, '2 years ago'],
  [-120, 'Just now']
]) test(`a message ${age} seconds old displays ${expected}`, () => {
  assert.equal(typeof scope.zestTimeAgo, 'function', 'The shared message age formatter must be available');
  assert.equal(scope.zestTimeAgo(now / 1000 - age, now), expected);
});
