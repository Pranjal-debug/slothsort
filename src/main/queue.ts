import { OllamaClient, OllamaModelNotFoundError } from '../ollamaClient.js';
import {
  AnalysisProgress,
  QueueStats,
  ScannedFile,
  StagedItem
} from '../types.js';
import { validateModelOutput } from '../validator.js';
import { computeProposalSignature } from './fingerprint.js';

export interface QueueCallbacks {
  onItemUpdated?: (item: StagedItem) => void;
  onProgress?: (progress: AnalysisProgress, stats: QueueStats) => void;
}

/**
 * Sequential background inference queue for SlothSort ("Slow and Steady").
 * Processes one file at a time, strictly avoiding UI thread blocking.
 */
export class InferenceQueue {
  private client: OllamaClient;
  private items: Map<string, StagedItem> = new Map();
  private pendingQueue: string[] = [];
  private activeJobId: string | null = null;
  private isProcessing = false;
  private abortController: AbortController | null = null;
  private callbacks: QueueCallbacks;

  constructor(client: OllamaClient, callbacks: QueueCallbacks = {}) {
    this.client = client;
    this.callbacks = callbacks;
  }

  /**
   * Enqueues a batch of scanned files for local AI analysis.
   * Prevents duplicate active jobs for the same file.
   */
  async enqueue(files: ScannedFile[]): Promise<{ addedCount: number; duplicateCount: number }> {
    let addedCount = 0;
    let duplicateCount = 0;

    for (const file of files) {
      const existing = this.items.get(file.id);

      // Prevent duplicate active or queued jobs
      if (existing && (existing.analysisStatus === 'queued' || existing.analysisStatus === 'analyzing')) {
        duplicateCount++;
        continue;
      }

      const item: StagedItem = {
        id: file.id,
        file,
        analysisStatus: 'queued',
        reviewStatus: 'pending_review',
        sourceFingerprint: file.metadata.sourceFingerprint
      };

      this.items.set(file.id, item);
      this.pendingQueue.push(file.id);
      addedCount++;
      this.callbacks.onItemUpdated?.(item);
    }

    this.emitProgress();
    this.startWorker();

    return { addedCount, duplicateCount };
  }

  /**
   * Cancels the current in-flight job and marks all remaining queued jobs as cancelled.
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }

    if (this.activeJobId) {
      const activeItem = this.items.get(this.activeJobId);
      if (activeItem && activeItem.analysisStatus === 'analyzing') {
        activeItem.analysisStatus = 'cancelled';
        activeItem.error = 'Inference cancelled by user.';
        this.callbacks.onItemUpdated?.(activeItem);
      }
    }

    // Mark remaining queued items as cancelled
    for (const id of this.pendingQueue) {
      const item = this.items.get(id);
      if (item && item.analysisStatus === 'queued') {
        item.analysisStatus = 'cancelled';
        item.error = 'Queue cancelled by user.';
        this.callbacks.onItemUpdated?.(item);
      }
    }

    this.pendingQueue = [];
    this.isProcessing = false;
    this.activeJobId = null;
    this.emitProgress();
  }

  /**
   * Retries an individual failed or cancelled item.
   */
  retry(fileId: string): boolean {
    const item = this.items.get(fileId);
    if (!item) return false;
    if (item.analysisStatus !== 'failed' && item.analysisStatus !== 'cancelled') {
      return false;
    }

    item.analysisStatus = 'queued';
    item.error = undefined;
    this.pendingQueue.push(fileId);
    this.callbacks.onItemUpdated?.(item);
    this.emitProgress();
    this.startWorker();

    return true;
  }

  /**
   * Updates an item's review status (approved, rejected, or edited).
   * Binds approval strictly to the exact current proposal signature.
   * Any edit to a proposal invalidates previous approval.
   */
  updateReview(
    fileId: string,
    status: StagedItem['reviewStatus'],
    editedProposal?: StagedItem['userEditedProposal']
  ): boolean {
    const item = this.items.get(fileId);
    if (!item) return false;

    if (editedProposal) {
      if (item.analysisStatus !== 'completed') {
        return false;
      }

      const validation = validateModelOutput(editedProposal);
      if (!validation.isValid || !validation.sanitized) {
        return false;
      }

      item.userEditedProposal = validation.sanitized;
      item.reviewStatus = 'edited';
      // Proposal edit strictly invalidates previous approval
      item.approvedProposalSignature = undefined;
    } else if (status === 'approved') {
      if (item.analysisStatus !== 'completed') {
        return false;
      }

      const activeProposal = item.userEditedProposal || item.proposal;
      if (!activeProposal) {
        return false;
      }
      item.reviewStatus = 'approved';
      item.approvedProposalSignature = computeProposalSignature(
        item.file.relativePath,
        activeProposal.category,
        activeProposal.proposedDestination,
        activeProposal.suggestedFilename
      );
    } else if (status === 'edited') {
      return false;
    } else {
      item.reviewStatus = status;
      item.approvedProposalSignature = undefined;
    }

    this.callbacks.onItemUpdated?.(item);
    return true;
  }

  /**
   * Retrieves an individual staged item by ID from trusted queue state.
   */
  getItem(fileId: string): StagedItem | undefined {
    return this.items.get(fileId);
  }

  /**
   * Registers a pre-analyzed or loaded staged item into the queue.
   */
  addStagedItem(item: StagedItem): void {
    this.items.set(item.id, item);
  }

  /**
   * Marks a staged item as applied with its associated operation ID.
   */
  markApplied(fileId: string, operationId: string): void {
    const item = this.items.get(fileId);
    if (item) {
      item.appliedOperationId = operationId;
      this.callbacks.onItemUpdated?.(item);
    }
  }

  /**
   * Returns current queue statistics.
   */
  getStats(): QueueStats {
    let queued = 0;
    let analyzing = 0;
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    let cancelled = 0;

    for (const item of this.items.values()) {
      switch (item.analysisStatus) {
        case 'queued': queued++; break;
        case 'analyzing': analyzing++; break;
        case 'completed': completed++; break;
        case 'failed': failed++; break;
        case 'skipped': skipped++; break;
        case 'cancelled': cancelled++; break;
      }
    }

    return {
      queued,
      analyzing,
      completed,
      failed,
      skipped,
      cancelled,
      total: this.items.size
    };
  }

  /**
   * Returns all staged items.
   */
  getAllItems(): StagedItem[] {
    return Array.from(this.items.values());
  }

  /**
   * Emits progress snapshot to listeners.
   */
  private emitProgress(): void {
    const stats = this.getStats();
    const processed = stats.completed + stats.failed + stats.skipped + stats.cancelled;
    const total = stats.total;
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

    const currentItem = this.activeJobId ? this.items.get(this.activeJobId) : undefined;

    const progress: AnalysisProgress = {
      processed,
      total,
      currentFilename: currentItem?.file.metadata.filename,
      percent,
      isRunning: this.isProcessing
    };

    this.callbacks.onProgress?.(progress, stats);
  }

  /**
   * Starts sequential background worker.
   */
  private startWorker(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.processQueueLoop().catch(() => {
      this.isProcessing = false;
      this.emitProgress();
    });
  }

  /**
   * Core sequential queue loop: processes exactly one item at a time.
   */
  private async processQueueLoop(): Promise<void> {
    while (this.pendingQueue.length > 0) {
      const nextId = this.pendingQueue.shift();
      if (!nextId) continue;

      const item = this.items.get(nextId);
      if (!item || item.analysisStatus !== 'queued') continue;

      this.activeJobId = nextId;
      item.analysisStatus = 'analyzing';
      this.abortController = new AbortController();
      this.callbacks.onItemUpdated?.(item);
      this.emitProgress();

      const startTime = performance.now();

      try {
        // Pre-flight check: confirm model is available
        const isInstalled = await this.client.verifyModelInstalled();
        if (!isInstalled) {
          throw new OllamaModelNotFoundError(this.client['model'] || 'gemma3:4b');
        }

        // Execute local model inference with cancellation support
        const result = await this.client.classify(item.file.metadata, {
          signal: this.abortController.signal,
          timeoutMs: 90000 // 90 second timeout per file
        });

        const elapsedMs = Math.round(performance.now() - startTime);
        item.latencyMs = elapsedMs;

        // Parse and validate structured output
        let parsed: unknown;
        try {
          parsed = JSON.parse(result.rawText);
        } catch {
          throw new Error('Model did not return valid JSON output.');
        }

        const validation = validateModelOutput(parsed);
        if (!validation.isValid || !validation.sanitized) {
          throw new Error(`Model output validation failed: ${validation.errors.join('; ')}`);
        }

        item.analysisStatus = 'completed';
        item.proposal = validation.sanitized;
        item.error = undefined;
      } catch (err: unknown) {
        const isAbort =
          (err instanceof Error && (err.name === 'AbortError' || err.message.includes('cancelled'))) ||
          this.abortController.signal.aborted;

        if (isAbort) {
          item.analysisStatus = 'cancelled';
          item.error = 'Inference cancelled.';
        } else {
          item.analysisStatus = 'failed';
          item.error = err instanceof Error ? err.message : String(err);
        }
      } finally {
        this.activeJobId = null;
        this.abortController = null;
        this.callbacks.onItemUpdated?.(item);
        this.emitProgress();
      }
    }

    this.isProcessing = false;
    this.emitProgress();
  }
}
