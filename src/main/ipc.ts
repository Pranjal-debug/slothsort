import { BrowserWindow, dialog, ipcMain } from 'electron';
import { OllamaClient } from '../ollamaClient.js';
import {
  ExecutionResult,
  OllamaStatus,
  OperationRecord,
  ReviewStatus,
  SanitizedClassification,
  ScannedFile,
  ScanResult,
  StagedItem
} from '../types.js';
import { validateModelOutput } from '../validator.js';
import { FileExecutor } from './executor.js';
import { UndoJournal } from './journal.js';
import { normalizePath } from './pathSecurity.js';
import { InferenceQueue } from './queue.js';
import { scanFolder } from './scanner.js';

let activeOllamaClient: OllamaClient | null = null;
let activeQueue: InferenceQueue | null = null;
let activeJournal: UndoJournal | null = null;
let activeExecutor: FileExecutor | null = null;
const MODEL_NAME = process.env.SLOTHSORT_MODEL || 'gemma3:4b';

function getJournal(): UndoJournal {
  if (!activeJournal) {
    activeJournal = new UndoJournal();
  }
  return activeJournal;
}

function getExecutor(mainWindow: BrowserWindow): FileExecutor {
  if (!activeExecutor) {
    activeExecutor = new FileExecutor({
      queue: getQueue(mainWindow),
      journal: getJournal()
    });
  }
  return activeExecutor;
}

function getOllamaClient(): OllamaClient {
  if (!activeOllamaClient) {
    activeOllamaClient = new OllamaClient({ model: MODEL_NAME });
  }
  return activeOllamaClient;
}

function getQueue(mainWindow: BrowserWindow): InferenceQueue {
  if (!activeQueue) {
    activeQueue = new InferenceQueue(getOllamaClient(), {
      onItemUpdated: (item: StagedItem) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('slothsort:analysis-result', item);
        }
      },
      onProgress: (progress) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('slothsort:analysis-progress', progress);
        }
      }
    });
  }
  return activeQueue;
}

/**
 * Registers all SlothSort IPC handlers in the main process.
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // 1. Folder Selection Dialog
  ipcMain.handle('slothsort:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Folder to Organize with SlothSort',
      properties: ['openDirectory'],
      buttonLabel: 'Select Folder'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return normalizePath(result.filePaths[0]);
  });

  // 2. Ollama Status Check
  ipcMain.handle('slothsort:get-ollama-status', async (): Promise<OllamaStatus> => {
    const client = getOllamaClient();
    const health = await client.checkHealth();
    if (!health.isHealthy) {
      return {
        isHealthy: false,
        modelInstalled: false,
        modelName: MODEL_NAME,
        error: health.error || 'Ollama daemon is not reachable on port 11434.'
      };
    }

    const isTargetInstalled = await client.verifyModelInstalled();

    return {
      isHealthy: true,
      version: health.version,
      modelInstalled: isTargetInstalled,
      modelName: MODEL_NAME
    };
  });

  // 3. Metadata-Only Folder Scanner
  ipcMain.handle('slothsort:scan-folder', async (_event, rootPath: unknown): Promise<ScanResult> => {
    if (typeof rootPath !== 'string' || rootPath.trim().length === 0) {
      throw new Error('Invalid folder path provided for scanning.');
    }

    const normPath = normalizePath(rootPath.trim());
    return scanFolder(normPath, (file: ScannedFile) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('slothsort:scan-progress', file);
      }
    });
  });

  // 4. Background Inference Queue Orchestration
  ipcMain.handle('slothsort:start-analysis', async (_event, files: unknown) => {
    if (!Array.isArray(files) || files.length === 0) {
      return { started: false, error: 'No files provided for analysis.' };
    }

    // Validate that inputs are properly shaped ScannedFile objects
    const validFiles: ScannedFile[] = [];
    for (const f of files) {
      if (f && typeof f === 'object' && typeof f.id === 'string' && f.metadata && typeof f.metadata.filename === 'string') {
        validFiles.push(f as ScannedFile);
      }
    }

    if (validFiles.length === 0) {
      return { started: false, error: 'No valid file metadata items found in payload.' };
    }

    const queue = getQueue(mainWindow);
    const { addedCount, duplicateCount } = await queue.enqueue(validFiles);

    return { started: true, addedCount, duplicateCount };
  });

  ipcMain.handle('slothsort:cancel-analysis', async () => {
    const queue = getQueue(mainWindow);
    queue.cancel();
    return { cancelled: true };
  });

  ipcMain.handle('slothsort:retry-analysis', async (_event, fileId: unknown) => {
    if (typeof fileId !== 'string') return false;
    const queue = getQueue(mainWindow);
    return queue.retry(fileId);
  });

  ipcMain.handle(
    'slothsort:update-review',
    async (
      _event,
      payload: { fileId?: unknown; status?: unknown; editedProposal?: unknown }
    ) => {
      const { fileId, status, editedProposal } = payload || {};
      if (typeof fileId !== 'string') return false;

      const validStatuses: ReviewStatus[] = ['pending_review', 'approved', 'rejected', 'edited'];
      if (!validStatuses.includes(status as ReviewStatus)) {
        throw new Error(`Invalid review status: "${status}"`);
      }

      let sanitizedEdit: SanitizedClassification | undefined;
      if (editedProposal && typeof editedProposal === 'object') {
        const p = editedProposal as Partial<SanitizedClassification>;
        const candidate = {
          category: p.category,
          suggestedFilename: p.suggestedFilename,
          proposedDestination: p.proposedDestination,
          confidence: p.confidence ?? 'high',
          reasoning: p.reasoning ?? 'User manually edited this proposal.'
        };
        const validation = validateModelOutput(candidate);
        if (!validation.isValid || !validation.sanitized) {
          throw new Error(`Invalid edited proposal: ${validation.errors.join('; ')}`);
        }
        sanitizedEdit = validation.sanitized;
      }

      const queue = getQueue(mainWindow);
      return queue.updateReview(fileId, status as ReviewStatus, sanitizedEdit);
    }
  );

  // 6. Stage D: Approval-Gated Batch Execution
  ipcMain.handle(
    'slothsort:execute-operations',
    async (
      _event,
      payload: unknown
    ): Promise<ExecutionResult> => {
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid execute-operations payload.');
      }
      const { rootPath, itemIds } = payload as { rootPath?: unknown; itemIds?: unknown };

      if (typeof rootPath !== 'string' || rootPath.trim().length === 0) {
        throw new Error('Root folder path is required for execution.');
      }

      if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return { successful: [], failed: [], skipped: [] };
      }

      const validItemIds: string[] = [];
      for (const id of itemIds) {
        if (typeof id === 'string' && id.trim().length > 0) {
          validItemIds.push(id.trim());
        }
      }

      const executor = getExecutor(mainWindow);
      return executor.executeApprovedBatch(rootPath.trim(), validItemIds);
    }
  );

  // 7. Stage D: Verifiable Undo
  ipcMain.handle(
    'slothsort:undo-operation',
    async (
      _event,
      operationId: unknown
    ): Promise<{ success: boolean; error?: string }> => {
      if (typeof operationId !== 'string' || operationId.trim().length === 0) {
        return { success: false, error: 'Operation ID is required for undo.' };
      }

      const executor = getExecutor(mainWindow);
      return executor.undoOperation(operationId.trim());
    }
  );

  // 8. Stage D: Persistent Operation History
  ipcMain.handle(
    'slothsort:get-journal',
    async (_event, rootPath?: unknown): Promise<OperationRecord[]> => {
      const journal = getJournal();
      await journal.init();
      const normRoot =
        typeof rootPath === 'string' && rootPath.trim().length > 0
          ? normalizePath(rootPath.trim())
          : undefined;
      return journal.getAllOperations(normRoot);
    }
  );
}
