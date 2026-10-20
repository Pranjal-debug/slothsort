import {
  ALLOWED_CATEGORIES,
  AllowedCategory,
  ModelClassificationOutput,
  SanitizedClassification,
  ValidationResult
} from './types.js';

// Reserved Windows device names
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

// Windows invalid filename characters: < > : " / \ | ? * and control chars (0x00-0x1F)
const WINDOWS_INVALID_CHAR_REGEX = /[<>:"/\\|?*\x00-\x1F]/;

/**
 * Validates whether a filename is safe and legal on Windows.
 */
export function validateFilename(filename: string): { isValid: boolean; error?: string } {
  if (!filename || typeof filename !== 'string') {
    return { isValid: false, error: 'Filename is missing or not a string.' };
  }

  const trimmed = filename.trim();
  if (trimmed.length === 0) {
    return { isValid: false, error: 'Filename is empty or whitespace only.' };
  }

  if (trimmed.length > 255) {
    return { isValid: false, error: `Filename exceeds Windows 255 character limit (${trimmed.length} chars).` };
  }

  if (trimmed === '.' || trimmed === '..') {
    return { isValid: false, error: 'Filename cannot be "." or "..".' };
  }

  if (WINDOWS_INVALID_CHAR_REGEX.test(trimmed)) {
    return { isValid: false, error: 'Filename contains forbidden characters (< > : " / \\ | ? * or control chars).' };
  }

  // Check reserved names (e.g., "CON", "aux.txt")
  const baseNameWithoutExt = trimmed.split('.')[0].toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(baseNameWithoutExt)) {
    return { isValid: false, error: `Filename base "${baseNameWithoutExt}" is a reserved Windows system device name.` };
  }

  // Windows does not allow trailing space or period
  if (trimmed.endsWith(' ') || trimmed.endsWith('.')) {
    return { isValid: false, error: 'Filename cannot end with a space or a period on Windows.' };
  }

  return { isValid: true };
}

/**
 * Validates proposed destination category / folder.
 * Enforces relative path only, no drive letters, no traversal (..), no leading slashes.
 */
export function validateDestination(destination: string): { isValid: boolean; error?: string } {
  if (!destination || typeof destination !== 'string') {
    return { isValid: false, error: 'Destination is missing or not a string.' };
  }

  const trimmed = destination.trim();
  if (trimmed.length === 0) {
    return { isValid: false, error: 'Destination is empty or whitespace only.' };
  }

  // Disallow absolute paths (drive letters C: or root / or \)
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    return { isValid: false, error: 'Destination must be a relative folder, not an absolute path or drive root.' };
  }

  // Disallow directory traversal
  const segments = trimmed.split(/[/\\]+/);
  for (const seg of segments) {
    if (seg === '..') {
      return { isValid: false, error: 'Destination cannot contain directory traversal ("..").' };
    }
    if (WINDOWS_INVALID_CHAR_REGEX.test(seg)) {
      return { isValid: false, error: `Destination segment "${seg}" contains illegal characters.` };
    }
    const base = seg.split('.')[0].toUpperCase();
    if (WINDOWS_RESERVED_NAMES.has(base)) {
      return { isValid: false, error: `Destination segment "${seg}" uses a reserved Windows device name.` };
    }
  }

  return { isValid: true };
}

/**
 * Programmatically validates model output against schema and safety constraints.
 * Rejects invalid categories, malformed filenames, path traversals, and incomplete responses.
 */
export function validateModelOutput(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      isValid: false,
      errors: ['Output must be a non-null JSON object.']
    };
  }

  const candidate = raw as Partial<ModelClassificationOutput>;

  // 1. Category validation
  if (!candidate.category) {
    errors.push('Missing required field: "category".');
  } else if (!ALLOWED_CATEGORIES.includes(candidate.category as AllowedCategory)) {
    errors.push(`Invalid category: "${candidate.category}". Must be one of: ${ALLOWED_CATEGORIES.join(', ')}.`);
  }

  // 2. Suggested filename validation
  if (!candidate.suggestedFilename) {
    errors.push('Missing required field: "suggestedFilename".');
  } else {
    const filenameCheck = validateFilename(candidate.suggestedFilename);
    if (!filenameCheck.isValid) {
      errors.push(`Invalid suggestedFilename: ${filenameCheck.error}`);
    }
  }

  // 3. Proposed destination validation
  if (!candidate.proposedDestination) {
    errors.push('Missing required field: "proposedDestination".');
  } else {
    const destCheck = validateDestination(candidate.proposedDestination);
    if (!destCheck.isValid) {
      errors.push(`Invalid proposedDestination: ${destCheck.error}`);
    }
  }

  // 4. Confidence validation
  const validConfidences = ['high', 'medium', 'low'];
  if (!candidate.confidence || !validConfidences.includes(candidate.confidence)) {
    errors.push(`Invalid confidence: "${candidate.confidence}". Must be "high", "medium", or "low".`);
  }

  // 5. Reasoning validation
  if (!candidate.reasoning || typeof candidate.reasoning !== 'string' || candidate.reasoning.trim().length === 0) {
    errors.push('Missing or empty required field: "reasoning".');
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      errors
    };
  }

  const sanitized: SanitizedClassification = {
    category: candidate.category as AllowedCategory,
    suggestedFilename: candidate.suggestedFilename!.trim(),
    proposedDestination: candidate.proposedDestination!.trim().replace(/\\/g, '/'),
    confidence: candidate.confidence as 'high' | 'medium' | 'low',
    reasoning: candidate.reasoning!.trim()
  };

  return {
    isValid: true,
    errors: [],
    sanitized
  };
}
