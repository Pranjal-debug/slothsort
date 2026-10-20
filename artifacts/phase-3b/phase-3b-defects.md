# SlothSort Phase 3B — Defect & Security Findings Log

**Date:** October 20, 2026  
**Target:** `dist/package/win-unpacked/SlothSort.exe`  
**Classification Standard:**
- **P0:** Critical — Data loss, silent overwrites, unauthorized destructive action, path escape.
- **P1:** High — Approval bypass, broken undo protection, corrupt state recovery, cloud leakage.
- **P2:** Medium — Workflow failure, process crash, missing security handlers, unhandled offline state.
- **P3:** Low / Advisory — UI cosmetic issues, platform-specific permission notices, signing advisories.

---

## 1. Summary of Defects and Findings

| ID | Severity | Component | Summary | Status | Resolution / Follow-up |
|---|---|---|---|---|---|
| **DEF-001** | **P1** | `UndoJournal` | Journal corruption on truncated trailing JSONL records | **RESOLVED** | Sanitizing recovery parser + newline-padded append |
| **DEF-002** | **P1** | `FileExecutor` | Unsafe assumption that `EPERM === EXDEV` | **RESOLVED** | Volume root inspection (`isCrossVolumeMove`) |
| **DEF-003** | **P2** | Electron Main | Missing `setWindowOpenHandler` and `will-navigate` filters | **RESOLVED** | Popup creation denied; non-app navigation blocked |
| **DEF-004** | **P2** | Scanner | Accidental browser profile and session data exposure | **RESOLVED** | Added browser directories and sensitive session regexes |
| **DEF-005** | **P3** | Platform / FS | Windows NTFS symlink creation requires elevated privileges | **DOCUMENTED** | Fallback to directory junctions and unit tests |
| **DEF-006** | **P3** | Packaging | Unsigned executable triggers Windows SmartScreen warning | **ADVISORY** | Authenticode code signing recommended for distribution |
| **DEF-007** | **P3** | UX / Queue | CPU-bound inference queue lacks Windows taskbar progress | **ENHANCEMENT** | Recommend `mainWindow.setProgressBar()` integration |

---

## 2. Detailed Defect Analysis

### DEF-001: Journal Corruption on Truncated Trailing JSONL Records
- **Severity:** **P1**
- **Affected Component:** `src/main/journal.ts` (`UndoJournal`)
- **Vulnerability / Bug:** When the application process was killed mid-write, a partial JSON string was left at the end of `operations.jsonl` without a trailing newline (`\n`). Subsequent calls to `fs.appendFile` appended new valid records directly to the end of the malformed line, corrupting both the aborted record and all subsequent operation records.
- **Reproduction Steps:**
  1. Initialize `UndoJournal` and record 2 valid operations.
  2. Artificially append an unclosed record string: `{"id":"op_corrupt","type":"move"`.
  3. Reopen `UndoJournal` and append a 3rd valid operation.
  4. Attempt to retrieve operations via `getAllOperations()`.
- **Observed Behavior (Pre-Fix):** Parser failed with `SyntaxError: Unexpected end of JSON input`; subsequent valid operations were unrecoverable.
- **Remediation Implemented:**
  1. Updated `loadRecords()` to parse lines individually. If the final line is malformed/truncated, it is ignored and the file is rewritten cleanly to discard the corrupted tail while preserving all previous valid operations.
  2. Updated `appendLine()` to inspect the last byte of the existing file; if it does not end with `0x0A` (`\n`), a newline character is automatically prepended.
- **Verification Evidence:** Stage 7 test `Truncated trailing record recovery sanitized file` passed 100%.

---

### DEF-002: Unsafe Cross-Volume Fallback on Same-Volume File Locks
- **Severity:** **P1**
- **Affected Component:** `src/main/executor.ts` (`FileExecutor`)
- **Vulnerability / Bug:** When moving a file on the same NTFS volume that was held open by another process, Windows returns `EPERM` or `EBUSY`. The executor's catch block checked `code !== 'EXDEV' && code !== 'EPERM'`, erroneously treating any permission or lock error as a cross-volume move and invoking `crossVolumeMove()` (copy + unlink).
- **Reproduction Steps:**
  1. Open an exclusive handle to `fixture.txt` using `fs.openSync(path, 'r+')`.
  2. Attempt to move `fixture.txt` to a subfolder on the same drive (`D:`).
- **Observed Behavior (Pre-Fix):** The executor attempted to copy the file to a `.slothsort_tmp_*` file and delete the source, potentially leaving duplicate partial files or throwing confusing secondary errors.
- **Remediation Implemented:**
  1. Implemented `isCrossVolumeMove(source, dest)` which compares root volume letters (`path.parse(source).root.toUpperCase() !== path.parse(dest).root.toUpperCase()`).
  2. Same-volume file locks now immediately and cleanly fail with access/busy errors without triggering cross-volume copy routines.
  3. Added an atomic cleanup rollback to `crossVolumeMove()` so if unlinking the source fails on a genuine cross-volume move, the copied temporary destination is unlinked to avoid duplicate orphaned files.
- **Verification Evidence:** Stage 5 test `File lock handling preserves original file and handles access safely` passed.

---

### DEF-003: Unrestricted Renderer Window Open and Navigation Escapes
- **Severity:** **P2**
- **Affected Component:** `src/main/main.ts`
- **Vulnerability / Bug:** `BrowserWindow.webContents` lacked explicit handlers for `setWindowOpenHandler` and `will-navigate`. Malicious links in file explanations or renderer XSS could spawn arbitrary external browser windows or navigate the primary Electron frame to untrusted remote URLs.
- **Reproduction Steps:**
  1. In renderer DOM, invoke `window.open('https://example.com')` or click `<a href="https://example.com" target="_blank">`.
- **Observed Behavior (Pre-Fix):** Electron opened a default secondary child window without isolation guards.
- **Remediation Implemented:**
  ```typescript
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
      event.preventDefault();
    }
  });
  ```
- **Verification Evidence:** Packaged app audit confirmed popups are blocked and non-local navigations are prevented.

---

### DEF-004: Accidental Exposure of Browser Session and User Profile Data
- **Severity:** **P2**
- **Affected Component:** `src/main/scanner.ts`
- **Vulnerability / Bug:** The scanner's sensitive file regex only checked for developer secrets (`.env`, `id_rsa`, `.pem`, `.key`). If a user accidentally selected their user profile directory or browser directories, browser session tokens (`Cookies`, `Login Data`, `places.sqlite`) were treated as ordinary files and scanned.
- **Reproduction Steps:**
  1. Include directory `chrome/Default/Network/Cookies` in target scan directory.
  2. Run `scanFolder()`.
- **Observed Behavior (Pre-Fix):** Browser files were indexed and potentially submitted for excerpt extraction.
- **Remediation Implemented:**
  1. Added browser directories to `IGNORED_DIRECTORY_NAMES`: `chrome`, `firefox`, `mozilla`, `edge`, `bravesoftware`, `opera`, `chromium`, `user data`.
  2. Added session filenames to `isSensitiveFile()`: `cookies`, `login data`, `favicons`, `places.sqlite`, `web data`.
  3. Ensured that even if individual files are encountered, `isSensitiveExcluded` is set to `true` and `textExcerpt` is strictly `undefined`.
- **Verification Evidence:** Stage 3 scanner verification confirmed all 6 sensitive synthetic test files had excerpts suppressed and browser directories were completely skipped.

---

### DEF-005: Windows Symlink Creation Requires Elevated Privileges
- **Severity:** **P3 (Platform Limitation)**
- **Affected Component:** Windows NTFS / Filesystem
- **Observation:** On standard Windows 11 consumer installations without Developer Mode enabled, creating directory symbolic links requires elevated administrator privileges (`SeCreateSymbolicLinkPrivilege`). Calling `fs.symlinkSync(..., 'dir')` throws `EPERM`.
- **Handling in SlothSort:**
  1. The scanner implementation supports directory junctions (`fs.symlinkSync(..., 'junction')`) which do not require elevated privileges on Windows NTFS.
  2. Both directory junctions and symlinks pointing outside the permitted root folder are strictly verified by `isPathContained()` and excluded from traversal.
- **Recommendation:** No application code change required. Document in user guide that directory junctions are used on Windows.

---

### DEF-006: Unsigned Windows Binary SmartScreen Advisory
- **Severity:** **P3 (Packaging Advisory)**
- **Affected Component:** Packaging / Release Pipeline
- **Observation:** `SlothSort.exe` in `dist/package/win-unpacked/` is not signed with a digital Authenticode certificate. When launched by an end-user on a fresh Windows 11 machine, Windows Defender SmartScreen displays: *"Windows protected your PC: Microsoft Defender SmartScreen prevented an unrecognized app from starting."*
- **Recommendation:**
  - For open-source evaluation (Hacktoberfest), users click *More info* -> *Run anyway*.
  - For production release, integrate an EV or standard code-signing certificate into the `electron-builder` workflow via GitHub Actions or SignTool.

---

### DEF-007: CPU-Bound Inference Queue Lacks Windows Taskbar Progress Indicator
- **Severity:** **P3 (Usability Enhancement)**
- **Affected Component:** Electron Main / Queue UI
- **Observation:** On CPU-only systems like the Ryzen 5 5500U, analyzing 20–50 files can take 10–15 minutes. While the in-app UI displays clear per-item progress, minimizing the window leaves the user unaware of progress without switching back to the app.
- **Recommendation:**
  - In `src/main/main.ts`, listen to `queue:progress` events from `InferenceQueue` and call `mainWindow.setProgressBar(completedCount / totalCount)`.
  - When all jobs complete or require review, call `mainWindow.flashFrame(true)` to alert the user.
