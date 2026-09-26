import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseWorkerBuildId } from '../src/services/buildGuard.js';

const workerSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

test('reads the build id the service worker advertises', () => {
  assert.equal(parseWorkerBuildId(workerSource), 'findash-v13');
});

test('ignores source that declares no build id', () => {
  assert.equal(parseWorkerBuildId('// nothing here'), '');
  assert.equal(parseWorkerBuildId(''), '');
  assert.equal(parseWorkerBuildId(undefined), '');
});

test('accepts either quote style so a formatting change cannot hide the id', () => {
  assert.equal(parseWorkerBuildId('const VERSION = "abc-1";'), 'abc-1');
  assert.equal(parseWorkerBuildId("const  VERSION='abc-2'"), 'abc-2');
});

test('the service worker never caches the application API', () => {
  assert.match(workerSource, /\^\\\/api\\\//, 'BYPASS must exclude /api/');
  assert.match(workerSource, /\\\/_headers\$/);
});

test('the service worker retires caches from previous builds', () => {
  assert.match(workerSource, /!key\.startsWith\(VERSION\)/);
});

test('the built bundle carries the same build id as the worker', () => {
  const config = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(config, /VITE_BUILD_ID/);
  // vite.config.js derives the id from sw.js, so the two cannot drift.
  assert.match(config, /public\/sw\.js/);
  assert.match(config, /const VERSION/);
});