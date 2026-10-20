import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FileMetadata, ScannedFile, ScanResult, SourceFingerprint } from '../types.js';
import { computeFileFingerprint } from './fingerprint.js';
import { isPathContained, isSymlinkEscaping, normalizePath } from './pathSecurity.js';

// Directories that should always be ignored for safety and performance
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '$recycle.bin',
  'system volume information',
  '.slothsort',
  '.vscode',
  '.idea',
  '.ssh',
  '.aws',
  '.azure',
  '.kube',
  '.docker',
  '.gnupg',
  '.config',
  'appdata',
  'local appdata',
  'chrome',
  'firefox',
  'mozilla',
  'edge',
  'bravesoftware',
  'opera',
  'chromium',
  'user data'
]);

// Extensions where reading a short text excerpt is safe and beneficial for classification
const TEXT_EXCERPT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.xml', '.csv',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rs', '.go', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.sh', '.bat', '.ps1', '.html', '.css',
  '.log', '.ini', '.cfg', '.conf', '.env.example', '.toml', '.sql'
]);

// Sensitive filename extensions that must never have text excerpts read
const SENSITIVE_EXTENSIONS = new Set([
  '.pem', '.key', '.pkcs12', '.p12', '.pfx', '.kdbx', '.ovpn', '.crt', '.csr', '.der'
]);

/**
 * Checks whether a filename indicates sensitive credentials, private keys, or secrets.
 * Excerpts are strictly suppressed for these files to protect privacy.
 */
export function isSensitiveFile(filename: string): boolean {
  const lower = filename.toLowerCase();

  // Environment files containing secret keys (.env, .env.local, .env.production)
  if (lower === '.env' || (lower.startsWith('.env.') && !lower.endsWith('.example'))) {
    return true;
  }

  // SSH, GPG, and SSL keys
  if (/^id_(rsa|dsa|ecdsa|ed25519)/i.test(lower)) {
    return true;
  }

  const ext = path.extname(lower);
  if (SENSITIVE_EXTENSIONS.has(ext)) {
    return true;
  }

  // Common keywords in credentials and secret stores
  if (/(?:^|[._-])(?:credential|credentials|secret|secrets|password|passwords|token_store|shadow|private_key)(?:[._-]|$)/i.test(lower)) {
    return true;
  }

  // Browser profiles, cookies, and saved login stores
  if (/^(?:cookies|history|web\s*data|login\s*data|places\.sqlite|key4\.db|logins\.json|formhistory\.sqlite|favicons)(?:[._-]|$)/i.test(lower)) {
    return true;
  }

  return false;
}

// Common MIME mappings for metadata display
const MIME_TYPE_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.exe': 'application/x-msdownload',
  '.msi': 'application/x-msi',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska'
};

/**
 * Extracts a safe, truncated text excerpt from a text file.
 * Reads at most 2048 bytes and returns at most 500 characters.
 */
async function extractSafeExcerpt(filePath: string): Promise<string | undefined> {
  let fileHandle: fs.promises.FileHandle | null = null;
  try {
    fileHandle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(2048);
    const { bytesRead } = await fileHandle.read(buffer, 0, 2048, 0);
    if (bytesRead === 0) return undefined;

    // Check for null bytes (binary file check)
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        return undefined; // binary detected
      }
    }

    const text = buffer.toString('utf-8', 0, bytesRead).trim();
    // Normalize newlines and collapse whitespace
    const clean = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');
    return clean.slice(0, 500);
  } catch {
    return undefined;
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
  }
}

/**
 * Scans a folder recursively and collects file metadata without modifying anything.
 */
export async function scanFolder(
  rootPath: string,
  onProgress?: (file: ScannedFile) => void,
  maxFiles = 500
): Promise<ScanResult> {
  const normRoot = normalizePath(rootPath);

  // Assert that rootPath exists and is a directory
  const rootStat = await fs.promises.stat(normRoot);
  if (!rootStat.isDirectory()) {
    throw new Error(`The provided path is not a directory: "${rootPath}"`);
  }

  const files: ScannedFile[] = [];
  let skippedCount = 0;
  let totalBytes = 0;

  async function walk(currentDir: string, currentDepth: number): Promise<void> {
    if (files.length >= maxFiles || currentDepth > 10) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      skippedCount++;
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      const fullPath = path.join(currentDir, entry.name);
      const lowerName = entry.name.toLowerCase();

      // Skip ignored directories
      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(lowerName)) {
        skippedCount++;
        continue;
      }

      // Check containment & symlink escapes
      if (!isPathContained(normRoot, fullPath)) {
        skippedCount++;
        continue;
      }

      if (entry.isSymbolicLink()) {
        const escapes = await isSymlinkEscaping(normRoot, fullPath);
        if (escapes) {
          skippedCount++;
          continue;
        }
      }

      if (entry.isDirectory()) {
        await walk(fullPath, currentDepth + 1);
      } else if (entry.isFile()) {
        try {
          // Verify canonical realpath before reading any file content
          const canonicalPath = await fs.promises.realpath(fullPath);
          if (!isPathContained(normRoot, canonicalPath)) {
            skippedCount++;
            continue;
          }

          const stat = await fs.promises.stat(fullPath);
          const ext = path.extname(entry.name).toLowerCase();
          const relativePath = path.relative(normRoot, fullPath).replace(/\\/g, '/');

          const sensitive = isSensitiveFile(entry.name);
          let textExcerpt: string | undefined;
          let privacyNotice: string;

          if (sensitive) {
            // Strictly exclude excerpts from credentials, keys, and secrets
            textExcerpt = undefined;
            privacyNotice = 'Sensitive file: content excerpt suppressed for privacy.';
          } else if (TEXT_EXCERPT_EXTENSIONS.has(ext) && stat.size > 0 && stat.size < 10 * 1024 * 1024) {
            textExcerpt = await extractSafeExcerpt(fullPath);
            privacyNotice = textExcerpt
              ? 'First 500 characters of text excerpt included for local classification.'
              : 'Text excerpt could not be extracted (binary or empty).';
          } else {
            privacyNotice = 'Only filename, extension, and file size will be provided.';
          }

          const isScreenshotHint =
            /screenshot|screen\s*shot|capture|snip/i.test(entry.name);

          let sourceFingerprint: SourceFingerprint | undefined;
          try {
            sourceFingerprint = await computeFileFingerprint(fullPath);
          } catch {
            // If file cannot be read, continue with stat only
          }

          const metadata: FileMetadata = {
            filename: entry.name,
            extension: ext,
            sizeBytes: stat.size,
            createdAt: stat.birthtime.toISOString(),
            modifiedAt: stat.mtime.toISOString(),
            mimeType: MIME_TYPE_MAP[ext] || 'application/octet-stream',
            textExcerpt,
            isScreenshotHint,
            isSensitiveExcluded: sensitive,
            privacyNotice,
            sourceFingerprint
          };

          const id = crypto
            .createHash('sha256')
            .update(`${relativePath}:${stat.size}:${stat.mtimeMs}`)
            .digest('hex')
            .slice(0, 16);

          const scanned: ScannedFile = {
            id,
            relativePath,
            absolutePath: fullPath,
            metadata
          };

          files.push(scanned);
          totalBytes += stat.size;

          if (onProgress) {
            onProgress(scanned);
          }
        } catch {
          skippedCount++;
        }
      }
    }
  }

  await walk(normRoot, 0);

  return {
    rootPath: normRoot,
    files,
    skippedCount,
    totalBytes
  };
}
