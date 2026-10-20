import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { OperationRecord, SourceFingerprint } from '../types.js';
import { computeFileFingerprint, sanitizeError } from './fingerprint.js';
import { normalizePath, pathExists } from './pathSecurity.js';

/**
 * Validates that an object parsed from a JSON line conforms to the OperationRecord schema.
 */
function isValidOperationRecord(obj: unknown): obj is OperationRecord {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.stagedItemId === 'string' &&
    typeof o.rootPath === 'string' &&
    typeof o.sourceAbsolutePath === 'string' &&
    typeof o.destinationAbsolutePath === 'string' &&
    typeof o.status === 'string' &&
    typeof o.timestamp === 'string' &&
    typeof o.sourceFingerprint === 'object' &&
    o.sourceFingerprint !== null
  );
}

/**
 * Resolves the default persistent directory for SlothSort journal data.
 * Always stores outside the organized target folder.
 */
function resolveDefaultJournalPath(): string {
  if (process.env.SLOTHSORT_JOURNAL_PATH) {
    return path.resolve(process.env.SLOTHSORT_JOURNAL_PATH);
  }

  const baseDir =
    process.env.SLOTHSORT_USER_DATA_DIR ||
    path.join(os.homedir(), '.slothsort');

  return path.join(baseDir, 'operations.jsonl');
}

/**
 * Persistent append-only Undo and Execution Journal for SlothSort.
 * Uses JSON Lines (.jsonl) format for recoverable, transparent auditing.
 */
export class UndoJournal {
  private journalPath: string;
  private operations: Map<string, OperationRecord> = new Map();
  private isInitialized = false;

  constructor(customJournalPath?: string) {
    this.journalPath = customJournalPath
      ? path.resolve(customJournalPath)
      : resolveDefaultJournalPath();
  }

  /**
   * Initializes the journal: creates directory, replays existing records,
   * handles corrupted/partial trailing lines gracefully, and reconciles interrupted operations.
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    const dir = path.dirname(this.journalPath);
    await fs.promises.mkdir(dir, { recursive: true });

    if (await pathExists(this.journalPath)) {
      await this.loadRecords();
      await this.reconcileInterruptedOperations();
    }

    this.isInitialized = true;
  }

  /**
   * Replays the JSONL file line-by-line.
   * Tolerates incomplete trailing records (e.g. from an abrupt crash) without discarding prior valid history.
   * If an incomplete or corrupt trailing record is detected, sanitizes the journal file so subsequent appends remain safe.
   */
  private async loadRecords(): Promise<void> {
    const raw = await fs.promises.readFile(this.journalPath, 'utf8');
    const lines = raw.split(/\r?\n/);

    let hadCorruptLine = false;
    const validLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);
        if (isValidOperationRecord(parsed)) {
          this.operations.set(parsed.id, parsed);
          validLines.push(trimmed);
        } else {
          console.warn(`[UndoJournal] Skipping malformed schema record at line ${i + 1}`);
          hadCorruptLine = true;
        }
      } catch {
        console.warn(`[UndoJournal] Recovered: skipped corrupt or partial line ${i + 1} in ${this.journalPath}`);
        hadCorruptLine = true;
      }
    }

    // If corrupted or partial trailing lines were present, rewrite the file with only valid lines
    // ending with a clean newline so that subsequent appends are strictly safe and clean.
    if (hadCorruptLine) {
      const cleanContent = validLines.length > 0 ? validLines.join('\n') + '\n' : '';
      await fs.promises.writeFile(this.journalPath, cleanContent, 'utf8');
    }
  }

  /**
   * Reconciles any operations that were left in an in-flight status ('pending' or 'undo_pending')
   * when the application previously exited.
   */
  async reconcileInterruptedOperations(): Promise<number> {
    let reconciledCount = 0;

    for (const [id, op] of this.operations) {
      if (op.status === 'pending') {
        const sourceExists = await pathExists(op.sourceAbsolutePath);
        const destExists = await pathExists(op.destinationAbsolutePath);

        if (destExists && !sourceExists) {
          // Destination exists and source is gone: move completed before crash
          try {
            const destFp = await computeFileFingerprint(op.destinationAbsolutePath);
            if (destFp.sha256 === op.sourceFingerprint.sha256) {
              op.status = 'completed';
              op.destinationFingerprint = destFp;
              op.completedAt = new Date().toISOString();
              await this.appendLine(op);
              reconciledCount++;
              continue;
            }
          } catch {
            // Fingerprint check failed
          }
        }

        // Otherwise mark as failed
        op.status = 'failed';
        op.error = 'Operation interrupted by unexpected application exit before confirmation.';
        await this.appendLine(op);
        reconciledCount++;
      } else if (op.status === 'undo_pending') {
        const sourceExists = await pathExists(op.sourceAbsolutePath);
        const destExists = await pathExists(op.destinationAbsolutePath);

        if (sourceExists && !destExists) {
          try {
            const sourceFp = await computeFileFingerprint(op.sourceAbsolutePath);
            if (sourceFp.sha256 === op.sourceFingerprint.sha256) {
              op.status = 'undone';
              op.undoneAt = new Date().toISOString();
              await this.appendLine(op);
              reconciledCount++;
              continue;
            }
          } catch {
            // Fingerprint check failed
          }
        }

        op.status = 'undo_failed';
        op.error = 'Undo operation was interrupted before completion.';
        await this.appendLine(op);
        reconciledCount++;
      }
    }

    return reconciledCount;
  }

  /**
   * Records the initial intent to perform a file move/rename.
   */
  async recordIntent(op: OperationRecord): Promise<void> {
    await this.init();
    op.status = 'pending';
    this.operations.set(op.id, { ...op });
    await this.appendLine(op);
  }

  /**
   * Records successful completion of a file operation.
   */
  async recordCompletion(opId: string, destFingerprint?: SourceFingerprint): Promise<OperationRecord> {
    await this.init();
    const op = this.operations.get(opId);
    if (!op) {
      throw new Error(`Operation "${opId}" not found in journal.`);
    }

    op.status = 'completed';
    op.completedAt = new Date().toISOString();
    if (destFingerprint) {
      op.destinationFingerprint = destFingerprint;
    }
    await this.appendLine(op);
    return op;
  }

  /**
   * Records failure of a file operation.
   */
  async recordFailure(opId: string, error: unknown): Promise<OperationRecord> {
    await this.init();
    const op = this.operations.get(opId);
    if (!op) {
      throw new Error(`Operation "${opId}" not found in journal.`);
    }

    op.status = 'failed';
    op.error = sanitizeError(error);
    await this.appendLine(op);
    return op;
  }

  /**
   * Records intent to undo a completed operation.
   */
  async recordUndoIntent(opId: string): Promise<OperationRecord> {
    await this.init();
    const op = this.operations.get(opId);
    if (!op) {
      throw new Error(`Operation "${opId}" not found in journal.`);
    }

    op.status = 'undo_pending';
    await this.appendLine(op);
    return op;
  }

  /**
   * Records successful completion of an undo operation.
   */
  async recordUndoCompletion(opId: string): Promise<OperationRecord> {
    await this.init();
    const op = this.operations.get(opId);
    if (!op) {
      throw new Error(`Operation "${opId}" not found in journal.`);
    }

    op.status = 'undone';
    op.undoneAt = new Date().toISOString();
    await this.appendLine(op);
    return op;
  }

  /**
   * Records failure of an undo operation.
   */
  async recordUndoFailure(opId: string, error: unknown): Promise<OperationRecord> {
    await this.init();
    const op = this.operations.get(opId);
    if (!op) {
      throw new Error(`Operation "${opId}" not found in journal.`);
    }

    op.status = 'undo_failed';
    op.error = sanitizeError(error);
    await this.appendLine(op);
    return op;
  }

  /**
   * Retrieves an operation by ID.
   */
  getOperation(opId: string): OperationRecord | undefined {
    return this.operations.get(opId);
  }

  /**
   * Returns all recorded operations, sorted with most recent first.
   * Optionally filtered by normalized rootPath.
   */
  getAllOperations(rootPath?: string): OperationRecord[] {
    const all = Array.from(this.operations.values());
    const sorted = all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (!rootPath) return sorted;

    const normRoot = normalizePath(rootPath);
    return sorted.filter((op) => normalizePath(op.rootPath) === normRoot);
  }

  /**
   * Appends an operation record as a single JSON line to the journal file.
   * Guarantees that appends always start on a clean newline.
   */
  private async appendLine(record: OperationRecord): Promise<void> {
    const json = JSON.stringify(record) + '\n';
    try {
      if (await pathExists(this.journalPath)) {
        const stat = await fs.promises.stat(this.journalPath);
        if (stat.size > 0) {
          const handle = await fs.promises.open(this.journalPath, 'r');
          const buffer = Buffer.alloc(1);
          await handle.read(buffer, 0, 1, stat.size - 1);
          await handle.close();
          if (buffer[0] !== 0x0a) {
            // File does not end with newline, prepend \n to avoid corrupting previous record
            await fs.promises.appendFile(this.journalPath, '\n' + json, 'utf8');
            return;
          }
        }
      }
    } catch {
      // Fallback to standard append
    }
    await fs.promises.appendFile(this.journalPath, json, 'utf8');
  }

  /**
   * Returns the filesystem path to the current journal file.
   */
  getJournalPath(): string {
    return this.journalPath;
  }
}
