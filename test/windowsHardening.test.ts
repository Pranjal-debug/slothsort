import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { FileExecutor } from '../src/main/executor.js';
import { computeFileFingerprint } from '../src/main/fingerprint.js';
import { UndoJournal } from '../src/main/journal.js';
import { InferenceQueue } from '../src/main/queue.js';
import { OllamaClient } from '../src/ollamaClient.js';
import type { ScannedFile, StagedItem } from '../src/types.js';

const WINDOWS_TEST_ROOT = 'D:\\SlothSort-Day2-Windows-Regression';
const CROSS_VOLUME_ROOT = 'C:\\SlothSort-Day2-CrossVolume';

function canUseCrossVolumeDestination(): boolean {
  if (process.platform !== 'win32') return false;

  try {
    fs.mkdirSync(CROSS_VOLUME_ROOT, { recursive: true });
    const probe = path.join(CROSS_VOLUME_ROOT, `.probe-${process.pid}`);
    fs.writeFileSync(probe, 'synthetic probe');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

const crossVolumeAvailable = canUseCrossVolumeDestination();

async function createCrossVolumeFixture(t: TestContext) {
  fs.mkdirSync(WINDOWS_TEST_ROOT, { recursive: true });
  const sourceWorkspace = await fs.promises.mkdtemp(path.join(WINDOWS_TEST_ROOT, 'source-'));
  const destinationWorkspace = await fs.promises.mkdtemp(path.join(CROSS_VOLUME_ROOT, 'dest-'));
  t.after(async () => {
    await fs.promises.rm(sourceWorkspace, { recursive: true, force: true });
    await fs.promises.rm(destinationWorkspace, { recursive: true, force: true });
  });

  const sourcePath = path.join(sourceWorkspace, 'payload.txt');
  const destinationPath = path.join(destinationWorkspace, 'payload.txt');
  await fs.promises.writeFile(sourcePath, 'synthetic cross-volume payload');
  const fingerprint = await computeFileFingerprint(sourcePath);
  const queue = new InferenceQueue(new OllamaClient({ model: 'gemma3:4b' }));
  const journal = new UndoJournal(path.join(sourceWorkspace, 'operations.jsonl'));
  const executor = new FileExecutor({ queue, journal });

  return { sourceWorkspace, destinationWorkspace, sourcePath, destinationPath, fingerprint, executor };
}

async function runCrossVolumeMove(
  executor: FileExecutor,
  sourcePath: string,
  destinationPath: string,
  fingerprint: Awaited<ReturnType<typeof computeFileFingerprint>>
): Promise<void> {
  // The public executor only permits destinations inside the selected root.
  // This direct call exercises its private cross-volume primitive with synthetic paths.
  await (executor as unknown as {
    crossVolumeMove: (source: string, destination: string, expected: typeof fingerprint) => Promise<void>;
  }).crossVolumeMove(sourcePath, destinationPath, fingerprint);
}

async function tempFilesFor(destinationPath: string): Promise<string[]> {
  const names = await fs.promises.readdir(path.dirname(destinationPath));
  return names
    .filter((name) => name.startsWith(`${path.basename(destinationPath)}.tmp.`))
    .map((name) => path.join(path.dirname(destinationPath), name));
}

test('Windows/NTFS cross-volume move succeeds with exact bytes and source removal', { skip: !crossVolumeAvailable }, async (t) => {
  const fixture = await createCrossVolumeFixture(t);
  await runCrossVolumeMove(fixture.executor, fixture.sourcePath, fixture.destinationPath, fixture.fingerprint);

  assert.equal(await fs.promises.readFile(fixture.destinationPath, 'utf8'), 'synthetic cross-volume payload');
  assert.equal(fs.existsSync(fixture.sourcePath), false);
  assert.deepEqual(await tempFilesFor(fixture.destinationPath), []);
});

test('cross-volume copy failure preserves source and cleans temporary files', { skip: !crossVolumeAvailable }, async (t) => {
  const fixture = await createCrossVolumeFixture(t);
  const originalCopyFile = fs.promises.copyFile;
  (fs.promises as any).copyFile = async () => {
    const error: NodeJS.ErrnoException = new Error('synthetic copy failure');
    error.code = 'EIO';
    throw error;
  };

  try {
    await assert.rejects(
      runCrossVolumeMove(fixture.executor, fixture.sourcePath, fixture.destinationPath, fixture.fingerprint),
      /synthetic copy failure/
    );
  } finally {
    (fs.promises as any).copyFile = originalCopyFile;
  }

  assert.equal(fs.existsSync(fixture.sourcePath), true);
  assert.equal(fs.existsSync(fixture.destinationPath), false);
  assert.deepEqual(await tempFilesFor(fixture.destinationPath), []);
});

test('cross-volume verification failure preserves source and cleans temporary files', { skip: !crossVolumeAvailable }, async (t) => {
  const fixture = await createCrossVolumeFixture(t);
  const wrongFingerprint = { ...fixture.fingerprint, sha256: '0'.repeat(64) };

  await assert.rejects(
    runCrossVolumeMove(fixture.executor, fixture.sourcePath, fixture.destinationPath, wrongFingerprint),
    /checksum does not match/
  );

  assert.equal(fs.existsSync(fixture.sourcePath), true);
  assert.equal(fs.existsSync(fixture.destinationPath), false);
  assert.deepEqual(await tempFilesFor(fixture.destinationPath), []);
});

test('cross-volume finalization failure preserves source and cleans temporary files', { skip: !crossVolumeAvailable }, async (t) => {
  const fixture = await createCrossVolumeFixture(t);
  const originalLink = fs.promises.link;
  (fs.promises as any).link = async (_source: string, destination: string) => {
    const error: NodeJS.ErrnoException = new Error('synthetic finalization failure');
    error.code = 'EIO';
    if (destination === fixture.destinationPath) throw error;
    return originalLink(_source, destination);
  };

  try {
    await assert.rejects(
      runCrossVolumeMove(fixture.executor, fixture.sourcePath, fixture.destinationPath, fixture.fingerprint),
      /synthetic finalization failure/
    );
  } finally {
    (fs.promises as any).link = originalLink;
  }

  assert.equal(fs.existsSync(fixture.sourcePath), true);
  assert.equal(fs.existsSync(fixture.destinationPath), false);
  assert.deepEqual(await tempFilesFor(fixture.destinationPath), []);
});

test('cross-volume source-removal failure rolls back the destination copy', { skip: !crossVolumeAvailable }, async (t) => {
  const fixture = await createCrossVolumeFixture(t);
  const originalUnlink = fs.promises.unlink;
  (fs.promises as any).unlink = async (target: string) => {
    if (target === fixture.sourcePath) {
      const error: NodeJS.ErrnoException = new Error('synthetic source removal failure');
      error.code = 'EACCES';
      throw error;
    }
    return originalUnlink(target);
  };

  try {
    await assert.rejects(
      runCrossVolumeMove(fixture.executor, fixture.sourcePath, fixture.destinationPath, fixture.fingerprint),
      /Failed to remove original source file.*synthetic source removal failure/
    );
  } finally {
    (fs.promises as any).unlink = originalUnlink;
  }

  assert.equal(fs.existsSync(fixture.sourcePath), true);
  assert.equal(fs.existsSync(fixture.destinationPath), false);
  assert.deepEqual(await tempFilesFor(fixture.destinationPath), []);
});
