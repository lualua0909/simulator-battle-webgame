import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metricsSnapshot, recordBattleResult, recordBattleVoid, recordHttp } from './metrics';

test('groups failed API requests by method, path and status', () => {
  recordHttp('GET', '/api/player', 200);
  recordHttp('POST', '/api/auth/session', 401);
  recordHttp('POST', '/api/auth/session', 401);
  recordHttp('GET', '/api/config', 500);
  const { http } = metricsSnapshot();
  assert.equal(http.total, 4);
  assert.equal(http.failed, 3);
  assert.deepEqual(
    http.routes.map((r) => [r.method, r.path, r.status, r.count]),
    [
      ['POST', '/api/auth/session', 401, 2],
      ['GET', '/api/config', 500, 1],
    ],
  );
});

test('counts battle results and void reasons', () => {
  recordBattleResult('draw');
  recordBattleVoid('Người chơi rời trận');
  recordBattleVoid('Người chơi rời trận');
  const { battles } = metricsSnapshot();
  assert.equal(battles.results.draw, 1);
  assert.deepEqual(battles.voided, [{ reason: 'Người chơi rời trận', count: 2 }]);
});
