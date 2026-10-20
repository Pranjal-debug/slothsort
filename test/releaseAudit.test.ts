import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FileExecutor } from '../src/main/executor.js';
import { computeFileFingerprint, computeProposalSignature } from '../src/main/fingerprint.js';
import { UndoJournal } from '../src/main/journal.js';
import { InferenceQueue } from '../src/main/queue.js';
import { scanFolder } from '../src/main/scanner.js';
import { OllamaClient } from '../src/ollamaClient.js';
import { ScannedFile, StagedItem } from '../src/types.js';

console.log('='.repeat(70));
console.log('SLOTHSORT PHASE 3: RELEASE READINESS AUDIT & E2E VERIFICATION');
console.log('='.repeat(70));

let totalPassed = 0;
let totalTests = 0;

function assert(description: string, condition: boolean, detail?: string) {
  totalTests++;
  if (condition) {
    totalPassed++;
    console.log(`  ✓ PASS: ${description}`);
  } else {
    console.error(`  ✗ FAIL: ${description} ${detail ? `(${detail})` : ''}`);
  }
}

// Mock client for deterministic and fast E2E simulation
class DeterministicAuditClient extends OllamaClient {
  constructor() {
    super({ model: 'gemma3:4b' });
  }
  override async verifyModelInstalled(): Promise<boolean> {
    return true;
  }
  override async classify(metadata: any): Promise<{ rawText: string }> {
    const filename = metadata.filename.toLowerCase();
    if (filename.includes('invoice') || filename.includes('report') || filename.endsWith('.txt') || filename.endsWith('.pdf')) {
      return {
        rawText: JSON.stringify({
          category: 'Documents',
          suggestedFilename: '2026_Q4_Audited_Report.txt',
          proposedDestination: 'Documents/Finance',
          confidence: 'high',
          reasoning: 'Financial business document'
        })
      };
    }
    return {
      rawText: JSON.stringify({
        category: 'Other',
        suggestedFilename: metadata.filename,
        proposedDestination: 'Organized',
        confidence: 'medium',
        reasoning: 'Generic file'
      })
    };
  }
}

async function runReleaseAudit() {
  const sandboxDir = path.resolve('./temp_release_audit_sandbox');
  const journalDir = path.resolve('./temp_release_audit_journal');
  const journalFile = path.join(journalDir, 'audit_operations.jsonl');

  if (fs.existsSync(sandboxDir)) fs.rmSync(sandboxDir, { recursive: true, force: true });
  if (fs.existsSync(journalDir)) fs.rmSync(journalDir, { recursive: true, force: true });

  fs.mkdirSync(sandboxDir, { recursive: true });
  fs.mkdirSync(journalDir, { recursive: true });

  try {
    // ------------------------------------------------------------------------
    // SECTION 1: Full E2E Workflow (Scan -> Queue -> Review -> Apply -> Restart -> Undo)
    // ------------------------------------------------------------------------
    console.log('\n--- 1. Full End-to-End Workflow & Lifecycle ---');

    // Create synthetic files in sandbox
    const docFile = path.join(sandboxDir, 'Unsorted_Invoice_2026.txt');
    const secretFile = path.join(sandboxDir, '.env.production');
    const cookieFile = path.join(sandboxDir, 'cookies.sqlite');
    fs.writeFileSync(docFile, 'Invoice content: Services rendered $5,000. Balance due: $0.');
    fs.writeFileSync(secretFile, 'DATABASE_PASSWORD=SuperSecretProductionKey999!');
    fs.writeFileSync(cookieFile, 'session_token=abcdef1234567890');

    // 1A. Scan folder
    const scanResult = await scanFolder(sandboxDir);
    assert('Discovered files including normal and sensitive', scanResult.files.length >= 3);

    const docScanned = scanResult.files.find((f) => f.metadata.filename === 'Unsorted_Invoice_2026.txt')!;
    const envScanned = scanResult.files.find((f) => f.metadata.filename === '.env.production')!;
    const cookieScanned = scanResult.files.find((f) => f.metadata.filename === 'cookies.sqlite')!;

    assert('Normal document has text excerpt', docScanned.metadata.textExcerpt !== undefined);
    assert('Sensitive .env has text excerpt strictly suppressed', envScanned.metadata.textExcerpt === undefined);
    assert('Sensitive .env is flagged as sensitive', envScanned.metadata.isSensitiveExcluded === true);
    assert('Browser cookies file has text excerpt strictly suppressed', cookieScanned.metadata.textExcerpt === undefined);
    assert('Browser cookies file is flagged as sensitive', cookieScanned.metadata.isSensitiveExcluded === true);

    // 1B. Queue inference
    const client = new DeterministicAuditClient();
    const queue = new InferenceQueue(client);
    await queue.enqueue([docScanned]);

    // Await queue analysis completion
    for (let i = 0; i < 30; i++) {
      const stats = queue.getStats();
      if (stats.completed >= 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const stagedDoc = queue.getItem(docScanned.id)!;
    assert('Inference completed in queue', stagedDoc.analysisStatus === 'completed');
    assert('Proposal received from local model', stagedDoc.proposal?.suggestedFilename === '2026_Q4_Audited_Report.txt');

    // 1C. Review and Approval
    assert('Default review status is pending_review', stagedDoc.reviewStatus === 'pending_review');

    // Approve the proposal
    queue.updateReview(docScanned.id, 'approved');
    assert('Review status is approved', queue.getItem(docScanned.id)?.reviewStatus === 'approved');
    assert('Approval signature generated', Boolean(queue.getItem(docScanned.id)?.approvedProposalSignature));

    // 1D. Execution
    const journal = new UndoJournal(journalFile);
    await journal.init();
    const executor = new FileExecutor({ queue, journal });

    const execResult = await executor.executeApprovedBatch(sandboxDir, [docScanned.id]);
    assert('Batch execution succeeded', execResult.successful.length === 1);
    assert('Zero failures during approved move', execResult.failed.length === 0);

    const destExpected = path.join(sandboxDir, 'Documents', 'Finance', '2026_Q4_Audited_Report.txt');
    assert('Destination file exists', fs.existsSync(destExpected));
    assert('Original source file unlinked', !fs.existsSync(docScanned.absolutePath));

    const originalFingerprint = docScanned.metadata.sourceFingerprint!;
    const destFingerprint = await computeFileFingerprint(destExpected);
    assert('Cryptographic SHA-256 checksum preserved after move', destFingerprint.sha256 === originalFingerprint.sha256);

    // 1E. Application Restart Simulation & History Reload
    console.log('\n--- 2. Application Restart Simulation & History Reload ---');
    const restartedJournal = new UndoJournal(journalFile);
    await restartedJournal.init();

    const history = restartedJournal.getAllOperations(sandboxDir);
    assert('History loaded from persistent JSONL journal', history.length >= 1);
    const lastOp = history[0];
    assert('Restored operation status is completed', lastOp.status === 'completed');
    assert('Recorded source and destination fingerprints match', lastOp.sourceFingerprint.sha256 === destFingerprint.sha256);

    // 1F. Verifiable Undo
    console.log('\n--- 3. Verifiable Undo & Integrity Restoration ---');
    const undoExecutor = new FileExecutor({ queue, journal: restartedJournal });
    const undoRes = await undoExecutor.undoOperation(lastOp.id);
    assert('Undo executed successfully', undoRes.success === true);
    assert('Original file restored at original path', fs.existsSync(docScanned.absolutePath));
    assert('Moved destination file removed', !fs.existsSync(destExpected));

    const restoredFingerprint = await computeFileFingerprint(docScanned.absolutePath);
    assert('Restored file SHA-256 matches initial pre-move checksum exactly', restoredFingerprint.sha256 === originalFingerprint.sha256);

    // Repeated undo is idempotent
    const repeatUndo = await undoExecutor.undoOperation(lastOp.id);
    assert('Repeated undo is idempotent and succeeds without error', repeatUndo.success === true);

    // ------------------------------------------------------------------------
    // SECTION 2: JSONL Recovery for Truncated Final Record & Safe Subsequent Append
    // ------------------------------------------------------------------------
    console.log('\n--- 4. JSONL Recovery for Truncated Records & Safe Subsequent Appends ---');

    const testJournalFile = path.join(journalDir, 'recovery_test.jsonl');
    const initialOpRecord = {
      id: 'op_valid_01',
      stagedItemId: 'item_01',
      timestamp: new Date().toISOString(),
      rootPath: sandboxDir,
      sourceRelativePath: 'file1.txt',
      destinationRelativePath: 'Documents/file1.txt',
      sourceAbsolutePath: path.join(sandboxDir, 'file1.txt'),
      destinationAbsolutePath: path.join(sandboxDir, 'Documents', 'file1.txt'),
      originalFilename: 'file1.txt',
      newFilename: 'file1.txt',
      category: 'Documents' as const,
      proposalSignature: 'sig01',
      sourceFingerprint: { sizeBytes: 100, mtimeMs: Date.now(), sha256: 'abc' },
      status: 'completed' as const
    };

    // Write valid record 1
    fs.writeFileSync(testJournalFile, JSON.stringify(initialOpRecord) + '\n', 'utf8');

    // Simulate an abrupt system crash: append a truncated incomplete record without a newline
    fs.appendFileSync(testJournalFile, '{"id":"op_interrupted_crash","stagedItemId":"item_crash","status":"pend', 'utf8');

    // Initialize journal over corrupt file
    const corruptJournal = new UndoJournal(testJournalFile);
    await corruptJournal.init();

    // Verify valid history was preserved
    assert('Valid prior history preserved despite trailing corrupt line', corruptJournal.getOperation('op_valid_01') !== undefined);

    // Now perform a safe subsequent append!
    const subsequentOpRecord = {
      ...initialOpRecord,
      id: 'op_valid_02',
      originalFilename: 'file2.txt'
    };
    await corruptJournal.recordIntent(subsequentOpRecord);

    // Re-read file lines directly from disk
    const rawDisk = fs.readFileSync(testJournalFile, 'utf8').trim().split(/\r?\n/);
    assert('Sanitized journal contains only valid JSON lines', rawDisk.every((line) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    }));

    const parsedLast = JSON.parse(rawDisk[rawDisk.length - 1]);
    assert('Subsequent appended record is uncorrupted and parseable', parsedLast.id === 'op_valid_02');

    // ------------------------------------------------------------------------
    // SECTION 3: Cross-Volume Moves & Not Assuming EPERM means EXDEV
    // ------------------------------------------------------------------------
    console.log('\n--- 5. Cross-Volume Fallback & File Lock Auditing ---');

    // Create a synthetic file
    const lockTestFile = path.join(sandboxDir, 'lock_test.txt');
    fs.writeFileSync(lockTestFile, 'Content to test lock handling');
    const lockFp = await computeFileFingerprint(lockTestFile);

    // Mock rename to simulate an EPERM / EBUSY error on the SAME volume (e.g. file locked by another program)
    const originalRename = fs.promises.rename;
    try {
      (fs.promises as any).rename = async () => {
        const err: any = new Error('EPERM: operation not permitted');
        err.code = 'EPERM';
        throw err;
      };

      let threwExpectedError = false;
      try {
        // When source and destination are on the same drive volume, safeMoveFile must NOT assume EPERM means EXDEV
        await executor.safeMoveFile(lockTestFile, path.join(sandboxDir, 'Locked_Dest.txt'), lockFp);
      } catch (err: any) {
        if (err.code === 'EPERM') {
          threwExpectedError = true;
        }
      }
      assert('EPERM on same volume throws cleanly and does NOT fall back to cross-volume copy', threwExpectedError);
      assert('Original locked file was preserved untouched', fs.existsSync(lockTestFile));
    } finally {
      (fs.promises as any).rename = originalRename;
    }

    // ------------------------------------------------------------------------
    // SECTION 4: Security Protections & Forged Request Rejection
    // ------------------------------------------------------------------------
    console.log('\n--- 6. Security & Negative Attack Rejection ---');

    // 4A. Forged IPC root path (traversal attempt)
    let rejectedBadRoot = false;
    try {
      await executor.executeApprovedBatch('D:/NonExistent/../../InvalidDir_123', ['some_id']);
    } catch {
      rejectedBadRoot = true;
    }
    assert('Invalid/traversal root directory rejected', rejectedBadRoot);

    // 4B. Forged item ID not in trusted queue
    const forgedIdRes = await executor.executeApprovedBatch(sandboxDir, ['forged_item_id_9999']);
    assert('Forged item ID rejected/skipped', forgedIdRes.skipped.length === 1);
    assert('Reason indicates item not in active session queue', forgedIdRes.skipped[0].reason.includes('Item not found'));

    // 4C. Stale approval rejection (proposal altered after approval)
    const staleFile = path.join(sandboxDir, 'stale_test.txt');
    fs.writeFileSync(staleFile, 'Stale test content');
    const staleFp = await computeFileFingerprint(staleFile);

    const staleItem: StagedItem = {
      id: 'stale_id_01',
      file: {
        id: 'stale_id_01',
        relativePath: 'stale_test.txt',
        absolutePath: staleFile,
        metadata: { filename: 'stale_test.txt', extension: '.txt', sizeBytes: staleFp.sizeBytes, sourceFingerprint: staleFp }
      },
      analysisStatus: 'completed',
      reviewStatus: 'approved',
      // Old approved signature for "Old_Name.txt"
      approvedProposalSignature: computeProposalSignature('stale_test.txt', 'Documents', 'Documents', 'Old_Name.txt'),
      proposal: {
        category: 'Documents',
        suggestedFilename: 'Altered_Name_After_Approval.txt',
        proposedDestination: 'Documents',
        confidence: 'high',
        reasoning: 'Doc'
      },
      sourceFingerprint: staleFp
    };
    queue.addStagedItem(staleItem);

    const staleExecRes = await executor.executeApprovedBatch(sandboxDir, ['stale_id_01']);
    assert('Stale approval with modified proposal rejected', staleExecRes.skipped.length === 1);
    assert('Reason explains proposal modified after approval', staleExecRes.skipped[0].reason.includes('Stale approval'));

    // 4D. Modified source file (tampering / checksum mismatch)
    const tamperedFile = path.join(sandboxDir, 'tamper_test.txt');
    fs.writeFileSync(tamperedFile, 'Initial content');
    const initialTamperFp = await computeFileFingerprint(tamperedFile);

    const tamperItem: StagedItem = {
      id: 'tamper_id_01',
      file: {
        id: 'tamper_id_01',
        relativePath: 'tamper_test.txt',
        absolutePath: tamperedFile,
        metadata: { filename: 'tamper_test.txt', extension: '.txt', sizeBytes: initialTamperFp.sizeBytes, sourceFingerprint: initialTamperFp }
      },
      analysisStatus: 'completed',
      reviewStatus: 'approved',
      approvedProposalSignature: computeProposalSignature('tamper_test.txt', 'Documents', 'Documents', 'Tamper_Dest.txt'),
      proposal: {
        category: 'Documents',
        suggestedFilename: 'Tamper_Dest.txt',
        proposedDestination: 'Documents',
        confidence: 'high',
        reasoning: 'Doc'
      },
      sourceFingerprint: initialTamperFp
    };
    queue.addStagedItem(tamperItem);

    // Modify file on disk
    fs.appendFileSync(tamperedFile, ' --- edited on disk by another program!');

    const tamperExecRes = await executor.executeApprovedBatch(sandboxDir, ['tamper_id_01']);
    assert('Modified file rejected due to checksum mismatch', tamperExecRes.failed.length === 1);
    assert('Tampered file was not moved', fs.existsSync(tamperedFile));

    // 4E. Destination collision rejection
    const collisionSrc = path.join(sandboxDir, 'collision_src.txt');
    const collisionDest = path.join(sandboxDir, 'Documents', 'PreExisting.txt');
    fs.mkdirSync(path.dirname(collisionDest), { recursive: true });
    fs.writeFileSync(collisionSrc, 'Source content');
    fs.writeFileSync(collisionDest, 'Existing content that MUST NOT be overwritten!');

    const colSrcFp = await computeFileFingerprint(collisionSrc);
    const colItem: StagedItem = {
      id: 'col_id_01',
      file: {
        id: 'col_id_01',
        relativePath: 'collision_src.txt',
        absolutePath: collisionSrc,
        metadata: { filename: 'collision_src.txt', extension: '.txt', sizeBytes: colSrcFp.sizeBytes, sourceFingerprint: colSrcFp }
      },
      analysisStatus: 'completed',
      reviewStatus: 'approved',
      approvedProposalSignature: computeProposalSignature('collision_src.txt', 'Documents', 'Documents', 'PreExisting.txt'),
      proposal: {
        category: 'Documents',
        suggestedFilename: 'PreExisting.txt',
        proposedDestination: 'Documents',
        confidence: 'high',
        reasoning: 'Doc'
      },
      sourceFingerprint: colSrcFp
    };
    queue.addStagedItem(colItem);

    const colExecRes = await executor.executeApprovedBatch(sandboxDir, ['col_id_01']);
    assert('Destination collision rejected without overwrite', colExecRes.failed.length === 1);
    assert('Collision flag set', colExecRes.failed[0].isCollision === true);
    assert('Existing file preserved untouched', fs.readFileSync(collisionDest, 'utf8') === 'Existing content that MUST NOT be overwritten!');

    console.log('\n' + '='.repeat(70));
    console.log(`RELEASE AUDIT RESULTS: ${totalPassed}/${totalTests} checks passed (${Math.round((totalPassed / totalTests) * 100)}%).`);
    console.log('='.repeat(70) + '\n');

    if (totalPassed !== totalTests) {
      process.exit(1);
    }
  } finally {
    if (fs.existsSync(sandboxDir)) {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
    if (fs.existsSync(journalDir)) {
      fs.rmSync(journalDir, { recursive: true, force: true });
    }
  }
}

runReleaseAudit().catch((err) => {
  console.error('Release audit suite failed:', err);
  process.exit(1);
});
