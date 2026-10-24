import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import packageJson from '../package.json' with { type: 'json' };
import { test, type TestContext } from 'node:test';
import { FileExecutor } from '../src/main/executor.js';
import { computeFileFingerprint, sanitizeError } from '../src/main/fingerprint.js';
import { UndoJournal } from '../src/main/journal.js';
import { InferenceQueue } from '../src/main/queue.js';
import { OllamaClient } from '../src/ollamaClient.js';
import type { ScannedFile, StagedItem } from '../src/types.js';

const proposal = {
  category: 'Documents' as const,
  suggestedFilename: 'organized.txt',
  proposedDestination: 'Documents',
  confidence: 'high' as const,
  reasoning: 'Synthetic regression fixture.'
};

async function fixture(t: TestContext) {
  const sandbox = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'slothsort-hardening-'));
  t.after(() => fs.promises.rm(sandbox, { recursive: true, force: true }));
  const root = path.join(sandbox, 'root');
  const outside = path.join(sandbox, 'outside');
  await fs.promises.mkdir(path.join(root, 'inbox'), { recursive: true });
  await fs.promises.mkdir(outside);
  const source = path.join(root, 'inbox', 'original.txt');
  await fs.promises.writeFile(source, 'original fixture bytes');
  const fingerprint = await computeFileFingerprint(source);
  const file: ScannedFile = {
    id: 'fixture', relativePath: 'inbox/original.txt', absolutePath: source,
    metadata: { filename: 'original.txt', extension: '.txt', sizeBytes: fingerprint.sizeBytes, sourceFingerprint: fingerprint }
  };
  const queue = new InferenceQueue(new OllamaClient({ model: 'gemma3:4b' }));
  const item: StagedItem = {
    id: file.id, file, analysisStatus: 'completed', reviewStatus: 'pending_review',
    proposal: { ...proposal }, sourceFingerprint: fingerprint
  };
  queue.addStagedItem(item);
  queue.updateReview(item.id, 'approved');
  const journal = new UndoJournal(path.join(sandbox, 'journal.jsonl'));
  const executor = new FileExecutor({ queue, journal });
  const destination = path.join(root, 'Documents', 'organized.txt');
  return { root, outside, source, destination, fingerprint, item, queue, journal, executor };
}

test('execution refuses a destination directory link outside the selected root', async (t) => {
  const f = await fixture(t);
  await fs.promises.symlink(f.outside, path.dirname(f.destination), 'junction');
  const result = await f.executor.executeApprovedBatch(f.root, [f.item.id]);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /security|symlink/i);
  assert.equal(await fs.promises.readFile(f.source, 'utf8'), 'original fixture bytes');
  assert.deepEqual(await fs.promises.readdir(f.outside), []);
});

test('execution refuses an approved item without a scan-time fingerprint', async (t) => {
  const f = await fixture(t);
  f.item.sourceFingerprint = undefined;
  const result = await f.executor.executeApprovedBatch(f.root, [f.item.id]);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /fingerprint|rescan/i);
  assert.ok(fs.existsSync(f.source));
  assert.ok(!fs.existsSync(f.destination));
});

test('review state rejects premature approval and invalid edited proposals', async (t) => {
  const f = await fixture(t);
  f.item.reviewStatus = 'pending_review';
  f.item.approvedProposalSignature = undefined;
  f.item.analysisStatus = 'analyzing';
  assert.equal(f.queue.updateReview(f.item.id, 'approved'), false);

  f.item.analysisStatus = 'completed';
  assert.equal(
    f.queue.updateReview(f.item.id, 'edited', { ...proposal, confidence: 'invalid' as never }),
    false
  );
  assert.equal(f.item.reviewStatus, 'pending_review');
});

test('a destination created after the preflight collision check is never overwritten', async (t) => {
  const f = await fixture(t);
  const recordIntent = f.journal.recordIntent.bind(f.journal);
  t.mock.method(f.journal, 'recordIntent', async (...args: Parameters<typeof recordIntent>) => {
    await recordIntent(...args);
    await fs.promises.mkdir(path.dirname(f.destination), { recursive: true });
    await fs.promises.writeFile(f.destination, 'competing writer bytes');
  });
  const result = await f.executor.executeApprovedBatch(f.root, [f.item.id]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].isCollision, true);
  assert.equal(await fs.promises.readFile(f.destination, 'utf8'), 'competing writer bytes');
  assert.equal(await fs.promises.readFile(f.source, 'utf8'), 'original fixture bytes');
});

test('undo refuses an original directory replaced with an outside junction', async (t) => {
  const f = await fixture(t);
  const moved = await f.executor.executeApprovedBatch(f.root, [f.item.id]);
  assert.equal(moved.successful.length, 1);
  await fs.promises.rmdir(path.dirname(f.source));
  await fs.promises.symlink(f.outside, path.dirname(f.source), 'junction');
  const result = await f.executor.undoOperation(moved.successful[0].id);
  assert.equal(result.success, false);
  assert.match(result.error!, /security|symlink/i);
  assert.ok(fs.existsSync(f.destination));
  assert.deepEqual(await fs.promises.readdir(f.outside), []);
});

test('undo refuses a moved directory replaced with an outside junction', async (t) => {
  const f = await fixture(t);
  const moved = await f.executor.executeApprovedBatch(f.root, [f.item.id]);
  assert.equal(moved.successful.length, 1);
  const outsideCopy = path.join(f.outside, 'organized.txt');
  await fs.promises.rename(f.destination, outsideCopy);
  await fs.promises.rmdir(path.dirname(f.destination));
  await fs.promises.symlink(f.outside, path.dirname(f.destination), 'junction');
  const result = await f.executor.undoOperation(moved.successful[0].id);
  assert.equal(result.success, false);
  assert.ok(fs.existsSync(outsideCopy));
  assert.ok(!fs.existsSync(f.source));
});

test('an applied item cannot be replayed after undo without a fresh scan and approval', async (t) => {
  const f = await fixture(t);
  const moved = await f.executor.executeApprovedBatch(f.root, [f.item.id]);
  assert.equal((await f.executor.undoOperation(moved.successful[0].id)).success, true);
  const result = await f.executor.executeApprovedBatch(f.root, [f.item.id]);
  assert.equal(result.successful.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.ok(fs.existsSync(f.source));
});

test('error redaction removes the value rather than echoing it as the key', () => {
  const result = sanitizeError(new Error('token=synthetic-token&password=synthetic-password key=synthetic-key'));
  assert.equal(result, 'token=[REDACTED]&password=[REDACTED] key=[REDACTED]');
});

test('production renderer has no remote font resources or font CSP exceptions', async () => {
  const html = await fs.promises.readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  const main = await fs.promises.readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /(?:href|src)=["']https?:/i);
  assert.doesNotMatch(main, /fonts\.(googleapis|gstatic)\.com/);
});

test('electron-builder package inputs exclude recursive release and package outputs', () => {
  const files = packageJson.build?.files ?? [];
  assert.deepEqual(files, ['dist/*.js', 'dist/main/**/*', 'dist/renderer/**/*', 'package.json']);
  assert.equal(files.includes('dist/**/*'), false);
});
