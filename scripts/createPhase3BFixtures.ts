import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface FixtureFileDef {
  relativePath: string;
  content: Buffer | string;
  expectedStatus: 'scanned' | 'excluded_directory' | 'sensitive_suppressed';
  expectedScenario: string;
}

const TEST_ROOT = 'D:\\SlothSort-Phase3B-Test';
const FIXTURES_DIR = path.join(TEST_ROOT, 'workspace', 'fixtures');
const PROFILE_DIR = path.join(TEST_ROOT, 'profile');
const MANIFEST_PATH = path.resolve('artifacts', 'phase-3b', 'phase-3b-manifest.json');

// Helper to compute sha256
export function computeSha256(data: Buffer | string): string {
  const hash = crypto.createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

export function getFixtureDefinitions(): FixtureFileDef[] {
  // Dummy headers for media / archives / PE
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]);
  const zipHeader = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const exeHeader = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);

  // Large text: 70 KB of repetitive synthetic log data
  const oversizedText = 'SLOTHSORT_SYNTHETIC_LOG_ENTRY_TIMESTAMP_2026_TEST_PADDING_ROW_CONTENT\n'.repeat(1024);

  return [
    // 1. Standard text & Markdown documents
    {
      relativePath: 'docs/notes.md',
      content: '# Project Meeting Notes\nSynthetic notes discussing quarterly milestones and architecture designs.\n',
      expectedStatus: 'scanned',
      expectedScenario: 'Standard markdown document scan and categorization'
    },
    {
      relativePath: 'docs/report.txt',
      content: 'Quarterly financial summary and cost breakdown for testing purposes.\nRevenue: 100000\nExpenses: 45000\n',
      expectedStatus: 'scanned',
      expectedScenario: 'Standard plain text document scan with excerpt extraction'
    },
    {
      relativePath: 'docs/small_preview.txt',
      content: 'Small text file for testing preview extraction (< 1 KB).\n',
      expectedStatus: 'scanned',
      expectedScenario: 'Small text file within normal excerpt limits'
    },
    {
      relativePath: 'docs/oversized_log.txt',
      content: oversizedText,
      expectedStatus: 'scanned',
      expectedScenario: 'Oversized text file (>64 KB) to verify excerpt truncation limits'
    },

    // 2. Source code
    {
      relativePath: 'src/calculator.ts',
      content: 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
      expectedStatus: 'scanned',
      expectedScenario: 'TypeScript source file classification into Developer/Code'
    },

    // 3. Representative binary files
    {
      relativePath: 'media/image_01.png',
      content: pngHeader,
      expectedStatus: 'scanned',
      expectedScenario: 'Image binary recognition without text excerpt'
    },
    {
      relativePath: 'archives/bundle.zip',
      content: zipHeader,
      expectedStatus: 'scanned',
      expectedScenario: 'Archive file recognition into Archives category'
    },
    {
      relativePath: 'installers/setup.exe',
      content: exeHeader,
      expectedStatus: 'scanned',
      expectedScenario: 'Executable recognition into Installers/Executables'
    },

    // 4. Nested directories at multiple depths
    {
      relativePath: 'docs/deep/level1/level2/nested_plan.txt',
      content: 'Deeply nested strategic plan file for recursive scanner depth verification.\n',
      expectedStatus: 'scanned',
      expectedScenario: 'Nested directory traversal at depth 3+'
    },

    // 5. Duplicate content pair
    {
      relativePath: 'duplicates/original_copy.txt',
      content: 'SLOTHSORT_SYNTHETIC_DUPLICATE_CONTENT_12345_TEST_PAYLOAD\n',
      expectedStatus: 'scanned',
      expectedScenario: 'First file of identical content pair'
    },
    {
      relativePath: 'duplicates/duplicate_copy.txt',
      content: 'SLOTHSORT_SYNTHETIC_DUPLICATE_CONTENT_12345_TEST_PAYLOAD\n',
      expectedStatus: 'scanned',
      expectedScenario: 'Second file of identical content pair (hash match verification)'
    },

    // 6. Destination collision pair
    {
      relativePath: 'collision_source/conflict_target.txt',
      content: 'SOURCE_VERSION_CONTENT_A_UNIQUE_HASH_1111\n',
      expectedStatus: 'scanned',
      expectedScenario: 'Source file intended for move to an already occupied destination'
    },
    {
      relativePath: 'Documents/conflict_target.txt',
      content: 'EXISTING_DESTINATION_CONTENT_B_UNIQUE_HASH_2222\n',
      expectedStatus: 'scanned',
      expectedScenario: 'Pre-existing file at target destination to trigger collision refusal'
    },

    // 7. Unicode, whitespace, and long filenames
    {
      relativePath: 'special/Project Plan Final Version 2026.txt',
      content: 'Testing spaces in filenames and directory names safely on Windows.\n',
      expectedStatus: 'scanned',
      expectedScenario: 'Whitespace in file name handling'
    },
    {
      relativePath: 'special/Résumé_Données_Projet_日本語.txt',
      content: 'Unicode multi-byte characters and accents test: é, è, ç, 日本語, 測試.\n',
      expectedStatus: 'scanned',
      expectedScenario: 'Unicode and international character set resilience'
    },
    {
      relativePath: 'special/a_very_long_descriptive_filename_for_windows_compatibility_testing_with_more_than_one_hundred_characters_in_name.txt',
      content: 'Testing long filename within standard Windows path limits.\n',
      expectedStatus: 'scanned',
      expectedScenario: 'Long filename (>100 characters) path compatibility'
    },

    // 8. Sensitive-looking fake files (excerpt must be strictly suppressed)
    {
      relativePath: 'secrets/.env.local',
      content: 'SYNTHETIC_FAKE_API_KEY=dummy_value_do_not_use\nPORT=3000\n',
      expectedStatus: 'sensitive_suppressed',
      expectedScenario: 'Sensitive .env pattern: excerpt must be suppressed'
    },
    {
      relativePath: 'secrets/id_rsa_test',
      content: '-----BEGIN FAKE RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0synthetic_fake_key_data_never_real\n-----END FAKE RSA PRIVATE KEY-----\n',
      expectedStatus: 'sensitive_suppressed',
      expectedScenario: 'Sensitive RSA key pattern: excerpt must be suppressed'
    },
    {
      relativePath: 'secrets/sample.pem',
      content: '-----BEGIN FAKE CERTIFICATE-----\nFAKE_PEM_DATA\n-----END FAKE CERTIFICATE-----\n',
      expectedStatus: 'sensitive_suppressed',
      expectedScenario: 'Sensitive PEM pattern: excerpt must be suppressed'
    },
    {
      relativePath: 'secrets/sample.key',
      content: 'FAKE_KEY_DATA_SAMPLE\n',
      expectedStatus: 'sensitive_suppressed',
      expectedScenario: 'Sensitive .key pattern: excerpt must be suppressed'
    },
    {
      relativePath: 'secrets/credentials-demo.json',
      content: '{\n  "synthetic_demo_client_id": "fake_id_12345",\n  "synthetic_demo_secret": "fake_secret_67890"\n}\n',
      expectedStatus: 'sensitive_suppressed',
      expectedScenario: 'Sensitive credentials pattern: excerpt must be suppressed'
    },
    {
      relativePath: 'secrets/cookies-demo.txt',
      content: 'synthetic_domain.test\tTRUE\t/\tFALSE\t1893456000\tsession_token\tfake_session_val\n',
      expectedStatus: 'sensitive_suppressed',
      expectedScenario: 'Sensitive cookies pattern: excerpt must be suppressed'
    },

    // 9. Excluded directories (entire directory must be skipped by scanner)
    {
      relativePath: '.git/config',
      content: '[core]\n  repositoryformatversion = 0\n  filemode = false\n  bare = false\n',
      expectedStatus: 'excluded_directory',
      expectedScenario: 'Excluded .git directory: must be skipped completely'
    },
    {
      relativePath: 'node_modules/dummy-pkg/index.js',
      content: 'module.exports = "synthetic";\n',
      expectedStatus: 'excluded_directory',
      expectedScenario: 'Excluded node_modules directory: must be skipped completely'
    },
    {
      relativePath: '$RECYCLE.BIN/deleted_test.tmp',
      content: 'synthetic deleted file stub\n',
      expectedStatus: 'excluded_directory',
      expectedScenario: 'Excluded system recycle bin: must be skipped completely'
    },
    {
      relativePath: '.slothsort/internal_state.json',
      content: '{"session": "synthetic_internal_state"}\n',
      expectedStatus: 'excluded_directory',
      expectedScenario: 'Excluded .slothsort directory: must be skipped completely'
    },
    {
      relativePath: 'chrome/Default/Network/Cookies',
      content: 'SYNTHETIC_CHROME_COOKIE_SQLITE_HEADER\n',
      expectedStatus: 'excluded_directory',
      expectedScenario: 'Excluded browser user data directory: must be skipped completely'
    },
    {
      relativePath: 'firefox/Profiles/test.default/places.sqlite',
      content: 'SYNTHETIC_FIREFOX_PLACES_SQLITE_HEADER\n',
      expectedStatus: 'excluded_directory',
      expectedScenario: 'Excluded Firefox profile directory: must be skipped completely'
    }
  ];
}

export function buildFixtures(): void {
  console.log(`[Stage 1] Setting up synthetic fixture workspace at ${FIXTURES_DIR}...`);

  // Ensure fresh fixture and profile directories
  if (fs.existsSync(FIXTURES_DIR)) {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const defs = getFixtureDefinitions();
  const manifestItems = [];

  for (const def of defs) {
    const fullPath = path.join(FIXTURES_DIR, def.relativePath);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(fullPath, def.content);
    const stat = fs.statSync(fullPath);
    const sha256 = computeSha256(def.content);

    manifestItems.push({
      relativePath: def.relativePath.replace(/\\/g, '/'),
      absolutePath: fullPath,
      fileSizeBytes: stat.size,
      initialSha256: sha256,
      expectedStatus: def.expectedStatus,
      expectedScenario: def.expectedScenario,
      postTestStatus: null,
      postTestSha256: null,
      discrepancyNote: null
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    fixturesRoot: FIXTURES_DIR,
    profileRoot: PROFILE_DIR,
    totalFilesCreated: manifestItems.length,
    filesExpectedScanned: manifestItems.filter((i) => i.expectedStatus === 'scanned').length,
    filesExpectedSensitiveSuppressed: manifestItems.filter((i) => i.expectedStatus === 'sensitive_suppressed').length,
    filesExpectedExcludedDir: manifestItems.filter((i) => i.expectedStatus === 'excluded_directory').length,
    files: manifestItems
  };

  const manifestDir = path.dirname(MANIFEST_PATH);
  if (!fs.existsSync(manifestDir)) {
    fs.mkdirSync(manifestDir, { recursive: true });
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`[Stage 1] Generated ${manifestItems.length} synthetic files.`);
  console.log(`[Stage 1] Scanned expected: ${manifest.filesExpectedScanned}, Sensitive: ${manifest.filesExpectedSensitiveSuppressed}, Excluded Dirs: ${manifest.filesExpectedExcludedDir}`);
  console.log(`[Stage 1] Baseline manifest written to ${MANIFEST_PATH}`);
}

if (process.argv[1]?.endsWith('createPhase3BFixtures.ts')) {
  buildFixtures();
}
