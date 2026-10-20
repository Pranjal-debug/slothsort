# SlothSort Phase 3B — Evidence Index & Test Artifacts

**Date:** October 20, 2026  
**Target Artifact:** `dist/package/win-unpacked/SlothSort.exe` (SHA-256 verified)  
**Dedicated Test Workspace:** `D:\SlothSort-Phase3B-Test\`  

---

## 1. Evidence Artifact Index

This index links all primary evidence generated during the Phase 3B packaged application validation. All paths are relative to `artifacts/phase-3b/` or the repository root.

| Evidence Type | File Path / Identifier | Description |
|---|---|---|
| **Baseline & Final Manifest** | [`phase-3b-manifest.json`](./phase-3b-manifest.json) | Complete record of all 28 synthetic fixtures, expected vs. observed statuses, initial and post-test SHA-256 hashes. |
| **Comprehensive Report** | [`phase-3b-report.md`](./phase-3b-report.md) | Full technical report covering methodology, environment, stage results, metrics, and sign-off. |
| **Defect & Findings Log** | [`phase-3b-defects.md`](./phase-3b-defects.md) | Detailed defect breakdown, severities, remediation histories, and residual platform advisories. |
| **Executive Summary** | [`phase-3b-summary.md`](./phase-3b-summary.md) | High-level summary of validation findings and release recommendation. |

---

## 2. Packaged UI Screenshots

All screenshots were captured directly from the live packaged `SlothSort.exe` process running on Windows 11 via Chrome DevTools Protocol automation.

| Stage | Screenshot Filename | Description | File Size |
|---|---|---|---|
| **Stage 2** | [`screenshots/stage2_initial_launch.png`](./screenshots/stage2_initial_launch.png) | First-run packaged application window rendering clean `#root` DOM. | 109 KB |
| **Stage 2** | [`screenshots/stage2_relaunch.png`](./screenshots/stage2_relaunch.png) | Clean restart and window rendering from isolated profile directory. | 109 KB |
| **Stage 10.1** | [`screenshots/stage10_01_launch.png`](./screenshots/stage10_01_launch.png) | End-to-end journey initial launch ready for folder selection. | 109 KB |
| **Stage 10.2** | [`screenshots/stage10_02_scanned.png`](./screenshots/stage10_02_scanned.png) | Discovered synthetic folder and populated file metadata card. | 128 KB |
| **Stage 10.3** | [`screenshots/stage10_03_inference_review.png`](./screenshots/stage10_03_inference_review.png) | Real local Ollama proposal received and displayed in staging queue (`pending_review`). | 153 KB |
| **Stage 10.4** | [`screenshots/stage10_04_approved.png`](./screenshots/stage10_04_approved.png) | Proposal edited by user and re-approved with cryptographic signature. | 150 KB |
| **Stage 10.5** | [`screenshots/stage10_05_executed.png`](./screenshots/stage10_05_executed.png) | Approved file operation executed; destination confirmed and source unlinked. | 148 KB |
| **Stage 10.6** | [`screenshots/stage10_06_history.png`](./screenshots/stage10_06_history.png) | Operation recorded in persistent history view with `completed` status. | 147 KB |
| **Stage 10.7** | [`screenshots/stage10_07_undone.png`](./screenshots/stage10_07_undone.png) | File restored via atomic undo; original path and hash verified; status changed to `undone`. | 147 KB |
| **Stage 10.8** | [`screenshots/stage10_08_relaunch_history.png`](./screenshots/stage10_08_relaunch_history.png) | Application restarted; history reloaded from journal confirming persistent `undone` status. | 109 KB |

---

## 3. Automation Scripts & Reproduction Commands

The following standalone Node.js automation scripts were created to execute and verify each stage against the packaged binary and isolated workspace without modifying production application code:

### Stage 2: Packaged App & Security Checks
- **Script:** `scripts/runStage2PackagedChecks.ts`
- **Execution Command:**
  ```powershell
  npx tsx scripts/runStage2PackagedChecks.ts
  ```
- **Observed Output:**
  ```text
  [Stage 2] Launching packaged executable: D:\downloads\Movies\hacktoberfest\slothsort\dist\package\win-unpacked\SlothSort.exe
  [Stage 2] Connected via CDP. Page title: SlothSort
  [Stage 2] Evaluating Electron security properties...
  [Stage 2] Security check: contextIsolation=true, nodeIntegration=false, sandbox=true
  [Stage 2] Initial launch verified. Closing cleanly...
  [Stage 2] Testing relaunch from isolated profile...
  [Stage 2] Relaunch verified. 17 files in isolated profile directory.
  [Stage 2] SUCCESS: Packaged binary first-run and security checks PASSED.
  ```

### Stage 3: Scanner & Privacy Verification
- **Script:** `scripts/runStage3ScannerVerification.ts`
- **Execution Command:**
  ```powershell
  npx tsx scripts/runStage3ScannerVerification.ts
  ```
- **Observed Output:**
  ```text
  [Stage 3.1] Running scanner on D:\SlothSort-Phase3B-Test\workspace\fixtures...
  [Stage 3.1] Discovered: 22 files, Total size: 72981 bytes, Skipped: 6 items.
  [Stage 3.9] Verifying post-scan file integrity and zero mutations across all 28 fixtures...
  [Stage 3] Scanner verification result: PASS (9/9 checks passed).
  PASSED: 28/28 SHA-256 hashes match baseline exactly.
  ```

### Stage 4: Local AI & Sequential Queue
- **Script:** `scripts/runStage4InferenceVerification.ts`
- **Execution Command:**
  ```powershell
  npx tsx scripts/runStage4InferenceVerification.ts
  ```
- **Observed Output:**
  ```text
  [Stage 4] Local Ollama daemon confirmed running on 127.0.0.1:11434 with model gemma3:4b.
  [Job 1] notes.md -> Inference complete in 20734 ms (Proposed: Documents/Meeting_Notes.md)
  [Job 2] calculator.ts -> Inference complete in 20568 ms (Proposed: Projects/calculator.ts)
  [Job 3] image_01.png -> Inference complete in 19658 ms (Proposed: Images/image_01.png, metadata-only)
  [Stage 4] Sequential queue enforcement verified: Concurrency strictly 1.
  [Stage 4] Cancellation and retry mechanisms verified.
  ```

### Stages 5, 6, 7: Safe Execution, Undo & Journal Recovery
- **Script:** `scripts/runStage567ExecutionUndoJournal.ts`
- **Execution Command:**
  ```powershell
  npx tsx scripts/runStage567ExecutionUndoJournal.ts
  ```
- **Observed Output:**
  ```text
  [Stage 5.1] Rejected proposal not executed, source untouched: PASSED
  [Stage 5.2] Proposal edit revokes approval signature: PASSED
  [Stage 5.3] Approved move succeeds, hash preserved: PASSED
  [Stage 5.4] Destination collision detected and refused: PASSED
  [Stage 5.5] Unsafe paths (../../) and reserved names (CON) blocked: PASSED
  [Stage 5.6] Locked file handling preserves source: PASSED
  [Stage 5.7] Cross-volume move (D: to C:) atomic fallback verified: PASSED
  [Stage 6.1] Verifiable undo restores exact pre-move SHA-256: PASSED
  [Stage 6.2] Idempotent undo verified: PASSED
  [Stage 6.3] Undo collision refused when target occupied: PASSED
  [Stage 6.4] Undo refused when destination tampered: PASSED
  [Stage 7.1] Journal JSONL syntax valid and excerpt-free: PASSED
  [Stage 7.2] Truncated trailing record recovery sanitized file: PASSED
  [Stage 7.3] Subsequent appends durable and valid: PASSED
  All 14/14 checks PASSED.
  ```

### Stage 8: Offline & Loopback Network Verification
- **Script:** `scripts/runStage8OfflineVerification.ts`
- **Execution Command:**
  ```powershell
  npx tsx scripts/runStage8OfflineVerification.ts
  ```
- **Observed Output:**
  ```text
  [Stage 8.1] OllamaClient default baseUrl verified: http://127.0.0.1:11434
  [Stage 8.2] Zero external AI services or cloud telemetry found in codebase.
  [Stage 8.3] Active network connection audit:
    LocalAddress: 127.0.0.1:9222 -> State: Established (CDP loopback)
    LocalAddress: 127.0.0.1:11434 -> State: Established (Ollama loopback)
    Zero non-loopback TCP connections observed for SlothSort.exe.
  [Stage 8.4] Local service unavailability reports clean local error.
  ```

### Stage 10: Complete End-to-End Packaged Journey
- **Script:** `scripts/runStage10EndToEndJourney.ts`
- **Execution Command:**
  ```powershell
  npx tsx scripts/runStage10EndToEndJourney.ts
  ```
- **Observed Output:**
  ```text
  [Stage 10] Complete End-to-End Journey verified across 8 sequential steps.
  All 8 journey checkpoints PASSED.
  ```

---

## 4. Cryptographic Hash Validation Records

### End-to-End Test File Hash Lifecycle:
- **Synthetic File:** `D:\SlothSort-Phase3B-Test\workspace\e2e_journey\meeting_notes.txt`
- **Initial SHA-256:** `d31590740efcb94ebcfdfa5ceae0a09e088ba767ef2cbbe85f40398f5b49d012`
- **Moved Destination:** `D:\SlothSort-Phase3B-Test\workspace\e2e_journey\Documents\Executive\Q4_Meeting_Summary.txt`
- **Destination SHA-256:** `d31590740efcb94ebcfdfa5ceae0a09e088ba767ef2cbbe85f40398f5b49d012` (Exact Match)
- **Restored Destination (Post-Undo):** `D:\SlothSort-Phase3B-Test\workspace\e2e_journey\meeting_notes.txt`
- **Restored SHA-256:** `d31590740efcb94ebcfdfa5ceae0a09e088ba767ef2cbbe85f40398f5b49d012` (Exact Match)

### Duplicate Detection Hash Pair:
- `duplicates/original_copy.txt`: `6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b`
- `duplicates/duplicate_copy.txt`: `6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b` (Identical Content Verified)

### Collision Target Hash Pair:
- `collision_source/conflict_target.txt`: `3f79bb7b435b05321651daefd374cd681b6101fa110d76449c022f14421abac8`
- `Documents/conflict_target.txt`: `8f434346648f6b96df89dda901c5176b10e6d0ceec3e4634000300a9ca73c7fb` (Distinct Content Verified, Overwrite Prevented)

---

## 5. Security & Isolation Statement

- All test artifacts and scripts are self-contained.
- Zero credentials, secrets, tokens, or personal identifiers were recorded.
- No network configurations, Windows hosts files, or firewall rules were modified.
