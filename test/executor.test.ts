import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FileExecutor } from '../src/main/executor.js';
import { computeFileFingerprint } from '../src/main/fingerprint.js';
import { UndoJournal } from '../src/main/journal.js';
import { InferenceQueue } from '../src/main/queue.js';
import { OllamaClient } from '../src/ollamaClient.js';
import { ScannedFile, StagedItem } from '../src/types.js';

console.log('='.repeat(70));
console.log('SLOTHSORT STAGE D TEST SUITE: APPROVAL-GATED EXECUTION & UNDO');
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

// Mock client for queue instantiation
class MockOllamaClient extends OllamaClient {
  constructor() {
    super({ model: 'gemma3:4b' });
  }
  override async verifyModelInstalled(): Promise<boolean> {
    return true;
  }
  override async classify(): Promise<{ rawText: string }> {
    return {
      rawText: JSON.stringify({
        category: 'Documents',
        suggestedFilename: 'Report_2026.pdf',
        proposedDestination: 'Documents',
        confidence: 'high',
        reasoning: 'Financial report'
      })
    };
  }
}

async function runStageDTests() {
  const sandboxDir = path.resolve('./temp_stage_d_sandbox');
  const journalDir = path.resolve('./temp_stage_d_journal');
  const journalFile = path.join(journalDir, 'test_operations.jsonl');

  // Setup sandbox directories
  if (fs.existsSync(sandboxDir)) fs.rmSync(sandboxDir, { recursive: true, force: true });
  if (fs.existsSync(journalDir)) fs.rmSync(journalDir, { recursive: true, force: true });

  fs.mkdirSync(sandboxDir, { recursive: true });
  fs.mkdirSync(journalDir, { recursive: true });

  try {
    const queue = new InferenceQueue(new MockOllamaClient());
    const journal = new UndoJournal(journalFile);
    await journal.init();

    const executor = new FileExecutor({ queue, journal });

    // Helper to create synthetic scanned file
    async function createTestFile(relPath: string, content: string): Promise<ScannedFile> {
      const fullPath = path.join(sandboxDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');

      const fp = await computeFileFingerprint(fullPath);
      const filename = path.basename(relPath);

      return {
        id: `test_${crypto.randomBytes(4).toString('hex')}`,
        relativePath: relPath.replace(/\\/g, '/'),
        absolutePath: fullPath,
        metadata: {
          filename,
          extension: path.extname(filename),
          sizeBytes: fp.sizeBytes,
          sourceFingerprint: fp
        }
      };
    }

    function stageItemWithProposal(
      file: ScannedFile,
      proposal?: StagedItem['proposal'],
      reviewStatus: StagedItem['reviewStatus'] = 'pending_review'
    ): StagedItem {
      const item: StagedItem = {
        id: file.id,
        file,
        analysisStatus: 'completed',
        reviewStatus,
        proposal,
        sourceFingerprint: file.metadata.sourceFingerprint
      };
      queue.addStagedItem(item);
      return item;
    }

    // ----------------------------------------------------
    // 1. Approval and Execution Contract
    // ----------------------------------------------------
    console.log('\n--- 1. Approval and Execution Contract ---');

    const file1 = await createTestFile('unapproved.pdf', 'Content of unapproved file');
    stageItemWithProposal(file1, {
      category: 'Documents',
      suggestedFilename: 'Renamed_Unapproved.pdf',
      proposedDestination: 'Documents',
      confidence: 'high',
      reasoning: 'Doc'
    });

    // Attempt to execute unapproved item
    const unapprovedRes = await executor.executeApprovedBatch(sandboxDir, [file1.id]);
    assert('Unapproved item is skipped from execution', unapprovedRes.skipped.length === 1);
    assert('No successful operations for unapproved item', unapprovedRes.successful.length === 0);
    assert('Original file remains in place', fs.existsSync(file1.absolutePath));

    // Proposal edit invalidates previous approval
    queue.updateReview(file1.id, 'approved');
    assert('Item review status is approved', queue.getItem(file1.id)?.reviewStatus === 'approved');
    assert('Approved proposal signature is computed', Boolean(queue.getItem(file1.id)?.approvedProposalSignature));

    // Edit the proposal: must invalidate approval
    queue.updateReview(file1.id, 'edited', {
      category: 'Documents',
      suggestedFilename: 'Edited_Custom_Name.pdf',
      proposedDestination: 'Documents/Custom',
      confidence: 'high',
      reasoning: 'User edited'
    });

    assert('Edit invalidates approval (status is edited)', queue.getItem(file1.id)?.reviewStatus === 'edited');
    assert('Approval signature was cleared', queue.getItem(file1.id)?.approvedProposalSignature === undefined);

    const editedRes = await executor.executeApprovedBatch(sandboxDir, [file1.id]);
    assert('Edited item without re-approval is skipped', editedRes.skipped.length === 1);

    // Re-approve the edited proposal
    queue.updateReview(file1.id, 'approved');
    assert('Re-approved item has valid signature', Boolean(queue.getItem(file1.id)?.approvedProposalSignature));

    // ----------------------------------------------------
    // 2. Successful File Move and Rename
    // ----------------------------------------------------
    console.log('\n--- 2. Successful File Move and Rename ---');

    const execRes = await executor.executeApprovedBatch(sandboxDir, [file1.id]);
    assert('Execution succeeds for approved item', execRes.successful.length === 1);
    assert('Zero failures reported', execRes.failed.length === 0);

    const targetDest = path.join(sandboxDir, 'Documents', 'Custom', 'Edited_Custom_Name.pdf');
    assert('Destination file exists', fs.existsSync(targetDest));
    assert('Original source file no longer exists at source path', !fs.existsSync(file1.absolutePath));

    const destFp = await computeFileFingerprint(targetDest);
    assert('Destination content checksum matches original source checksum', destFp.sha256 === file1.metadata.sourceFingerprint?.sha256);

    const completedOp = execRes.successful[0];
    assert('Operation record status is completed', completedOp.status === 'completed');
    assert('Queue item marked as applied', queue.getItem(file1.id)?.appliedOperationId === completedOp.id);

    // ----------------------------------------------------
    // 3. Collision Protection (No Overwrite)
    // ----------------------------------------------------
    console.log('\n--- 3. Collision Protection (Refuse Overwrite) ---');

    // Create file2 that proposes destination where a file already exists
    const file2 = await createTestFile('conflict.txt', 'Fresh source content');
    // Pre-create target destination to trigger collision
    const collisionDest = path.join(sandboxDir, 'Documents', 'Existing_File.txt');
    fs.mkdirSync(path.dirname(collisionDest), { recursive: true });
    fs.writeFileSync(collisionDest, 'Existing file content that must NOT be overwritten', 'utf8');

    stageItemWithProposal(file2, {
      category: 'Documents',
      suggestedFilename: 'Existing_File.txt',
      proposedDestination: 'Documents',
      confidence: 'high',
      reasoning: 'Doc'
    });
    queue.updateReview(file2.id, 'approved');

    const collisionRes = await executor.executeApprovedBatch(sandboxDir, [file2.id]);
    assert('Collision was detected and rejected', collisionRes.failed.length === 1);
    assert('Collision flag set in error', collisionRes.failed[0]?.isCollision === true);
    assert('Source file was preserved', fs.existsSync(file2.absolutePath));
    assert('Existing destination was not overwritten', fs.readFileSync(collisionDest, 'utf8') === 'Existing file content that must NOT be overwritten');

    // ----------------------------------------------------
    // 4. Source Fingerprint Modification Protection
    // ----------------------------------------------------
    console.log('\n--- 4. Source Modification Protection ---');

    const file3 = await createTestFile('tampered.txt', 'Original content before edit');
    stageItemWithProposal(file3, {
      category: 'Documents',
      suggestedFilename: 'Tampered_Moved.txt',
      proposedDestination: 'Documents',
      confidence: 'high',
      reasoning: 'Doc'
    });
    queue.updateReview(file3.id, 'approved');

    // Tamper with source file on disk after approval
    fs.appendFileSync(file3.absolutePath, ' --- unexpected modification on disk!');

    const tamperRes = await executor.executeApprovedBatch(sandboxDir, [file3.id]);
    assert('Fingerprint mismatch detected and execution refused', tamperRes.failed.length === 1);
    assert('Failure message indicates checksum/modification', tamperRes.failed[0]?.error.includes('checksum') || tamperRes.failed[0]?.error.includes('modified'));
    assert('Tampered file was not moved', fs.existsSync(file3.absolutePath));

    // ----------------------------------------------------
    // 5. Path Containment & Escape Rejection
    // ----------------------------------------------------
    console.log('\n--- 5. Path Containment & Escape Rejection ---');

    const file4 = await createTestFile('escape_test.txt', 'Escape attempt content');
    stageItemWithProposal(file4, {
      category: 'Documents',
      suggestedFilename: 'escaped.txt',
      proposedDestination: '../../escape_dir',
      confidence: 'high',
      reasoning: 'Bad path'
    });
    queue.updateReview(file4.id, 'approved');

    const escapeRes = await executor.executeApprovedBatch(sandboxDir, [file4.id]);
    assert('Traversal destination rejected before execution', escapeRes.failed.length === 1);
    assert('Source file preserved', fs.existsSync(file4.absolutePath));

    // ----------------------------------------------------
    // 6. Persistent Journal Durability & Recovery
    // ----------------------------------------------------
    console.log('\n--- 6. Persistent Journal Durability & Recovery ---');

    // Verify journal file exists and has content
    assert('Journal file exists on disk', fs.existsSync(journalFile));

    // Reload journal into fresh instance
    const freshJournal = new UndoJournal(journalFile);
    await freshJournal.init();

    const restoredOp = freshJournal.getOperation(completedOp.id);
    assert('Operation restored from journal on reload', restoredOp !== undefined);
    assert('Restored operation status is completed', restoredOp?.status === 'completed');

    // Simulate incomplete trailing line (abrupt crash during write)
    fs.appendFileSync(journalFile, '{"id": "op_corrupted", "status": "pend\n', 'utf8');

    const corruptRecoveryJournal = new UndoJournal(journalFile);
    await corruptRecoveryJournal.init();
    assert('Journal loads successfully despite corrupt trailing record', corruptRecoveryJournal.getOperation(completedOp.id) !== undefined);

    // ----------------------------------------------------
    // 7. Safe Verifiable Undo Contract
    // ----------------------------------------------------
    console.log('\n--- 7. Safe Verifiable Undo Contract ---');

    // Undo the successful move (completedOp)
    const undoRes = await executor.undoOperation(completedOp.id);
    assert('Undo operation succeeded', undoRes.success === true);
    assert('File returned to original location', fs.existsSync(file1.absolutePath));
    assert('File removed from destination location', !fs.existsSync(targetDest));

    const restoredFp = await computeFileFingerprint(file1.absolutePath);
    assert('Restored file matches original checksum', restoredFp.sha256 === file1.metadata.sourceFingerprint?.sha256);

    // Repeated undo is idempotent
    const repeatUndoRes = await executor.undoOperation(completedOp.id);
    assert('Repeated undo returns success idempotently', repeatUndoRes.success === true);

    // Test Undo Conflict: when original source path is occupied
    // Move another file to verify undo failure on conflict
    const file5 = await createTestFile('undo_test.pdf', 'Undo test content');
    stageItemWithProposal(file5, {
      category: 'Documents',
      suggestedFilename: 'Dest_For_Undo.pdf',
      proposedDestination: 'Documents',
      confidence: 'high',
      reasoning: 'Doc'
    });
    queue.updateReview(file5.id, 'approved');

    const execRes5 = await executor.executeApprovedBatch(sandboxDir, [file5.id]);
    const op5 = execRes5.successful[0];
    assert('Move succeeded for undo test', op5 !== undefined);

    // Occupy original path
    fs.writeFileSync(file5.absolutePath, 'New occupying file at original location');

    const conflictUndoRes = await executor.undoOperation(op5.id);
    assert('Undo refused when original path is occupied', conflictUndoRes.success === false);
    assert('Error explains collision/occupied location', conflictUndoRes.error?.includes('occupied') === true);

    // Test Undo Refusal when destination file was modified
    // Remove occupying file and modify destination file
    fs.unlinkSync(file5.absolutePath);
    const dest5 = path.join(sandboxDir, 'Documents', 'Dest_For_Undo.pdf');
    fs.appendFileSync(dest5, ' -- modified after move');

    const modifiedUndoRes = await executor.undoOperation(op5.id);
    assert('Undo refused when destination file was modified', modifiedUndoRes.success === false);
    assert('Error explains file modification', modifiedUndoRes.error?.includes('modified') === true);

    // ----------------------------------------------------
    // 8. Interrupted Operation Recovery
    // ----------------------------------------------------
    console.log('\n--- 8. Interrupted Operation Recovery ---');

    // Simulate an interrupted operation where move completed right before crash
    const interruptedSource = path.join(sandboxDir, 'interrupted_source.txt');
    const interruptedDest = path.join(sandboxDir, 'Documents', 'Interrupted_Recovered.txt');
    fs.writeFileSync(interruptedDest, 'Successfully moved content before crash');

    const dummyFp = await computeFileFingerprint(interruptedDest);
    const interruptedOpId = `op_interrupted_${Date.now()}`;

    const interruptedRecord = {
      id: interruptedOpId,
      stagedItemId: 'dummy_item',
      timestamp: new Date().toISOString(),
      rootPath: sandboxDir,
      sourceRelativePath: 'interrupted_source.txt',
      destinationRelativePath: 'Documents/Interrupted_Recovered.txt',
      sourceAbsolutePath: interruptedSource,
      destinationAbsolutePath: interruptedDest,
      originalFilename: 'interrupted_source.txt',
      newFilename: 'Interrupted_Recovered.txt',
      category: 'Documents' as const,
      proposalSignature: 'dummy_sig',
      sourceFingerprint: dummyFp,
      status: 'pending' as const
    };

    // Append interrupted record to journal
    fs.appendFileSync(journalFile, JSON.stringify(interruptedRecord) + '\n', 'utf8');

    // Reload journal and reconcile
    const recoveryJournal = new UndoJournal(journalFile);
    await recoveryJournal.init();

    const reconciledOp = recoveryJournal.getOperation(interruptedOpId);
    assert('Interrupted operation reconciled on startup', reconciledOp?.status === 'completed');

    console.log('\n' + '='.repeat(70));
    console.log(`SUMMARY: ${totalPassed}/${totalTests} tests passed (${Math.round((totalPassed / totalTests) * 100)}%).`);
    console.log('='.repeat(70) + '\n');

    if (totalPassed !== totalTests) {
      process.exit(1);
    }
  } finally {
    // Clean up test sandboxes
    if (fs.existsSync(sandboxDir)) {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
    if (fs.existsSync(journalDir)) {
      fs.rmSync(journalDir, { recursive: true, force: true });
    }
  }
}

runStageDTests().catch((err) => {
  console.error('Stage D test suite failed:', err);
  process.exit(1);
});
