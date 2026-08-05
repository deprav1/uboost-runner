import assert from 'node:assert/strict';

const storage = new Map();
global.localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function response(body, ok = true) {
  return { ok, json: async () => body };
}
function tick() { return new Promise((resolve) => setImmediate(resolve)); }

const startRequests = [];
const scoreRequests = [];
global.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  if (String(url).endsWith('/v1/run/start')) {
    const wait = deferred();
    startRequests.push({ body, wait });
    return wait.promise;
  }
  if (String(url).endsWith('/v1/scores')) {
    const wait = deferred();
    scoreRequests.push({ body, wait });
    return wait.promise;
  }
  throw new Error(`unexpected fetch: ${url}`);
};

const { Leaderboard } = await import('../src/game/leaderboard.js');

// A completed score must be sent with its own runId, and the next server
// session must wait until that score request has settled.
const board = new Leaderboard('https://api.test', 25);
board.startRun();
await tick();
assert.equal(startRequests.length, 1);
const firstRunId = startRequests[0].body.runId;
startRequests[0].wait.resolve(response({ runId: firstRunId, publicId: 'p_first' }));
await tick();

const submit = board.submit({ score: 100, distance: 20 });
await tick();
assert.equal(scoreRequests.length, 1);
assert.equal(scoreRequests[0].body.runId, firstRunId);

board.startRun();
const secondRunId = board.runId;
await tick();
assert.equal(startRequests.length, 1, 'new /run/start must wait for previous /scores');

scoreRequests[0].wait.resolve(response({ entries: [], me: null }));
await submit;
await tick();
assert.equal(startRequests.length, 2);
assert.equal(startRequests[1].body.runId, secondRunId);
startRequests[1].wait.resolve(response({ runId: secondRunId, publicId: 'p_second' }));
await tick();
assert.equal(board.runId, secondRunId);
assert.equal(board.runReady, true);

// Older start responses must not overwrite the newest run identity.
const reordered = new Leaderboard('https://api.test', 25);
reordered.startRun();
await tick();
const oldRequest = startRequests[2];
reordered.startRun();
await tick();
const newRequest = startRequests[3];
assert.ok(oldRequest && newRequest);
newRequest.wait.resolve(response({ runId: 'server-new', publicId: 'p_new' }));
await tick();
oldRequest.wait.resolve(response({ runId: 'server-old', publicId: 'p_old' }));
await tick();
assert.equal(reordered.runId, 'server-new');
assert.equal(reordered.publicId, 'p_new');

console.log('✓ leaderboard: submit/run ordering and stale start responses are safe');
