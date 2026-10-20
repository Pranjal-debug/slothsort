import crypto from 'node:crypto';
import fs from 'node:fs';
import { SourceFingerprint } from '../types.js';

/**
 * Computes a durable content and metadata fingerprint for a file.
 * Returns size, modification timestamp, and SHA-256 content digest.
 */
export async function computeFileFingerprint(filePath: string): Promise<SourceFingerprint> {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Target is not a regular file: ${filePath}`);
  }

  return new Promise<SourceFingerprint>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      resolve({
        sizeBytes: stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
        sha256: hash.digest('hex')
      });
    });
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Computes a canonical signature string for an approved proposal.
 * Binds approval strictly to the exact source path, category, target destination folder, and filename.
 */
export function computeProposalSignature(
  sourceRelativePath: string,
  category: string,
  destinationFolder: string,
  suggestedFilename: string
): string {
  const normSource = sourceRelativePath.trim().replace(/\\/g, '/');
  const normCategory = category.trim();
  const normDest = destinationFolder.trim().replace(/\\/g, '/');
  const normName = suggestedFilename.trim();

  const payload = `${normSource}|${normCategory}|${normDest}|${normName}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Sanitizes system errors to ensure sensitive document content or credentials
 * are not leaked in journal logs or UI messages.
 */
export function sanitizeError(err: unknown): string {
  if (!err) return 'Unknown error occurred.';
  const raw = err instanceof Error ? err.message : String(err);
  // Redact potential inline token or secret patterns if present
  return raw
    .replace(/(?:key|token|secret|password|pwd)=([^\s&]+)/gi, '$1=[REDACTED]')
    .slice(0, 300);
}
