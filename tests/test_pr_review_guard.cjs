const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Execute the actual inline Actions script against API fixtures, without tokens.
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/vanta-merge-justification.yml'), 'utf8').replace(/\r\n/g, '\n');
const script = workflow.split('          script: |\n')[1]
  .split('\n').map(line => line.startsWith('            ') ? line.slice(12) : line).join('\n');
const run = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'context', 'core', script);
const approval = (overrides = {}) => ({
  id: 1, state: 'APPROVED', commit_id: 'current',
  user: { login: 'reviewer', type: 'User' }, ...overrides,
});

async function check({ reviews = [], body = '', merged = false, permission = 'write', head = 'current', apiError = false } = {}) {
  const result = { failures: [], comments: [], reads: 0 };
  const pr = { user: { login: 'author' }, head: { sha: head }, body, merged, merged_by: { login: 'merger' }, merged_at: '2026-11-02T03:32:40Z' };
  const github = {
    paginate: async () => reviews,
    rest: {
      pulls: { get: async () => { result.reads++; return { data: pr }; }, listReviews() {} },
      repos: { getCollaboratorPermissionLevel: async () => {
        if (apiError) throw new Error('API unavailable');
        return { data: { permission } };
      } },
      issues: { createComment: async ({ body }) => result.comments.push(body) },
    },
  };
  // Payload deliberately differs from current API data, as on old review events.
  await run(github, { repo: { owner: 'GeospanAI', repo: 'team-documentation' }, payload: { pull_request: { number: 16, head: { sha: 'old' } } } }, {
    info() {}, setFailed: message => result.failures.push(message),
  });
  return result;
}

for (const body of ['', '## Merge justification\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  '## Merge justification\nA long self-written explanation of why this should bypass the review requirement.']) {
  test(`unreviewed PR fails regardless of justification: ${body.slice(0, 35)}`, async () => {
    const result = await check({ body });
    assert.equal(result.failures.length, 1);
    assert.equal(result.comments.length, 0);
  });
}
test('current independent human approval passes using live PR head', async () => {
  const result = await check({ reviews: [approval()] });
  assert.equal(result.reads, 1);
  assert.deepEqual(result.failures, []);
});
for (const review of [approval({ user: { login: 'AUTHOR', type: 'User' } }),
  approval({ user: { login: 'reviewer[bot]', type: 'Bot' } }), approval({ commit_id: 'old' })]) {
  test(`rejects self, bot or stale approval: ${JSON.stringify(review)}`, async () => {
    assert.equal((await check({ reviews: [review] })).failures.length, 1);
  });
}
for (const state of ['CHANGES_REQUESTED', 'DISMISSED']) {
  test(`later ${state} invalidates an earlier approval even with unsorted API data`, async () => {
    const reviews = [approval({ id: 2, state }), approval()];
    assert.equal((await check({ reviews })).failures.length, 1);
  });
}
test('a later comment preserves an existing approval', async () => {
  assert.deepEqual((await check({ reviews: [approval(), approval({ id: 2, state: 'COMMENTED' })] })).failures, []);
});
test('fresh reapproval after changes requested passes', async () => {
  assert.deepEqual((await check({ reviews: [approval({ state: 'CHANGES_REQUESTED' }), approval({ id: 2 })] })).failures, []);
});
test('read-only reviewers cannot satisfy team review', async () => {
  assert.equal((await check({ reviews: [approval()], permission: 'read' })).failures.length, 1);
});
test('permission lookup failure fails closed', async () => {
  await assert.rejects(check({ reviews: [approval()], apiError: true }), /API unavailable/);
});
test('stack changed head requires new approval of the combined revision', async () => {
  assert.equal((await check({ reviews: [approval()], head: 'combined-stack' })).failures.length, 1);
});
test('merged PR audit excludes AI credits and template comments', async () => {
  const result = await check({ merged: true, body: '## Merge justification\n<!-- approved template -->\n🤖 Generated with Claude Code\n' });
  assert.equal(result.comments.length, 1);
  assert.match(result.comments[0], /None recorded/);
  assert.doesNotMatch(result.comments[0], /Generated with Claude/);
});
test('audit includes exception text without asserting approval and stops at next heading', async () => {
  const result = await check({ merged: true, body: '## Merge justification\nIncident evidence and alternative validation.\n## Follow-up\nUnrelated content.' });
  assert.match(result.comments[0], /Incident evidence and alternative validation/);
  assert.match(result.comments[0], /not verified as CTO-approved/);
  assert.doesNotMatch(result.comments[0], /Unrelated content/);
});
test('reviewed merge does not create an exception record', async () => {
  assert.deepEqual((await check({ merged: true, reviews: [approval()] })).comments, []);
});
