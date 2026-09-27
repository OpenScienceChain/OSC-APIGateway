#!/usr/bin/env node
// Local-only, operator-run example seed. No credentials or file contents are saved.
import { createHash } from 'node:crypto';

const argumentsList = process.argv.slice(2);
const option = (name) => {
  const index = argumentsList.indexOf(name);
  return index < 0 ? undefined : argumentsList[index + 1];
};
const runId = option('--run-id');
const baseUrl = option('--base-url');
const origin = option('--origin');
const execute = argumentsList.includes('--execute');
if (!runId || !baseUrl || !origin) {
  throw new Error('Usage: node scripts/seed-demo-artifact-history.mjs --run-id ID --base-url http://127.0.0.1:PORT --origin ORIGIN [--execute]');
}
const base = new URL(baseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
    !['http:', 'https:'].includes(base.protocol)) {
  throw new Error('The seed tool accepts only a local Gateway URL');
}
const url = (path) => new URL(`/api/v1/demo/${path}`, base).toString();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const requestId = (value) => {
  const hex = hash(`${runId}:${value}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const examples = [
  {
    organization: 'neuroscience-gateway',
    label: 'Reproducible neuroscience analysis',
    context: 'REPRODUCIBLE_ANALYSIS',
    keyword: 'neuroscience',
  },
  {
    organization: 'citizen-science',
    label: 'Citizen-science observation dataset',
    context: 'RESEARCH_DATASET',
    keyword: 'citizen-science',
  },
].map((example) => ({
  ...example,
  title: `US-RSE 2026 example ${hash(runId).slice(0, 8)}: ${example.label}`,
}));

if (!execute) {
  process.stdout.write(`Dry run for ${runId}: two local Gateway examples, one per organization, each with create + two confirmed edits.\n`);
  for (const example of examples) process.stdout.write(`${example.organization}: ${example.title}\n`);
  process.stdout.write('Pass --execute only when the exact run is OPEN and the local Fabric stack is ready.\n');
  process.exit(0);
}

const readJson = async (path, method = 'GET', body, session) => {
  const headers = { accept: 'application/json' };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    headers.origin = origin;
  }
  if (session) {
    headers.cookie = session.cookie;
    if (body !== undefined) headers['x-demo-csrf'] = session.csrfToken;
  }
  const response = await fetch(url(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${path}: HTTP ${response.status} ${JSON.stringify(result)}`);
  }
  return { response, result };
};
const cookieFrom = (response) => {
  const value = response.headers.get('set-cookie') || '';
  const match = value.match(/(?:^|,\s*)(__Host-osc_demo=[^;]+)/);
  if (!match) throw new Error('Gateway did not return the guest session cookie');
  return match[1];
};
const credentialsFor = async (organization) => {
  const prefix = organization === 'neuroscience-gateway' ? 'NEUROSCIENCE' : 'CITIZEN_SCIENCE';
  const cookie = process.env[`DEMO_SEED_${prefix}_COOKIE`];
  const csrfToken = process.env[`DEMO_SEED_${prefix}_CSRF`];
  if (cookie || csrfToken) {
    if (!cookie || !csrfToken) throw new Error(`Both resume credentials for ${organization} are required`);
    return { cookie, csrfToken, expiresAt: 0 };
  }
  const { response, result } = await readJson('session', 'POST', { organization });
  return { cookie: cookieFrom(response), csrfToken: result.csrfToken,
    expiresAt: Date.parse(result.expiresAt) };
};
const refreshIfNeeded = async (session) => {
  if (session.expiresAt && session.expiresAt - Date.now() > 5 * 60_000) return;
  const { response, result } = await readJson('session/refresh', 'POST', {}, session);
  session.cookie = cookieFrom(response);
  session.csrfToken = result.csrfToken;
  session.expiresAt = Date.parse(result.expiresAt);
};
const waitForRevision = async (id, minimum, previousTxId) => {
  const until = Date.now() + 8 * 60_000;
  while (Date.now() < until) {
    const detail = (await readJson(`public/artifacts/${id}`)).result;
    if (detail.submissionState === 'FAILED') throw new Error(`Artifact ${id} failed ledger submission`);
    if (detail.submissionState === 'SUCCESS' && detail.blockchainTxId &&
        detail.blockchainTxId !== previousTxId) {
      const history = (await readJson(`public/artifacts/${id}/history`)).result;
      if (Array.isArray(history.items) && history.items.length >= minimum &&
          history.items.some((item) => item.snapshot?.submissionComment)) {
        return detail.blockchainTxId;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for artifact ${id} ledger revision ${minimum}`);
};

const status = (await readJson('status')).result;
if (status.state !== 'OPEN' || status.runId !== runId) {
  throw new Error('The exact requested demonstration run is not OPEN');
}
for (const example of examples) {
  const listed = (await readJson(`artifacts?organization=${example.organization}`)).result;
  const matching = listed.filter((item) => item.title === example.title);
  if (matching.length > 1) throw new Error(`Duplicate seed title for ${example.organization}; investigate before retrying`);
  const prefix = example.organization === 'neuroscience-gateway' ? 'NEUROSCIENCE' : 'CITIZEN_SCIENCE';
  if (matching.length && !process.env[`DEMO_SEED_${prefix}_COOKIE`]) {
    const history = (await readJson(`public/artifacts/${matching[0].id}/history`)).result;
    if (history.items?.length >= 3) {
      process.stdout.write(`${example.organization}: already complete (${matching[0].id})\n`);
      continue;
    }
    throw new Error(`Incomplete ${example.organization} seed belongs to its original guest session. Supply its short-lived resume cookie and CSRF via environment, or start a new run.`);
  }
  const session = await credentialsFor(example.organization);
  let id = matching[0]?.id;
  if (!id) {
    const created = (await readJson('artifacts', 'POST', {
      requestId: requestId(`${example.organization}:create`),
      fingerprint: hash(`${runId}:${example.organization}:example-file`),
      sizeBytes: 256,
      extension: 'txt',
      researchContext: example.context,
      title: example.title,
      description: `A clearly labeled, synthetic ${example.label.toLowerCase()} example for the US-RSE 2026 portal demonstration. No participant file is stored.`,
      submissionComment: 'Initial example metadata submitted through the guest Gateway.',
      keywords: [example.keyword, 'synthetic-example'],
    }, session)).result;
    id = created.id;
  }
  let history = (await readJson(`public/artifacts/${id}/history`)).result;
  let count = Array.isArray(history.items) ? history.items.length : 0;
  let txId = null;
  if (count < 1) txId = await waitForRevision(id, 1, null);
  else txId = (await readJson(`public/artifacts/${id}`)).result.blockchainTxId;
  for (let editNumber = Math.max(1, count); editNumber <= 2; editNumber += 1) {
    await refreshIfNeeded(session);
    await readJson(`artifacts/${id}`, 'PATCH', {
      requestId: requestId(`${example.organization}:edit:${editNumber}`),
      submissionComment: `Example revision ${editNumber + 1} confirms the public provenance history.`,
      keywords: [example.keyword, 'synthetic-example', `revision-${editNumber + 1}`],
    }, session);
    txId = await waitForRevision(id, editNumber + 1, txId);
    history = (await readJson(`public/artifacts/${id}/history`)).result;
    count = history.items.length;
  }
  process.stdout.write(`${example.organization}: ${id}, ${count} confirmed ledger revisions\n`);
}
