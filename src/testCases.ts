import { TestCase } from './types.js';

export const SYNTHETIC_TEST_CASES: TestCase[] = [
  // 1. Clearly identifiable document
  {
    id: 'DOC-01',
    description: 'Clearly identifiable financial document',
    input: {
      filename: 'Q3_2026_Financial_Report.pdf',
      extension: '.pdf',
      sizeBytes: 1542000,
      mimeType: 'application/pdf',
      textExcerpt: 'Executive Summary: Q3 2026 Revenue grew by 14% year-over-year. Operating income reached $4.2M.'
    },
    expectedCategory: 'Documents'
  },

  // 2. Clearly identifiable document (Word document)
  {
    id: 'DOC-02',
    description: 'Employment contract with clear legal text',
    input: {
      filename: 'Employment_Agreement_Jane_Doe.docx',
      extension: '.docx',
      sizeBytes: 89000,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      textExcerpt: 'STANDARD EMPLOYMENT AGREEMENT. This Agreement is entered into between Acme Corp and Jane Doe.'
    },
    expectedCategory: 'Documents'
  },

  // 3. Clearly identifiable image
  {
    id: 'IMG-01',
    description: 'Clearly named family photograph',
    input: {
      filename: 'family_vacation_alps_2025.jpg',
      extension: '.jpg',
      sizeBytes: 4200000,
      mimeType: 'image/jpeg',
      textExcerpt: 'EXIF: Camera Canon EOS R6, Exposure 1/250s, ISO 100, Location: Swiss Alps'
    },
    expectedCategory: 'Images'
  },

  // 4. Generic camera filename
  {
    id: 'IMG-02',
    description: 'Generic camera filename with sunset image metadata',
    input: {
      filename: 'IMG_4921.png',
      extension: '.png',
      sizeBytes: 5200000,
      mimeType: 'image/png',
      textExcerpt: 'Visual content hint: High dynamic range photograph of ocean sunset with orange sky and reflections.'
    },
    expectedCategory: 'Images'
  },

  // 5. Screenshot filename
  {
    id: 'SCR-01',
    description: 'Standard Windows screenshot filename with error dialog hint',
    input: {
      filename: 'Screenshot 2026-10-15 142301.png',
      extension: '.png',
      sizeBytes: 890000,
      mimeType: 'image/png',
      isScreenshotHint: true,
      textExcerpt: 'OCR text detected: Error 404: The requested resource could not be found. Retry or Cancel.'
    },
    expectedCategory: 'Screenshots'
  },

  // 6. Ambiguous filename - notes
  {
    id: 'AMB-01',
    description: 'Ambiguous filename notes.txt with marketing meeting notes',
    input: {
      filename: 'notes.txt',
      extension: '.txt',
      sizeBytes: 2400,
      mimeType: 'text/plain',
      textExcerpt: 'Marketing Sync 10/12: Review campaign deliverables for Q4 launch. Action items: Alice sends final assets.'
    },
    expectedCategory: 'Documents'
  },

  // 7. Ambiguous filename - script vs project
  {
    id: 'AMB-02',
    description: 'Ambiguous filename setup.py with Python package configuration',
    input: {
      filename: 'setup.py',
      extension: '.py',
      sizeBytes: 1200,
      mimeType: 'text/x-python',
      textExcerpt: 'from setuptools import setup, find_packages\nsetup(name="sloth-data", version="0.1.0", packages=find_packages())'
    },
    expectedCategory: 'Projects'
  },

  // 8. Duplicate-looking document filename
  {
    id: 'DUP-01',
    description: 'Duplicate-looking document filename with copy suffix',
    input: {
      filename: 'Lease_Agreement_Final (1).docx',
      extension: '.docx',
      sizeBytes: 145000,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      textExcerpt: 'Residential Lease Agreement for 742 Evergreen Terrace. Monthly rent $1,800 due on 1st of month.'
    },
    expectedCategory: 'Documents'
  },

  // 9. Duplicate-looking image filename
  {
    id: 'DUP-02',
    description: 'Duplicate camera photo with Copy suffix',
    input: {
      filename: 'IMG_2048 - Copy (2).jpg',
      extension: '.jpg',
      sizeBytes: 3100000,
      mimeType: 'image/jpeg',
      textExcerpt: 'EXIF: Camera iPhone 15 Pro, Portrait mode photo of golden retriever dog in park.'
    },
    expectedCategory: 'Images'
  },

  // 10. Misleading extension - executable disguised as document
  {
    id: 'MIS-01',
    description: 'Executable disguised with double extension .pdf.exe',
    input: {
      filename: 'Invoice_Overdue_October.pdf.exe',
      extension: '.exe',
      sizeBytes: 7420000,
      mimeType: 'application/x-msdownload',
      textExcerpt: 'Binary headers: MZ PE32 executable for Windows. Contains embedded installer payload.'
    },
    expectedCategory: 'Installers',
    acceptableAlternative: 'Other'
  },

  // 11. Misleading extension - archive named as data
  {
    id: 'MIS-02',
    description: 'Compressed archive containing backups with extension .tar.gz',
    input: {
      filename: 'database_dump_october.tar.gz',
      extension: '.gz',
      sizeBytes: 52000000,
      mimeType: 'application/gzip',
      textExcerpt: 'GZIP compressed archive containing schema.sql and table dumps.'
    },
    expectedCategory: 'Archives'
  },

  // 12. Empty / insufficient context
  {
    id: 'EMP-01',
    description: 'Zero byte file with unknown generic extension',
    input: {
      filename: 'temp_scratch.dat',
      extension: '.dat',
      sizeBytes: 0,
      mimeType: 'application/octet-stream',
      textExcerpt: ''
    },
    expectedCategory: 'Other'
  },

  // 13. Insufficient context - generic untitled without extension
  {
    id: 'EMP-02',
    description: 'Untitled file without extension and minimal byte count',
    input: {
      filename: 'untitled_file_03',
      extension: '',
      sizeBytes: 14,
      mimeType: 'application/octet-stream',
      textExcerpt: 'test 1 2 3'
    },
    expectedCategory: 'Other'
  },

  // 14. Unicode filename (Japanese business spreadsheet)
  {
    id: 'UNI-01',
    description: 'Japanese unicode filename financial spreadsheet',
    input: {
      filename: '財務諸表_2026年度第3四半期.xlsx',
      extension: '.xlsx',
      sizeBytes: 670000,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      textExcerpt: '損益計算書 (Profit and Loss Statement): 売上高 120,000,000円, 営業利益 18,000,000円'
    },
    expectedCategory: 'Documents'
  },

  // 15. Unicode filename (French résumé with accents)
  {
    id: 'UNI-02',
    description: 'French accented unicode résumé',
    input: {
      filename: 'curriculum_vitæ_ingénieur_logiciel_2026.pdf',
      extension: '.pdf',
      sizeBytes: 240000,
      mimeType: 'application/pdf',
      textExcerpt: 'Curriculum Vitae: Ingénieur en développement logiciel senior, spécialité Rust et TypeScript.'
    },
    expectedCategory: 'Documents'
  },

  // 16. Unusually long filename - document
  {
    id: 'LNG-01',
    description: 'Unusually long document filename (over 120 characters)',
    input: {
      filename: 'hacktoberfest_2026_challenge_slothsort_planning_meeting_notes_draft_revision_final_approved_by_committee.docx',
      extension: '.docx',
      sizeBytes: 95000,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      textExcerpt: 'Meeting Notes: Discussion on SlothSort architecture, local inference privacy guarantees, and safety rails.'
    },
    expectedCategory: 'Documents'
  },

  // 17. Unusually long filename - log output
  {
    id: 'LNG-02',
    description: 'Unusually long filename log output file',
    input: {
      filename: 'system_diagnostic_telemetry_dump_cluster_node_worker_us_east_primary_timestamp_20261020_083042_status_ok.log',
      extension: '.log',
      sizeBytes: 3400000,
      mimeType: 'text/plain',
      textExcerpt: '2026-10-20 08:30:42 [INFO] Health check passed for 48/48 worker nodes. Latency 2.3ms.'
    },
    expectedCategory: 'Other',
    acceptableAlternative: 'Documents'
  },

  // 18. Software installer (MSI)
  {
    id: 'INS-01',
    description: 'Node.js official Windows installer MSI package',
    input: {
      filename: 'node-v26.10.0-x64.msi',
      extension: '.msi',
      sizeBytes: 32000000,
      mimeType: 'application/x-msi',
      textExcerpt: 'Windows Installer Package: Node.js JavaScript Runtime 64-bit setup wizard.'
    },
    expectedCategory: 'Installers'
  },

  // 19. Software installer (EXE setup)
  {
    id: 'INS-02',
    description: 'VS Code official Windows installer executable',
    input: {
      filename: 'VSCodeUserSetup-x64-1.95.0.exe',
      extension: '.exe',
      sizeBytes: 98000000,
      mimeType: 'application/x-msdownload',
      textExcerpt: 'Inno Setup Installer: Visual Studio Code user setup executable.'
    },
    expectedCategory: 'Installers'
  },

  // 20. Compressed archive (.zip)
  {
    id: 'ARC-01',
    description: 'Project zip archive backup',
    input: {
      filename: 'slothsort_backup_source_code_20261019.zip',
      extension: '.zip',
      sizeBytes: 18500000,
      mimeType: 'application/zip',
      textExcerpt: 'ZIP archive containing src/, package.json, and documentation assets.'
    },
    expectedCategory: 'Archives'
  },

  // 21. Source code project manifest
  {
    id: 'PRJ-01',
    description: 'Node.js package.json project configuration manifest',
    input: {
      filename: 'package.json',
      extension: '.json',
      sizeBytes: 850,
      mimeType: 'application/json',
      textExcerpt: '{\n  "name": "desktop-audio-recorder",\n  "version": "1.0.0",\n  "dependencies": { "electron": "^33.0.0" }\n}'
    },
    expectedCategory: 'Projects'
  },

  // 22. Source code implementation file
  {
    id: 'PRJ-02',
    description: 'Rust source code file for CLI utility',
    input: {
      filename: 'main.rs',
      extension: '.rs',
      sizeBytes: 2400,
      mimeType: 'text/x-rust',
      textExcerpt: 'fn main() {\n    println!("Starting SlothSort worker daemon...");\n}'
    },
    expectedCategory: 'Projects'
  },

  // 23. Audio media file
  {
    id: 'MED-01',
    description: 'Audio podcast episode file',
    input: {
      filename: 'podcast_episode_42_slow_and_steady.mp3',
      extension: '.mp3',
      sizeBytes: 65000000,
      mimeType: 'audio/mpeg',
      textExcerpt: 'ID3 Tag: Title="The Slow and Steady Mindset", Artist="Tech Pod", Album="Hacktoberfest 2026"'
    },
    expectedCategory: 'Other'
  },

  // 24. Screenshot with default camera roll naming pattern
  {
    id: 'SCR-02',
    description: 'Mobile screenshot with Screenshot prefix',
    input: {
      filename: 'Screenshot_20261020-110412.png',
      extension: '.png',
      sizeBytes: 1250000,
      mimeType: 'image/png',
      isScreenshotHint: true,
      textExcerpt: 'Mobile screen capture showing battery status, notifications, and WhatsApp chat view.'
    },
    expectedCategory: 'Screenshots'
  }
];

/**
 * Synthetic malformed responses to rigorously test the validator in Step 3 / Step 4
 */
export const SYNTHETIC_MALFORMED_RESPONSES = [
  {
    description: 'Non-JSON plain text response',
    raw: 'I think this file belongs in Documents because it is a PDF report.'
  },
  {
    description: 'Missing required field: category',
    raw: JSON.stringify({
      suggestedFilename: 'Valid_Name.pdf',
      proposedDestination: 'Documents',
      confidence: 'high',
      reasoning: 'Good file.'
    })
  },
  {
    description: 'Invalid category not in ALLOWED_CATEGORIES',
    raw: JSON.stringify({
      category: 'Spreadsheets', // Not in allowed list
      suggestedFilename: 'Valid_Name.xlsx',
      proposedDestination: 'Spreadsheets',
      confidence: 'high',
      reasoning: 'It is a spreadsheet.'
    })
  },
  {
    description: 'Windows illegal characters in suggestedFilename',
    raw: JSON.stringify({
      category: 'Documents',
      suggestedFilename: 'Report:2026*final?.pdf', // illegal : * ?
      proposedDestination: 'Documents',
      confidence: 'high',
      reasoning: 'Financial report.'
    })
  },
  {
    description: 'Windows reserved device name in suggestedFilename',
    raw: JSON.stringify({
      category: 'Documents',
      suggestedFilename: 'CON.pdf', // reserved CON
      proposedDestination: 'Documents',
      confidence: 'high',
      reasoning: 'Reserved name test.'
    })
  },
  {
    description: 'Directory traversal attempt in proposedDestination',
    raw: JSON.stringify({
      category: 'Documents',
      suggestedFilename: 'Escaped.pdf',
      proposedDestination: '../../../../Windows/System32', // directory traversal
      confidence: 'high',
      reasoning: 'Malicious traversal attempt.'
    })
  },
  {
    description: 'Absolute path with drive letter in proposedDestination',
    raw: JSON.stringify({
      category: 'Documents',
      suggestedFilename: 'DrivePath.pdf',
      proposedDestination: 'C:/Program Files/Target', // absolute path
      confidence: 'high',
      reasoning: 'Absolute path attempt.'
    })
  },
  {
    description: 'Invalid confidence value',
    raw: JSON.stringify({
      category: 'Documents',
      suggestedFilename: 'Document.pdf',
      proposedDestination: 'Documents',
      confidence: 'very-high-100%', // invalid confidence
      reasoning: 'Certain.'
    })
  }
];
