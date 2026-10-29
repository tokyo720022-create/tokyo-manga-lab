import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConnections, explainFailure } from '../src/features/connections/connection-check.js';

test('each service is reported on its own, and one failure does not hide the others', async () => {
  const out = await checkConnections({
    mangadex: async () => 'online',
    anilist: async () => { const e = new Error('x'); e.code = 'UNAUTHORIZED'; throw e; }
  });
  const by = Object.fromEntries(out.results.map(row => [row.key, row]));
  assert.equal(by.mangadex.ok, true);
  assert.equal(by.anilist.ok, false);
  assert.match(by.anilist.detail, /sign in again/i);
  assert.equal(by.mal.skipped, true);
  assert.equal(out.allOk, false);
  assert.match(out.summary, /MangaDex: working/);
  assert.match(out.summary, /MyAnimeList: not connected/);
});

test('failures are explained in plain words', () => {
  assert.match(explainFailure({ code: 'RATE_LIMITED' }), /busy/);
  assert.match(explainFailure({ status: 503 }), /problems/);
  assert.match(explainFailure({ code: 'NETWORK_ERROR' }), /internet/);
  assert.equal(explainFailure(new Error('Boom')), 'Boom');
});

test('nothing connected is fine', async () => {
  const out = await checkConnections({});
  assert.equal(out.allOk, true);
});
