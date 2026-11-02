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

async function check({ reviews = [], body = '', merged = false, permission = 'write', head = 'current', apiError = false, author = 'author', authorId = 1, base = 'development', merger = { login: 'merger', id: 3, type: 'User' }, permissionByUser = {} } = {}) {
  const result = { failures: [], comments: [], reads: 0, logs: [] };
  const pr = { user: { login: author, id: authorId, type: 'User' }, base: { ref: base }, head: { sha: head }, body, merged, merged_by: merger, merged_at: '2026-11-02T03:32:40Z' };
  const github = {
    paginate: async () => reviews,
    rest: {
      pulls: { get: async () => { result.reads++; return { data: pr }; }, listReviews() {} },
      repos: { getCollaboratorPermissionLevel: async ({ username }) => {
        if (apiError) throw new Error('API unavailable');
        return { data: { permission: permissionByUser[username] || permission } };
      } },
      issues: { createComment: async ({ body }) => result.comments.push(body) },
    },
  };
  // Payload deliberately differs from current API data, as on old review events.
  await run(github, { repo: { owner: 'GeospanAI', repo: 'team-documentation' }, payload: { pull_request: { number: 16, head: { sha: 'old' } } } }, {
    info: message => result.logs.push(message), setFailed: message => result.failures.push(message),
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

const revision = 'a'.repeat(40);
const founders = [
  { author: 'beaugeospan', authorId: 227131098, role: 'CTO' },
  { author: 'juliageospan', authorId: 230599793, role: 'CEO' },
];
const record = (login, sha = revision) => `## Merge justification

**Exception authorised by:** @${login}, 2026-11-03.
**Revision:** ${sha}
**Reason and urgency:** This critical review enforcement repair needs prompt action to prevent unapproved stacked changes entering shared development branches.
**Alternative validation:** The regression fixtures passed locally and the required application checks must validate this exact revision before merge.
**Risk, owner and follow-up:** The author owns rollout verification, independent oversight, Vanta evidence and a reviewed rollback if the checks expose a regression.
`;
for (const founder of founders) {
  for (const base of ['development', 'Development', 'staging', 'Staging']) {
    test(`${founder.role} revision-bound exception passes on ${base}`, async () => {
      const result = await check({ ...founder, base, head: revision, body: record(founder.author) });
      assert.deepEqual(result.failures, []);
      assert.match(result.logs[0], new RegExp(`${founder.role} exception recorded`));
    });
  }
  for (const base of ['production', 'Production', 'main', 'feature/parent']) {
    test(`${founder.role} exception never passes on ${base}`, async () => {
      assert.equal((await check({ ...founder, base, head: revision, body: record(founder.author) })).failures.length, 1);
    });
  }
}
test('another author cannot claim either founder identity in justification text', async () => {
  assert.equal((await check({ head: revision, body: record('beaugeospan') })).failures.length, 1);
});
test('founder login without its verified account ID is rejected', async () => {
  assert.equal((await check({ author: 'beaugeospan', authorId: 999, head: revision, body: record('beaugeospan') })).failures.length, 1);
});
test('founder ID without its configured login is rejected', async () => {
  assert.equal((await check({ author: 'someone-else', authorId: 227131098, head: revision, body: record('someone-else') })).failures.length, 1);
});
for (const [label, mutate] of [
  ['stale revision', body => body.replace(revision, 'b'.repeat(40))],
  ['missing revision', body => body.replace(`**Revision:** ${revision}`, '')],
  ['wrong authorising account', body => body.replace('@beaugeospan', '@juliageospan')],
  ['missing approval date', body => body.replace('2026-11-03', '')],
  ['missing reason', body => body.replace(/\*\*Reason and urgency:\*\*[^\n]+/, '**Reason and urgency:**')],
  ['AI credit as reason', body => body.replace(/\*\*Reason and urgency:\*\*[^\n]+/, '**Reason and urgency:** Generated with Claude Code and nothing else is recorded here.')],
  ['template comment as validation', body => body.replace(/\*\*Alternative validation:\*\*[^\n]+/, '**Alternative validation:** <!-- Test results should be recorded here and must refer to this revision -->')],
  ['missing risk and owner', body => body.replace(/\*\*Risk, owner and follow-up:\*\*[^\n]+/, '')],
]) {
  test(`founder exception rejects ${label}`, async () => {
    assert.equal((await check({ ...founders[0], head: revision, body: mutate(record('beaugeospan')) })).failures.length, 1);
  });
}
test('founder without write permission cannot use an exception', async () => {
  assert.equal((await check({ ...founders[0], head: revision, body: record('beaugeospan'), permission: 'read' })).failures.length, 1);
});
test('blocking feedback on an earlier revision prevents a founder exception', async () => {
  const result = await check({ ...founders[0], head: revision, body: record('beaugeospan'),
    reviews: [approval({ state: 'CHANGES_REQUESTED', commit_id: 'old' })] });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /blocking changes requested/);
});
test('one approval cannot override another eligible reviewer requesting changes', async () => {
  const result = await check({ reviews: [approval(), approval({ id: 2, state: 'CHANGES_REQUESTED', user: { login: 'another-reviewer', type: 'User' } })] });
  assert.equal(result.failures.length, 1);
});
test('a read-only changes request does not override an eligible approval', async () => {
  const result = await check({ reviews: [approval(), approval({ id: 2, state: 'CHANGES_REQUESTED', user: { login: 'reader', type: 'User' } })], permissionByUser: { reader: 'read' } });
  assert.deepEqual(result.failures, []);
});
test('merged founder exception records actor, revision and target without inventing a review', async () => {
  const result = await check({ ...founders[0], head: revision, body: record('beaugeospan'), merged: true,
    merger: { id: 227131098, login: 'beaugeospan', type: 'User' } });
  assert.equal(result.comments.length, 1);
  assert.match(result.comments[0], /founder review exception record/);
  assert.match(result.comments[0], /without a current independent human approval/);
  assert.match(result.comments[0], new RegExp(revision));
});
test('an unlisted merger is not reported as a validated founder exception', async () => {
  const result = await check({ ...founders[0], head: revision, body: record('beaugeospan'), merged: true });
  assert.match(result.comments[0], /not verified as CTO-approved/);
  assert.doesNotMatch(result.comments[0], /founder review exception record/);
});
