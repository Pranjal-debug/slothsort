import fs from 'node:fs';
import path from 'node:path';
import { validateDestination, validateFilename } from '../validator.js';

/**
 * Normalizes Windows paths (ensures uniform forward/backward slashes and lowercase drive letters).
 */
export function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  // On Windows, normalize drive letter to uppercase for consistent comparison
  if (/^[a-zA-Z]:/.test(resolved)) {
    return resolved[0].toUpperCase() + resolved.slice(1);
  }
  return resolved;
}

/**
 * Validates that candidatePath is strictly contained inside rootPath.
 * Prevents directory traversal attacks (e.g., ../../Windows) and symlink escapes.
 */
export function isPathContained(rootPath: string, candidatePath: string): boolean {
  const normRoot = normalizePath(rootPath);
  const normCandidate = normalizePath(candidatePath);

  // Exact match or subpath check
  const rel = path.relative(normRoot, normCandidate);
  if (rel === '') return true; // exactly the root
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return false;
  }
  return true;
}

/**
 * Checks whether candidatePath or any parent symlink resolves to a target outside rootPath.
 */
export async function isSymlinkEscaping(rootPath: string, candidatePath: string): Promise<boolean> {
  const normRoot = normalizePath(rootPath);
  try {
    const real = await fs.promises.realpath(candidatePath);
    const normReal = normalizePath(real);
    return !isPathContained(normRoot, normReal);
  } catch {
    // If path doesn't exist yet (e.g. proposed destination), resolve its existing parent
    let parent = path.dirname(candidatePath);
    while (parent && parent !== path.dirname(parent)) {
      try {
        const realParent = await fs.promises.realpath(parent);
        const normRealParent = normalizePath(realParent);
        return !isPathContained(normRoot, normRealParent);
      } catch {
        parent = path.dirname(parent);
      }
    }
    return false;
  }
}

/**
 * Safely resolves and validates a target destination file inside rootPath.
 * Throws an Error if validation fails or containment is violated.
 */
export function resolveSafeDestination(
  rootPath: string,
  destinationFolder: string,
  filename: string
): { safePath: string; relativePath: string } {
  const destCheck = validateDestination(destinationFolder);
  if (!destCheck.isValid) {
    throw new Error(`Invalid destination folder: ${destCheck.error}`);
  }

  const nameCheck = validateFilename(filename);
  if (!nameCheck.isValid) {
    throw new Error(`Invalid filename: ${nameCheck.error}`);
  }

  const cleanFolder = destinationFolder.trim().replace(/[/\\]+/g, path.sep);
  const cleanFilename = filename.trim();

  const safePath = path.resolve(rootPath, cleanFolder, cleanFilename);
  if (!isPathContained(rootPath, safePath)) {
    throw new Error(`Path containment violation: Destination "${safePath}" escapes root "${rootPath}".`);
  }

  const relativePath = path.relative(rootPath, safePath);
  return { safePath, relativePath };
}

/**
 * Checks if a file or directory exists at the given path.
 */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
