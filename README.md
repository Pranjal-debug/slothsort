# SlothSort 🦥

> **"Slow and Steady"** — A privacy-first Windows desktop AI file organizer built for the Hacktoberfest 2026 Open-Source AI Challenge (Week 3).

SlothSort helps you declutter disorganized folders by intelligently classifying files, suggesting clean filenames, and proposing structured destination categories. Powered strictly by **local open-weight AI** (`gemma3:4b` via [Ollama](https://ollama.com/)), your documents and metadata **never leave your machine**.

Every action requires explicit human review and approval, and every file operation can be instantly reversed with **1-click verifiable undo**.

---

## 🌟 Key Features

- **100% Local & Offline Inference:** Powered by Google's `gemma3:4b` quantized model running via Ollama on local loopback (`127.0.0.1:11434`). Zero external network requests, zero telemetry, zero cloud API fees.
- **Strict Privacy Safeguards:** Developer secrets (`.env`, `id_rsa`, `.key`, `.pem`, `credentials.json`) and browser profile session data (`cookies`, `login data`) have text excerpts strictly suppressed. System directories (`.git`, `node_modules`, `$RECYCLE.BIN`) are automatically skipped.
- **Untrusted Model Guardrails:** All AI suggestions pass through strict programmatic Windows path validation (`src/validator.ts`). Illegal characters (`: * ? " < > |`), reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`), and directory traversal attacks (`..`) are rejected.
- **Human-in-the-Loop Approval Gate:** AI outputs are treated as untrusted proposals. Edit destinations or filenames freely; any edit invalidates previous approval and requires fresh review before execution.
- **Collision Protection:** Refuses to overwrite existing files at destination folders.
- **Verifiable 1-Click Undo:** Operations are recorded in an append-only JSONL journal with pre- and post-move SHA-256 fingerprints. Undo verifies destination integrity and returns files safely to their original paths.
- **Crash-Resilient Journaling:** Automatically recovers from interrupted writes or truncated lines without corrupting valid history.

---

## 🖥️ System Requirements & Supported Environment

| Component | Minimum Requirement | Tested Machine Specification |
|---|---|---|
| **Operating System** | Windows 10 (64-bit, 20H2+) | Windows 11 Home (64-bit, Build 10.0.26100) |
| **Processor (CPU)** | 4-Core x86_64 CPU with AVX2 support | AMD Ryzen 5 5500U (6 Cores / 12 Threads) |
| **System Memory (RAM)**| 8 GB DDR4 | 16 GB DDR4 |
| **Disk Storage** | 6 GB free space (for Ollama + `gemma3:4b`) | SSD (Dedicated drive for models recommended) |
| **Local AI Engine** | Ollama v0.40.0+ | Ollama v0.40.6 running on loopback (`127.0.0.1:11434`) |
| **AI Model** | `gemma3:4b` (~3.4 GB download) | `gemma3:4b` (downloaded separately via Ollama) |

---

## 🚀 Quick Start Guide (For Users)

### Step 1: Install Ollama & Download the Model

> **Note:** The AI model is **not bundled** with the desktop application binary and must be downloaded separately via Ollama.

1. Download and install **Ollama for Windows** from [ollama.com/download](https://ollama.com/download/windows).
2. Open Windows PowerShell or Command Prompt.
3. *(Optional)* If your `C:` drive has limited space, redirect model storage to another drive (e.g., `D:\ollama\models`):
   ```powershell
   [System.Environment]::SetEnvironmentVariable('OLLAMA_MODELS', 'D:\ollama\models', [System.EnvironmentVariableTarget]::User)
   ```
4. Download the `gemma3:4b` model:
   ```powershell
   ollama pull gemma3:4b
   ```
5. Confirm Ollama is running and the model is ready:
   ```powershell
   ollama list
   ```
   You should see `gemma3:4b` listed with a size of approximately `3.4 GB`.

### Step 2: Download & Launch SlothSort

1. Download the release package (`SlothSort-v0.1.1-win-x64.zip`) from the repository release page.
2. Extract the ZIP archive to a folder of your choice.
3. Double-click `SlothSort.exe`.
   > **Note on Windows SmartScreen:** Because SlothSort is an open-source project without an expensive commercial Authenticode certificate, Windows Defender SmartScreen may display an *"Unrecognized app"* warning on initial run. Click **"More info"** and then **"Run anyway"**.

---

## 📖 How SlothSort Works

```text
[ Select Folder ] ──► [ Safe Scan & Privacy Filter ] ──► [ Sequential Queue (Local AI) ]
                                                                      │
[ Atomic 1-Click Undo ] ◄── [ Batch Execution ] ◄── [ Human Review & Approval ]
```

### 1. Select a Folder
Click **"Select Folder"** to choose the directory you want to organize. SlothSort performs a non-destructive read-only scan.

### 2. File Scanning & Privacy Rules
- **Standard Text / Code / Docs:** Scanned with safe, bounded text excerpts (up to 500 characters) to help the AI understand context.
- **Binary / Media Files (Images, Archives, Installers):** Classified based purely on **filename and metadata** (size, extension, timestamps). File contents are never read into memory.
- **Sensitive Files (`.env`, `id_rsa`, `.key`, `.pem`, `credentials.json`, `cookies`):** Excerpts are **100% suppressed** (`textExcerpt: undefined`). The AI only knows the filename exists, preventing accidental token leakage.
- **Excluded Directories (`.git`, `node_modules`, `$RECYCLE.BIN`, browser user profiles):** Completely skipped during traversal.

### 3. Review & Approval
Suggestions appear in the staging queue with proposed categories, filenames, destinations, and reasoning:
- **Pending Review:** The default state for all incoming suggestions.
- **Approve:** Lock in the proposal with a cryptographic approval signature.
- **Edit:** Change the proposed destination or filename. Editing revokes previous approvals to prevent accidental moves.
- **Reject:** Dismiss the suggestion. The file remains in its original location.

### 4. Safe Execution
Click **"Execute Approved"** to perform moves. SlothSort:
- Revalidates approvals on the main process.
- Checks if the destination file already exists (refuses to overwrite).
- Moves the file and verifies cryptographic SHA-256 fingerprints before unlinking the source.
- Appends the operation record to an append-only `operations.jsonl` journal.

### 5. Instant Verifiable Undo
Made a mistake? Navigate to the **History** tab and click **"Undo"**. SlothSort verifies that the destination file has not been modified and safely returns the file to its original path.

---

## 📁 Supported Categories & File Types

SlothSort organizes files into 7 structured categories:
- **`Documents`**: `.pdf`, `.docx`, `.txt`, `.md`, `.csv`, `.xlsx`, `.pptx`, `.rtf`
- **`Images`**: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`, `.bmp`
- **`Screenshots`**: Automatically detected via filename cues and image dimensions
- **`Projects`**: `.ts`, `.js`, `.py`, `.rs`, `.go`, `.c`, `.cpp`, `.html`, `.css`, `.json`
- **`Installers`**: `.exe`, `.msi`, `.pkg`, `.dmg`
- **`Archives`**: `.zip`, `.tar`, `.gz`, `.7z`, `.rar`
- **`Other`**: Miscellaneous files requiring manual sorting

---

## 🐢 Why "Slow and Steady"?

In an era of cloud AI tools that rush to process entire hard drives in seconds by streaming private files to remote servers, SlothSort takes a deliberate, privacy-first approach:

1. **Local CPU Inference:** Runs comfortably on everyday laptops without requiring high-end GPUs or cloud subscriptions.
2. **Paced Sequential Queue:** Processes one file at a time to keep your PC cool and responsive.
3. **No Blind Automation:** AI suggests; you decide. Nothing moves without your explicit consent.
4. **Crash-Resilient Durability:** Interrupted operations or power cuts are safely reconciled on startup.

---

## 🛠️ Developer Setup & Automated Testing

### Prerequisites
- Node.js 20+ (tested on v20.18.1 and v26.10.0)
- npm 10+
- Ollama running locally on `127.0.0.1:11434` with `gemma3:4b`

### Installation
```bash
git clone <repository-url>
cd slothsort
npm install
```

### Running in Development Mode
To start the Vite development server and Electron shell:
```bash
# Terminal 1: Run Vite dev server
npm run dev

# Terminal 2: Launch Electron app
npm start
```

### Running Automated Test Suites (162 Deterministic Tests)
SlothSort includes 6 comprehensive, non-destructive test suites (**100% pass rate**):
```bash
# Run all deterministic unit, integration, lifecycle, and hardening tests (162 tests)
npm test

# Run individual test suites:
npm run test:validator   # 29 tests: Windows path & filename sanitizer
npm run test:scanner     # 22 tests: Boundary containment & secret exclusions
npm run test:queue       # 22 tests: Sequential FIFO worker & concurrency
npm run test:executor    # 40 tests: Approval contracts, collisions, undo & journal
npm run test:audit       # 39 tests: Full end-to-end lifecycle & crash recovery
npm run test:hardening   # 10 tests: Symlink boundaries, fingerprint, review, privacy, and package checks

# Run live loopback verification (requires Ollama and gemma3:4b)
npm run test:offline
```

### Building the Production Executable
```bash
# Compile renderer (Vite) and main process (TypeScript)
npm run build

# Package standalone Windows executable (outputs to dist/package/win-unpacked/)
npm run package
```

---

## 🗂️ Project Architecture

```text
slothsort/
├── src/
│   ├── main/                 # Electron main process (Node.js runtime)
│   │   ├── executor.ts       # Atomic move engine, collision checks & undo
│   │   ├── fingerprint.ts    # Cryptographic SHA-256 fingerprint generator
│   │   ├── ipc.ts            # Type-safe IPC channels & security filters
│   │   ├── journal.ts        # Resilient JSONL journal & corrupt-tail recovery
│   │   ├── main.ts           # Window lifecycle, CSP & navigation guards
│   │   ├── pathSecurity.ts   # Boundary containment & Windows path resolver
│   │   ├── preload.ts        # Context-isolated bridge exposing window.electronAPI
│   │   ├── queue.ts          # Sequential FIFO inference queue & review states
│   │   └── scanner.ts        # Non-destructive crawler with secret suppression
│   ├── renderer/             # Frontend UI (React 19 + TypeScript + CSS)
│   │   ├── App.tsx           # Main application state machine & tab router
│   │   ├── index.html        # Clean HTML5 entry point
│   │   └── styles/index.css  # Modern responsive dark-mode styling
│   ├── ollamaClient.ts       # Loopback HTTP client for Ollama daemon
│   ├── validator.ts          # Programmatic schema & Windows filename sanitizer
│   └── types.ts              # Shared domain models & IPC interfaces
├── test/                     # Automated test suites (162 deterministic tests)
├── scripts/                  # E2E validation & Phase 3B audit drivers
├── artifacts/                # Validation reports, manifests & screenshots
├── package.json
├── package-lock.json
├── tsconfig.json
├── LICENSE
└── README.md
```

---

## ⚠️ Known Limitations & Operational Notes

1. **Observed CPU Inference Latency:** On the tested hardware (AMD Ryzen 5 5500U, 16 GB RAM), inference latency was measured between **19.6 seconds and 20.7 seconds per file**. We recommend organizing folders in batches of 10 to 30 files at a time.
2. **Unsigned Windows Binary:** The packaged executable is not signed with a commercial certificate. Windows Defender SmartScreen will prompt for approval on first run.
3. **Cross-Volume Moves:** Moving files across different drives (e.g., from `D:` to `C:`) uses an atomic copy-verify-unlink routine. If space is exhausted on the destination drive, the operation safely rolls back.
4. **Offline Scope:** SlothSort requires no internet connection for core inference, but Ollama itself requires network access initially to download model weights.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
