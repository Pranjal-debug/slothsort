# SlothSort — Current Engineering Audit

**Audit date:** October 24, 2026<br>
**Scope:** Current `master` workspace, source code, tests, build configuration, release artifacts, and repository state<br>
**Purpose:** Final preparation audit for the SlothSort v0.1.1 Windows patch release candidate.

## Executive verdict

SlothSort v0.1.1 is a prepared Windows x64 patch release candidate. The repository contains the Electron desktop application, the hardened file executor, local Ollama integration, README and MIT license, tracked lockfile, published v0.1.0 history, and deterministic regression suites. The final Windows validation passed 162 deterministic checks, five NTFS cross-volume hardening checks, a fresh package build, a synthetic packaged workflow, and extracted ZIP launch validation.

The documented filesystem and release-hygiene findings have been remediated and validated: destination symlink/junction escapes are rejected, missing source fingerprints are refused, remote font dependencies were removed, and the default `npm test` command includes the release audit and hardening suite. The remaining open reproducibility limitation is environmental: after the shared dependency directory was switched to Windows-native packages, the WSL2/Linux workspace cannot currently rerun its tests from that directory without restoring Linux-compatible dependencies. Windows validation is authoritative for this Windows candidate.

## What is already solid

### Security and data safety

- Model output is treated as untrusted input and validated against allowed categories, Windows filename rules, reserved device names, absolute paths, and traversal segments.
- The executor requires approval signatures bound to the source-relative path, category, destination, and filename. Editing a proposal clears the previous signature.
- Existing destination files are not overwritten.
- Source content is fingerprinted with SHA-256 before execution, and undo verifies the moved file before restoring it.
- The JSONL journal records intent and completion states and recovers valid history after a truncated trailing line.
- Scanner traversal checks lexical containment, canonical paths, symlink escapes, ignored system/dependency directories, and sensitive-file excerpt suppression.
- Electron uses context isolation, disables Node integration in the renderer, blocks popups, and prevents navigation away from local app content.

### Product flow

- The user-visible flow is complete: choose folder, scan, queue local inference, review/edit/approve, execute, inspect history, and undo.
- The queue is sequential, cancellable, retryable, and reports progress.
- Ollama failures and missing models are surfaced instead of silently falling back to a cloud service.

### Verification and release hygiene

- `npm test` now runs the validator, scanner, queue, executor, end-to-end audit, and hardening suites: 162 checks.
- `npm run test:audit` passes the end-to-end lifecycle and attack checks: 39 checks.
- `npm run test:hardening` passes 10 filesystem, integrity, review-state, privacy, race-condition, and packaging-input checks.
- `npm run build` succeeds for both the Vite renderer and TypeScript main process.
- Root `LICENSE`, `README.md`, `package-lock.json`, and v0.1.1 release notes are present. The existing v0.1.0 release was not modified.

## Findings that need fixing

### AUD-001 — Destination symlink/junction escape is not checked before a move (FIXED)

**Severity:** P0 security boundary<br>
**Location:** `src/main/executor.ts`, destination resolution in `executeApprovedBatch()`

The executor checks whether the source path escapes the selected root, but it does not call `isSymlinkEscaping()` for the resolved destination. A malicious or accidental directory junction such as `root/Organized -> D:/Outside` can pass lexical containment. `safeMoveFile()` then creates/follows that destination parent and can move a user-approved file outside the selected root.

**Implemented correction:** The executor now checks the resolved destination and its existing parents before collision checks, repeats the check immediately before the move, and applies the same boundary check to undo paths.

**Regression test:** Create a link/junction inside a temporary root that points outside it, approve a move into that folder, and assert that no outside file is created and the source remains untouched.

### AUD-002 — Execution can proceed without a scan-time source fingerprint (FIXED)

**Severity:** P1 integrity control<br>
**Location:** `src/main/executor.ts`, source fingerprint verification

`ScannedFile.metadata.sourceFingerprint` and `StagedItem.sourceFingerprint` are optional. If fingerprint generation failed during scanning, execution skips the comparison and still moves the file after approval. That contradicts the product's stated “cryptographic verification before move” guarantee and makes an approved item vulnerable to changes between scan and execution.

**Implemented correction:** Approved execution now refuses staged items without a SHA-256 fingerprint and tells the user to rescan.

**Regression test:** Stage an approved item without a fingerprint and assert a failed result, no destination file, and an unchanged source.

### AUD-003 — The offline claim is weakened by remote font resources (FIXED)

**Severity:** P1 privacy/release correctness<br>
**Location:** `src/renderer/index.html`, `src/main/main.ts`

The renderer loads Google Fonts from `fonts.googleapis.com` and `fonts.gstatic.com`, and the CSP explicitly permits those origins. That can produce external requests when the packaged app opens, which conflicts with the documented zero-outbound-network and offline behavior.

**Implemented correction:** Remote Google Font links and CSP exceptions were removed. The existing system-font fallbacks remain in place.

**Regression test:** Add a source-level check that production renderer HTML and CSP contain no external font origins.

### AUD-004 — `npm test` does not run the release audit (FIXED)

**Severity:** P1 verification gap<br>
**Location:** `package.json` scripts

The README presents 152 deterministic checks as the project's comprehensive suite, but `npm test` currently runs only validator, scanner, queue, and executor (113 checks). The 39-check lifecycle/security audit is available only through `npm run test:audit`. A contributor can therefore get a green default test command without running journal recovery, execution lifecycle, stale approval, collision, and attack-path checks.

**Implemented correction:** `npm test` now includes `test:audit` and the new hardening suite. The README documents the 162-check deterministic default suite; live Ollama verification remains separate.

### AUD-005 — Review updates are more permissive than the domain contract (FIXED)

**Severity:** P2 workflow hardening<br>
**Location:** `src/main/queue.ts`, `src/main/ipc.ts`

The main-process review path should only approve completed analysis items with a valid active proposal. The IPC edit path separately reconstructs a proposal and defaults an arbitrary confidence value to `high`; malformed confidence values can enter trusted queue state. The current renderer follows the intended flow, but the main process should enforce it independently because renderer input is untrusted.

**Implemented correction:** The queue now rejects premature approvals and invalid edits, while IPC edit payloads are normalized through `validateModelOutput()` with strict confidence validation.

## Missing tests and verification

The following coverage was added while closing the findings:

1. Destination symlink/junction escape during execution.
2. Approved execution with no source fingerprint.
3. Review approval attempted before analysis completion.
4. Invalid edited confidence and malformed edit payloads.
5. Static production check for remote network/font origins.
6. `npm test` includes the 39 audit checks by default through the package script.

Windows packaged execution and actual NTFS junction behavior were validated during Day 2. SmartScreen remains an unsigned-binary advisory and was not treated as a pass/fail security test.

## Recommended order of work

1. ~~Close AUD-001 and AUD-002 in the executor and add regression tests.~~ Completed.
2. ~~Close AUD-003 by removing production remote font dependencies and add a static privacy check.~~ Completed.
3. ~~Close AUD-004 by wiring the deterministic audit suite into `npm test` and correcting the README count.~~ Completed.
4. ~~Harden AUD-005 review validation and add queue/IPC boundary tests.~~ Completed.
5. ~~Re-run build and all deterministic tests; then rerun Windows packaged validation before tagging a new release.~~ Completed for this validation candidate.
6. Decide whether the untracked `artifacts/phase-4b/` files are intended release evidence before the next commit. They are preserved as user work and are not included in this change automatically.

## Post-release backlog

- Add Windows taskbar progress for long CPU inference batches.
- Produce a clean-machine Windows smoke test in CI or a documented manual runbook.
- Add code signing when a certificate is available.
- Consider a signed installer in addition to the portable ZIP.
- Add user-configurable categories and rules only after the safety contract remains deterministic and reviewable.

## Work completed during this audit

- Added `test/hardening.test.ts` with 10 regression checks for destination links, missing fingerprints, review-state validation, collision races, undo boundaries, error redaction, external font resources, and package inputs.
- Hardened `FileExecutor` against destination and undo symlink/junction escapes, missing fingerprints, replay of applied items, and collision races. Same-volume moves now use a no-overwrite hard link followed by source unlink; cross-volume moves also refuse replacement of a destination that appears during the operation.
- Centralized edited-proposal validation through the existing model-output validator and rejected approval before analysis is complete.
- Removed Google Fonts from the renderer and from the CSP's allowed origins.
- Added the audit and hardening suites to `npm test` and updated the README's deterministic test count.
- Updated Vite configuration to use `import.meta.dirname`, removing the current Vite config warning.
- Corrected the electron-builder file set so recursive `dist/**/*` packaging cannot re-embed `dist/package` or `dist/release` outputs inside `app.asar`.
- Added `test/windowsHardening.test.ts` for actual Windows/NTFS cross-volume success and failure cleanup cases.
- Added `scripts/runDay2WindowsPackagedValidation.ts` for synthetic packaged-app workflow, restart persistence, and renderer resource checks.

## Verification performed after the changes

| Check | Result |
|---|---|
| Windows `npm test` | PASS — 162 deterministic checks |
| Windows `npm run test:windows-hardening` | PASS — 5 NTFS cross-volume checks |
| Windows `npm run build` | PASS — renderer and main process compiled |
| Windows `npm run package` | PASS — fresh Windows x64 unpacked release candidate |
| Windows packaged validation script | PASS — 8 checks, Ollama, move, undo, restart, resource audit |
| Extracted ZIP release validation | PASS — extracted binary launched and exposed `window.slothsort` |
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `git diff --check` | PASS |

The WSL2/Linux workspace run of `npm test` is not currently repeatable after the Windows install because `node_modules` contains Windows-native esbuild packages; the Windows run is authoritative for this Windows release validation. Linux TypeScript checks and the earlier Linux test run passed before switching the shared dependency directory to Windows.

## Day 2 Windows validation results

**Environment:** Windows 11 build `10.0.26300.9711`, AMD64, Node.js `v26.10.0`, npm `11.19.1`, Ollama `0.40.6`, `gemma3:4b` installed, C: and D: both NTFS.

### Junction/reparse-point behavior

- A real NTFS directory junction was created with PowerShell under `D:\SlothSort-Day2-Junction-Behavior\root\outside-link` and pointed at a sibling `outside` directory.
- Windows reported `LinkType: Junction`, `Attributes: Directory, ReparsePoint`, and the linked external file was reachable through the junction.
- The SlothSort hardening suite passed the actual junction escape rejection tests for both execution and undo. No synthetic outside file was created or modified by the app.
- Evidence: `artifacts/day-2-audit/junction-behavior.json` and the `day2_*.png` screenshots.

### Same-volume and cross-volume move behavior

- Same-volume NTFS execution passed the existing collision-race hardening test: a destination created after preflight was preserved byte-for-byte and the source was not moved.
- D: to C: cross-volume execution passed on real NTFS volumes.
- Copy failure, verification failure, finalization failure, and source-removal failure all preserved the source and cleaned temporary/destination state. The five checks passed in `test/windowsHardening.test.ts`.
- Both C: and D: were confirmed as NTFS with free space available. Evidence: `windows-volumes.json`, `windows-hardening-output.txt`.

### Fingerprints, approvals, undo, and persistence

- The full Windows `npm test` run passed 162 checks, including missing fingerprint refusal, stale approval invalidation, premature approval rejection, invalid proposal rejection, collision handling, changed-content refusal, undo collision refusal, and truncated journal recovery.
- Packaged validation passed local Ollama status, synthetic scan, local inference, edit/approve, SHA-256-preserving move, history, undo, restart history persistence, and zero external renderer resources.

### Fresh v0.1.1 release candidate

- Executable: `dist/package/win-unpacked/SlothSort.exe`
- Executable size: `246,588,416` bytes
- Executable SHA-256: `eb2ddc7eae02ed42757a29f59c0e8280b6a4ee95b0f750eb0f42f15c91859c82`
- ZIP: `dist/release/SlothSort-v0.1.1-win-x64.zip`
- ZIP size: `158,411,658` bytes
- ZIP SHA-256: `9749092838b08d14641ecb483d893fd53224645a90cc54844b4959494b8b3f42`
- The ZIP was extracted to `D:\SlothSort-v0.1.1-Zip-Validation`; the extracted executable SHA-256 matched the packaged executable and launched successfully.
- The final `app.asar` was `381,108` bytes and contained no recursive `dist/package`, `dist/release`, or `win-unpacked` paths.

## Day 2 release recommendation

**Recommendation: GO for release preparation; NO-GO for automatic publication until explicit owner approval.**

The actual Windows/NTFS validation passed all requested functional and security checks for v0.1.1. The owner should review the release notes, select the publication commit/tag, and optionally add code signing. No commit, tag, push, GitHub release, or DEV publication was performed during this preparation.
