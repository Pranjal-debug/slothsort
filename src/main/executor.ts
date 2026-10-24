import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ExecutionItemError,
  ExecutionItemSkipped,
  ExecutionResult,
  OperationRecord,
  SourceFingerprint,
  StagedItem
} from '../types.js';
import {
  computeFileFingerprint,
  computeProposalSignature,
  sanitizeError
} from './fingerprint.js';
import { UndoJournal } from './journal.js';
import {
  isPathContained,
  isSymlinkEscaping,
  normalizePath,
  pathExists,
  resolveSafeDestination
} from './pathSecurity.js';
import { InferenceQueue } from './queue.js';

export interface FileExecutorOptions {
  queue: InferenceQueue;
  journal: UndoJournal;
}

/**
 * Executes approved file reorganization proposals and manages safe, verifiable rollbacks.
 */
function isCrossVolumeMove(source: string, destination: string): boolean {
  const sourceRoot = path.parse(path.resolve(source)).root.toUpperCase();
  const destRoot = path.parse(path.resolve(destination)).root.toUpperCase();
  return sourceRoot !== destRoot;
}

/**
 * Executes approved file reorganization proposals and manages safe, verifiable rollbacks.
 */
export class FileExecutor {
  private queue: InferenceQueue;
  private journal: UndoJournal;

  constructor(options: FileExecutorOptions) {
    this.queue = options.queue;
    this.journal = options.journal;
  }

  /**
   * Safely moves a file from sourcePath to destinationPath.
   * Handles same-volume no-overwrite links as well as cross-volume verified copy-and-delete.
   * Never deletes source file until destination integrity is cryptographically verified.
   * Does NOT assume EPERM means EXDEV.
   */
  async safeMoveFile(
    sourcePath: string,
    destinationPath: string,
    expectedFingerprint: SourceFingerprint
  ): Promise<SourceFingerprint> {
    const targetDir = path.dirname(destinationPath);
    await fs.promises.mkdir(targetDir, { recursive: true });

    // Explicit cross-volume check: if source and destination are on different volumes, use crossVolumeMove
    if (isCrossVolumeMove(sourcePath, destinationPath)) {
      return this.crossVolumeMove(sourcePath, destinationPath, expectedFingerprint);
    }

    // Create the destination link atomically. Unlike rename(), link() refuses
    // to replace a destination that appeared after the preflight collision check.
    try {
      await fs.promises.link(sourcePath, destinationPath);

      // Verify destination after linking
      const destFingerprint = await computeFileFingerprint(destinationPath);
      if (destFingerprint.sha256 !== expectedFingerprint.sha256) {
        await fs.promises.unlink(destinationPath).catch(() => {});
        throw new Error('Destination file fingerprint does not match source fingerprint after linking.');
      }

      try {
        await fs.promises.unlink(sourcePath);
      } catch (unlinkErr) {
        await fs.promises.unlink(destinationPath).catch(() => {});
        throw new Error(`Failed to remove original source file: ${sanitizeError(unlinkErr)}`);
      }
      return destFingerprint;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      // Only fall back to copy-verify-delete if OS explicitly reports EXDEV (cross-device link)
      if (code === 'EXDEV') {
        return this.crossVolumeMove(sourcePath, destinationPath, expectedFingerprint);
      }

      // Do NOT assume EPERM means EXDEV on the same volume. EPERM/EBUSY indicates permission or file lock.
      throw err;
    }
  }

  /**
   * Performs a safe cross-volume copy, verifies content hash, and deletes original source only upon success.
   * Rolls back destination if original source cannot be safely deleted.
   */
  private async crossVolumeMove(
    sourcePath: string,
    destinationPath: string,
    expectedFingerprint: SourceFingerprint
  ): Promise<SourceFingerprint> {
    const tempDest = `${destinationPath}.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;

    try {
      // 1. Copy source to temp destination
      await fs.promises.copyFile(sourcePath, tempDest);

      // 2. Verify temp destination integrity
      const tempFingerprint = await computeFileFingerprint(tempDest);
      if (tempFingerprint.sha256 !== expectedFingerprint.sha256) {
        throw new Error('Copied file checksum does not match original source file.');
      }

       // 3. Link the temporary file into the final destination without
       // replacing a destination that appeared after the initial collision check.
       await fs.promises.link(tempDest, destinationPath);
       await fs.promises.unlink(tempDest);

      // 4. Verify final destination exists and matches
      const finalFingerprint = await computeFileFingerprint(destinationPath);
      if (finalFingerprint.sha256 !== expectedFingerprint.sha256) {
        throw new Error('Final destination checksum verification failed.');
      }

      // 5. Only now unlink original source file, with rollback if deletion fails
      try {
        await fs.promises.unlink(sourcePath);
      } catch (unlinkErr) {
        // Rollback destination to prevent duplicate files or partial move
        if (await pathExists(destinationPath)) {
          try {
            await fs.promises.unlink(destinationPath);
          } catch {
            // Ignore rollback cleanup error
          }
        }
        throw new Error(`Failed to remove original source file: ${sanitizeError(unlinkErr)}`);
      }

      return finalFingerprint;
    } catch (copyErr) {
      // Clean up temp destination on failure
      if (await pathExists(tempDest)) {
        try {
          await fs.promises.unlink(tempDest);
        } catch {
          // Ignore temp cleanup error
        }
      }
      throw copyErr;
    }
  }

  /**
   * Executes a batch of approved staged items by item ID.
   * All items are verified against trusted main process state.
   */
  async executeApprovedBatch(
    rootPath: string,
    itemIds: string[]
  ): Promise<ExecutionResult> {
    await this.journal.init();

    const normRoot = normalizePath(rootPath);
    const successful: OperationRecord[] = [];
    const failed: ExecutionItemError[] = [];
    const skipped: ExecutionItemSkipped[] = [];

    // Verify rootPath is valid directory
    try {
      const stat = await fs.promises.stat(normRoot);
      if (!stat.isDirectory()) {
        throw new Error(`The provided root path is not a directory: "${rootPath}"`);
      }
    } catch (err) {
      throw new Error(`Invalid root directory: ${sanitizeError(err)}`);
    }

    for (const itemId of itemIds) {
      // 1. Retrieve from trusted main process queue state
      const item = this.queue.getItem(itemId);
      if (!item) {
        skipped.push({
          itemId,
          filename: itemId,
          reason: 'Item not found in active session queue.'
        });
        continue;
      }

      const originalFilename = item.file.metadata.filename;

      // 2. Verify approval status
      if (item.reviewStatus !== 'approved') {
        skipped.push({
          itemId,
          filename: originalFilename,
          reason: `Item is not approved (current status: "${item.reviewStatus}").`
        });
        continue;
      }

      if (item.appliedOperationId) {
        skipped.push({
          itemId,
          filename: originalFilename,
          reason: 'Item has already been applied. Rescan the folder before organizing it again.'
        });
        continue;
      }

      const activeProposal = item.userEditedProposal || item.proposal;
      if (!activeProposal) {
        skipped.push({
          itemId,
          filename: originalFilename,
          reason: 'No proposal available for this item.'
        });
        continue;
      }

      // 3. Verify approval signature binding
      const currentSignature = computeProposalSignature(
        item.file.relativePath,
        activeProposal.category,
        activeProposal.proposedDestination,
        activeProposal.suggestedFilename
      );

      if (currentSignature !== item.approvedProposalSignature) {
        skipped.push({
          itemId,
          filename: originalFilename,
          reason: 'Stale approval: proposal was modified after approval was granted.'
        });
        continue;
      }

      // 4. Verify source containment and symlink safety
      const sourceAbsPath = normalizePath(item.file.absolutePath);
      if (!isPathContained(normRoot, sourceAbsPath)) {
        failed.push({
          itemId,
          filename: originalFilename,
          error: 'Security violation: source path escapes the selected root directory.'
        });
        continue;
      }

      const sourceEscaping = await isSymlinkEscaping(normRoot, sourceAbsPath);
      if (sourceEscaping) {
        failed.push({
          itemId,
          filename: originalFilename,
          error: 'Security violation: source is or traverses a symlink escaping the root directory.'
        });
        continue;
      }

      // 5. Verify source existence and regular file check
      let currentSourceFp: SourceFingerprint;
      if (!item.sourceFingerprint?.sha256) {
        failed.push({
          itemId,
          filename: originalFilename,
          error: 'Source fingerprint is missing. Rescan the folder before executing this item.'
        });
        continue;
      }

      try {
        currentSourceFp = await computeFileFingerprint(sourceAbsPath);
      } catch (statErr) {
        failed.push({
          itemId,
          filename: originalFilename,
          error: `Source file cannot be accessed: ${sanitizeError(statErr)}`
        });
        continue;
      }

      // 6. Verify source fingerprint unchanged since scan
      if (item.sourceFingerprint && item.sourceFingerprint.sha256 !== currentSourceFp.sha256) {
        failed.push({
          itemId,
          filename: originalFilename,
          error: 'Source file was modified after scanning (checksum mismatch).'
        });
        continue;
      }

      // 7. Resolve destination safely inside root
      let safeDestPath: string;
      let destRelPath: string;
      try {
        const resolved = resolveSafeDestination(
          normRoot,
          activeProposal.proposedDestination,
          activeProposal.suggestedFilename
        );
        safeDestPath = normalizePath(resolved.safePath);
        destRelPath = resolved.relativePath.replace(/\\/g, '/');
      } catch (destErr) {
        failed.push({
          itemId,
          filename: originalFilename,
          error: `Invalid destination path: ${sanitizeError(destErr)}`
        });
        continue;
      }

      const destinationEscaping = await isSymlinkEscaping(normRoot, safeDestPath);
      if (destinationEscaping) {
        failed.push({
          itemId,
          filename: originalFilename,
          error: 'Security violation: destination is or traverses a symlink/junction escaping the selected root directory.'
        });
        continue;
      }

      // 8. Refuse to overwrite existing destination (Collision check)
      if (await pathExists(safeDestPath)) {
        failed.push({
          itemId,
          filename: originalFilename,
          error: `Destination collision: a file already exists at "${destRelPath}". Edit filename or destination to resolve.`,
          isCollision: true
        });
        continue;
      }

      // 9. Create Operation Record and record intent in persistent journal
      const opId = `op_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const record: OperationRecord = {
        id: opId,
        stagedItemId: item.id,
        timestamp: new Date().toISOString(),
        rootPath: normRoot,
        sourceRelativePath: item.file.relativePath.replace(/\\/g, '/'),
        destinationRelativePath: destRelPath,
        sourceAbsolutePath: sourceAbsPath,
        destinationAbsolutePath: safeDestPath,
        originalFilename,
        newFilename: activeProposal.suggestedFilename,
        category: activeProposal.category,
        proposalSignature: currentSignature,
        sourceFingerprint: currentSourceFp,
        status: 'pending'
      };

      try {
        await this.journal.recordIntent(record);
      } catch (jErr) {
        failed.push({
          itemId,
          filename: originalFilename,
          error: `Failed to write operation intent to journal: ${sanitizeError(jErr)}`
        });
        continue;
      }

      // Re-check immediately before touching the filesystem. This narrows the
      // race window in which a directory junction could be inserted after the
      // initial destination preflight.
      if (await isSymlinkEscaping(normRoot, safeDestPath)) {
        const securityError = new Error(
          'Destination is or traverses a symlink/junction escaping the selected root directory.'
        );
        await this.journal.recordFailure(opId, securityError);
        failed.push({
          itemId,
          filename: originalFilename,
          error: `Security violation: ${securityError.message}`
        });
        continue;
      }

      // 10. Execute the file move
      try {
        const destFp = await this.safeMoveFile(sourceAbsPath, safeDestPath, currentSourceFp);
        const completedOp = await this.journal.recordCompletion(opId, destFp);
        this.queue.markApplied(itemId, opId);
        successful.push(completedOp);
      } catch (moveErr) {
        await this.journal.recordFailure(opId, moveErr);
        const moveCode = (moveErr as { code?: string })?.code;
        const isCollision = moveCode === 'EEXIST';
        failed.push({
          itemId,
          filename: originalFilename,
          error: isCollision
            ? `Destination collision: a file appeared at "${destRelPath}" before the move completed. Edit filename or destination to resolve.`
            : `Execution error during move: ${sanitizeError(moveErr)}`,
          isCollision
        });
      }
    }

    return { successful, failed, skipped };
  }

  /**
   * Reverses a previously completed operation.
   * Re-checks destination integrity and source availability before moving back.
   */
  async undoOperation(operationId: string): Promise<{ success: boolean; error?: string }> {
    await this.journal.init();

    const op = this.journal.getOperation(operationId);
    if (!op) {
      return { success: false, error: `Operation record "${operationId}" not found in journal.` };
    }

    // Repeated undo is idempotent
    if (op.status === 'undone') {
      return { success: true };
    }

    if (op.status !== 'completed') {
      return {
        success: false,
        error: `Cannot undo operation with status "${op.status}". Only completed operations can be rolled back.`
      };
    }

    const destPath = normalizePath(op.destinationAbsolutePath);
    const sourcePath = normalizePath(op.sourceAbsolutePath);

    if (await isSymlinkEscaping(op.rootPath, destPath) || await isSymlinkEscaping(op.rootPath, sourcePath)) {
      return {
        success: false,
        error: 'Security violation: undo path is or traverses a symlink/junction escaping the recorded root directory.'
      };
    }

    // 1. Confirm destination still exists
    if (!(await pathExists(destPath))) {
      return {
        success: false,
        error: `Organized file was moved or deleted from "${op.destinationRelativePath}". Undo refused.`
      };
    }

    // 2. Confirm destination still matches recorded fingerprint
    try {
      const destFp = await computeFileFingerprint(destPath);
      if (destFp.sha256 !== op.sourceFingerprint.sha256) {
        return {
          success: false,
          error: 'Organized file has been modified since it was moved. Undo refused to prevent data loss.'
        };
      }
    } catch (fpErr) {
      return {
        success: false,
        error: `Failed to verify file integrity: ${sanitizeError(fpErr)}`
      };
    }

    // 3. Confirm original source path is available (never overwrite existing file)
    if (await pathExists(sourcePath)) {
      return {
        success: false,
        error: `Original location "${op.sourceRelativePath}" is occupied by another file. Undo refused to avoid overwriting.`
      };
    }

    // 4. Record undo intent in persistent journal
    try {
      await this.journal.recordUndoIntent(operationId);
    } catch (jErr) {
      return {
        success: false,
        error: `Failed to record undo intent in journal: ${sanitizeError(jErr)}`
      };
    }

    // 5. Execute reverse move
    try {
      await this.safeMoveFile(destPath, sourcePath, op.sourceFingerprint);
      await this.journal.recordUndoCompletion(operationId);
      return { success: true };
    } catch (undoErr) {
      await this.journal.recordUndoFailure(operationId, undoErr);
      return {
        success: false,
        error: `Undo execution failed: ${sanitizeError(undoErr)}`
      };
    }
  }

  /**
   * Returns operation history for a given root directory.
   */
  getHistory(rootPath?: string): OperationRecord[] {
    return this.journal.getAllOperations(rootPath);
  }
}
