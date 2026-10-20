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

export interface FileMetadata {
  filename: string;
  extension: string;
  sizeBytes: number;
  createdAt?: string;
  modifiedAt?: string;
  mimeType?: string;
  textExcerpt?: string;
  isScreenshotHint?: boolean;
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
