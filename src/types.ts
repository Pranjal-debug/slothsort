export const ALLOWED_CATEGORIES = [
  'Documents',
  'Images',
  'Screenshots',
  'Projects',
  'Installers',
  'Archives',
  'Other'
] as const;

export type AllowedCategory = typeof ALLOWED_CATEGORIES[number];

export interface SourceFingerprint {
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
}

export interface FileMetadata {
  filename: string;
  extension: string;
  sizeBytes: number;
  createdAt?: string;
  modifiedAt?: string;
  mimeType?: string;
  textExcerpt?: string;
  isScreenshotHint?: boolean;
  isSensitiveExcluded?: boolean;
  privacyNotice?: string;
  sourceFingerprint?: SourceFingerprint;
}

/**
 * Raw JSON schema requested from the LLM
 */
export interface ModelClassificationOutput {
  category: AllowedCategory;
  suggestedFilename: string;
  proposedDestination: string;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export interface SanitizedClassification {
  category: AllowedCategory;
  suggestedFilename: string;
  proposedDestination: string;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitized?: SanitizedClassification;
}

export interface TestCase {
  id: string;
  description: string;
  input: FileMetadata;
  expectedCategory: AllowedCategory;
  acceptableAlternative?: AllowedCategory;
}

export interface InferenceMetrics {
  totalDurationMs: number;
  promptEvalDurationMs?: number;
  evalDurationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface TestResult {
  testCase: TestCase;
  rawResponseText: string;
  parsedResponse?: unknown;
  validation: ValidationResult;
  isCorrectCategory: boolean;
  metrics: InferenceMetrics;
  isWarmup: boolean;
}

// ----------------------------------------------------
// Desktop MVP Interfaces (Phase 2)
// ----------------------------------------------------

export interface ScannedFile {
  id: string;
  relativePath: string;
  absolutePath: string;
  metadata: FileMetadata;
}

export interface ScanResult {
  rootPath: string;
  files: ScannedFile[];
  skippedCount: number;
  totalBytes: number;
}

export type AnalysisStatus =
  | 'queued'
  | 'analyzing'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'cancelled'
  | 'pending';

export type ReviewStatus = 'pending_review' | 'approved' | 'rejected' | 'edited';

export interface QueueStats {
  queued: number;
  analyzing: number;
  completed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  total: number;
}

export interface StagedItem {
  id: string;
  file: ScannedFile;
  analysisStatus: AnalysisStatus;
  reviewStatus: ReviewStatus;
  proposal?: SanitizedClassification;
  userEditedProposal?: SanitizedClassification;
  approvedProposalSignature?: string;
  sourceFingerprint?: SourceFingerprint;
  error?: string;
  latencyMs?: number;
  appliedOperationId?: string;
}

export type OperationStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'undo_pending'
  | 'undone'
  | 'undo_failed';

export interface OperationRecord {
  id: string;
  stagedItemId: string;
  timestamp: string;
  completedAt?: string;
  undoneAt?: string;
  rootPath: string;
  sourceRelativePath: string;
  destinationRelativePath: string;
  sourceAbsolutePath: string;
  destinationAbsolutePath: string;
  originalFilename: string;
  newFilename: string;
  category: AllowedCategory;
  proposalSignature: string;
  sourceFingerprint: SourceFingerprint;
  destinationFingerprint?: SourceFingerprint;
  status: OperationStatus;
  error?: string;
}

export interface JournalData {
  version: number;
  updatedAt: string;
  operations: OperationRecord[];
}

export interface OllamaStatus {
  isHealthy: boolean;
  version?: string;
  modelInstalled: boolean;
  modelName: string;
  error?: string;
}

export interface AnalysisProgress {
  processed: number;
  total: number;
  currentFilename?: string;
  percent: number;
  isRunning: boolean;
}

export interface ExecutionItemError {
  itemId: string;
  filename: string;
  error: string;
  isCollision?: boolean;
}

export interface ExecutionItemSkipped {
  itemId: string;
  filename: string;
  reason: string;
}

export interface ExecutionResult {
  successful: OperationRecord[];
  failed: ExecutionItemError[];
  skipped: ExecutionItemSkipped[];
}

