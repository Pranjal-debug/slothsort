import { contextBridge, ipcRenderer } from 'electron';
import {
  AnalysisProgress,
  ExecutionResult,
  OllamaStatus,
  OperationRecord,
  ReviewStatus,
  SanitizedClassification,
  ScannedFile,
  ScanResult,
  StagedItem
} from '../types.js';

export interface SlothSortAPI {
  selectFolder: () => Promise<string | null>;
  getOllamaStatus: () => Promise<OllamaStatus>;
  scanFolder: (rootPath: string) => Promise<ScanResult>;
  startAnalysis: (files: ScannedFile[]) => Promise<{ started: boolean; addedCount?: number; duplicateCount?: number; error?: string }>;
  cancelAnalysis: () => Promise<{ cancelled: boolean }>;
  retryAnalysis: (fileId: string) => Promise<boolean>;
  updateReview: (fileId: string, status: ReviewStatus, editedProposal?: SanitizedClassification) => Promise<boolean>;
  executeOperations: (rootPath: string, itemIds: string[]) => Promise<ExecutionResult>;
  undoOperation: (operationId: string) => Promise<{ success: boolean; error?: string }>;
  getJournal: (rootPath?: string) => Promise<OperationRecord[]>;

  // Subscriptions
  onScanProgress: (callback: (file: ScannedFile) => void) => () => void;
  onAnalysisProgress: (callback: (progress: AnalysisProgress) => void) => () => void;
  onAnalysisResult: (callback: (item: StagedItem) => void) => () => void;
  onOllamaStatus: (callback: (status: OllamaStatus) => void) => () => void;
}

const api: SlothSortAPI = {
  selectFolder: () => ipcRenderer.invoke('slothsort:select-folder'),
  getOllamaStatus: () => ipcRenderer.invoke('slothsort:get-ollama-status'),
  scanFolder: (rootPath: string) => ipcRenderer.invoke('slothsort:scan-folder', rootPath),
  startAnalysis: (files: ScannedFile[]) => ipcRenderer.invoke('slothsort:start-analysis', files),
  cancelAnalysis: () => ipcRenderer.invoke('slothsort:cancel-analysis'),
  retryAnalysis: (fileId: string) => ipcRenderer.invoke('slothsort:retry-analysis', fileId),
  updateReview: (fileId: string, status: ReviewStatus, editedProposal?: SanitizedClassification) =>
    ipcRenderer.invoke('slothsort:update-review', { fileId, status, editedProposal }),
  executeOperations: (rootPath: string, itemIds: string[]) =>
    ipcRenderer.invoke('slothsort:execute-operations', { rootPath, itemIds }),
  undoOperation: (operationId: string) => ipcRenderer.invoke('slothsort:undo-operation', operationId),
  getJournal: (rootPath?: string) => ipcRenderer.invoke('slothsort:get-journal', rootPath),

  onScanProgress: (callback) => {
    const listener = (_event: unknown, file: ScannedFile) => callback(file);
    ipcRenderer.on('slothsort:scan-progress', listener);
    return () => ipcRenderer.removeListener('slothsort:scan-progress', listener);
  },

  onAnalysisProgress: (callback) => {
    const listener = (_event: unknown, progress: AnalysisProgress) => callback(progress);
    ipcRenderer.on('slothsort:analysis-progress', listener);
    return () => ipcRenderer.removeListener('slothsort:analysis-progress', listener);
  },

  onAnalysisResult: (callback) => {
    const listener = (_event: unknown, item: StagedItem) => callback(item);
    ipcRenderer.on('slothsort:analysis-result', listener);
    return () => ipcRenderer.removeListener('slothsort:analysis-result', listener);
  },

  onOllamaStatus: (callback) => {
    const listener = (_event: unknown, status: OllamaStatus) => callback(status);
    ipcRenderer.on('slothsort:ollama-status', listener);
    return () => ipcRenderer.removeListener('slothsort:ollama-status', listener);
  }
};

contextBridge.exposeInMainWorld('slothsort', api);
