import fs from 'node:fs';
import path from 'node:path';
import { isPathContained, resolveSafeDestination } from '../src/main/pathSecurity.js';
import { scanFolder } from '../src/main/scanner.js';

console.log('='.repeat(70));
console.log('SLOTHSORT SCANNER & PATH SECURITY TEST SUITE (STAGE A & B)');
console.log('='.repeat(70));

let totalPassed = 0;
let totalTests = 0;

function assert(description: string, condition: boolean, detail?: string) {
  totalTests++;
  if (condition) {
    totalPassed++;
    console.log(`  ✓ PASS: ${description}`);
  } else {
    console.error(`  ✗ FAIL: ${description} ${detail ? `(${detail})` : ''}`);
  }
}

async function runTests() {
  const root = path.resolve('./temp_test_root');

  // --- 1. Path Containment Tests ---
  console.log('\n--- 1. Path Containment & Traversal Security ---');
  assert('Child path is contained', isPathContained(root, path.join(root, 'subfolder', 'file.txt')));
  assert('Root itself is contained', isPathContained(root, root));
  assert('Parent traversal (..) is rejected', !isPathContained(root, path.join(root, '..', 'other.txt')));
  assert('Deep traversal (../../Windows) is rejected', !isPathContained(root, path.join(root, '..', '..', 'Windows')));
  assert('Different drive letter is rejected', !isPathContained('C:\\Folder', 'D:\\Folder\\file.txt'));

  // --- 2. Safe Destination Resolution Tests ---
  console.log('\n--- 2. Safe Destination Resolution ---');
  try {
    const valid = resolveSafeDestination(root, 'Documents/Reports', 'Summary_2026.pdf');
    assert('Valid relative destination resolves correctly', isPathContained(root, valid.safePath));
    assert('Relative path is constructed cleanly', valid.relativePath.replace(/\\/g, '/') === 'Documents/Reports/Summary_2026.pdf');
  } catch (e) {
    assert('Valid relative destination threw unexpectedly', false, String(e));
  }

  let caughtTraversal = false;
  try {
    resolveSafeDestination(root, '../../escaped_folder', 'file.txt');
  } catch {
    caughtTraversal = true;
  }
  assert('Rejects traversal destination (../../escaped_folder)', caughtTraversal);

  let caughtAbsolute = false;
  try {
    resolveSafeDestination(root, 'C:/System32', 'file.txt');
  } catch {
    caughtAbsolute = true;
  }
  assert('Rejects absolute destination path with drive letter', caughtAbsolute);

  let caughtIllegalChar = false;
  try {
    resolveSafeDestination(root, 'Documents', 'bad:filename.pdf');
  } catch {
    caughtIllegalChar = true;
  }
  assert('Rejects Windows illegal characters in filename', caughtIllegalChar);

  let caughtReserved = false;
  try {
    resolveSafeDestination(root, 'Documents', 'CON.txt');
  } catch {
    caughtReserved = true;
  }
  assert('Rejects Windows reserved device names (CON.txt)', caughtReserved);

  // --- 3. Live File Scanner Verification on Sandbox Directory ---
  console.log('\n--- 3. Live File Scanner on Sandbox Directory ---');
  const sandboxDir = path.resolve('./temp_scanner_sandbox');
  if (fs.existsSync(sandboxDir)) {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }

  try {
    fs.mkdirSync(path.join(sandboxDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(sandboxDir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(sandboxDir, 'node_modules'), { recursive: true });

    // Normal files
    fs.writeFileSync(path.join(sandboxDir, 'docs', 'readme.txt'), 'SlothSort: Safe local-AI file organizer project notes.');
    fs.writeFileSync(path.join(sandboxDir, 'data.json'), '{"appName": "SlothSort", "version": "0.1.0"}');
    fs.writeFileSync(path.join(sandboxDir, 'Screenshot 2026-10-20.png'), 'fake-png-content');

    // Ignored directory files (must NOT be scanned)
    fs.writeFileSync(path.join(sandboxDir, '.git', 'HEAD'), 'ref: refs/heads/master');
    fs.writeFileSync(path.join(sandboxDir, 'node_modules', 'dep.js'), 'console.log("ignore me")');

    // Sensitive files (content excerpt MUST be suppressed)
    fs.writeFileSync(path.join(sandboxDir, '.env'), 'SECRET_KEY=supersecretkey12345');
    fs.writeFileSync(path.join(sandboxDir, 'id_rsa'), '-----BEGIN RSA PRIVATE KEY-----');
    fs.mkdirSync(path.join(sandboxDir, '.ssh'), { recursive: true });
    fs.writeFileSync(path.join(sandboxDir, '.ssh', 'id_ed25519'), 'private key content');

    const progressFiles: string[] = [];
    const scanResult = await scanFolder(sandboxDir, (file) => {
      progressFiles.push(file.metadata.filename);
    });

    assert('Discovered 5 valid files (3 normal + 2 sensitive, ignored .git, node_modules, .ssh)', scanResult.files.length === 5);
    assert('Skipped count recorded ignored directories', scanResult.skippedCount >= 3);
    assert('Total bytes aggregated correctly', scanResult.totalBytes > 0);

    const txtFile = scanResult.files.find((f) => f.metadata.filename === 'readme.txt');
    assert('Text excerpt extracted from readme.txt', txtFile?.metadata.textExcerpt?.includes('SlothSort: Safe local-AI') === true);

    const envFile = scanResult.files.find((f) => f.metadata.filename === '.env');
    assert('.env is flagged as sensitive', envFile?.metadata.isSensitiveExcluded === true);
    assert('.env text excerpt is strictly undefined (suppressed)', envFile?.metadata.textExcerpt === undefined);

    const rsaFile = scanResult.files.find((f) => f.metadata.filename === 'id_rsa');
    assert('id_rsa is flagged as sensitive', rsaFile?.metadata.isSensitiveExcluded === true);
    assert('id_rsa text excerpt is strictly undefined (suppressed)', rsaFile?.metadata.textExcerpt === undefined);

    const screenshotFile = scanResult.files.find((f) => f.metadata.filename === 'Screenshot 2026-10-20.png');
    assert('Screenshot signal detected from filename', screenshotFile?.metadata.isScreenshotHint === true);

    assert('Progress callback fired for each file', progressFiles.length === 5);
    assert('Deterministic IDs generated for all files', scanResult.files.every((f) => f.id && f.id.length === 16));
  } finally {
    if (fs.existsSync(sandboxDir)) {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`SUMMARY: ${totalPassed}/${totalTests} tests passed (${Math.round((totalPassed / totalTests) * 100)}%).`);
  console.log('='.repeat(70) + '\n');

  if (totalPassed !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
