# SlothSort — DEV Open-Source AI Challenge Submission Checklist

**Challenge:** DEV Open-Source AI Challenge — Week 3 ("Slow and Steady")  
**Submission Target Date:** October 2026  
**Auditor:** Senior Release Engineer & Hackathon Reviewer  

This checklist guides the final preparation, staging, and publication of SlothSort for official entry into the challenge.

---

## 1. Repository & Open-Source Compliance Checklist

| Item | Requirement | Current State | Action Needed Before Submission |
|---|---|---|---|
| **[ ] 1.1** | **Open-Source License** | Missing root `LICENSE` | Create `LICENSE` file with standard MIT text matching `package.json`. |
| **[ ] 1.2** | **Full Application Committed to Git** | `src/main`, `src/renderer`, `test`, `scripts`, `artifacts` untracked | Create clean Git release commit staging all application directories. |
| **[ ] 1.3** | **Lockfile Versioning** | `package-lock.json` is gitignored | Remove `package-lock.json` from `.gitignore` and commit it. |
| **[ ] 1.4** | **README Comprehensive & Modern** | README reflects Phase 1 CLI prototype | Replace `README.md` with [`day-1-readme-proposal.md`](./day-1-readme-proposal.md). |
| **[ ] 1.5** | **Zero Secrets or Credentials Tracked** | Verified clean via `git ls-files` | None. Keep verifying that `.env` or personal paths are never committed. |
| **[ ] 1.6** | **GitHub Repository Public** | Local repository on `master` branch | Push clean `master` branch to a public GitHub repository. |

---

## 2. Release Artifacts & Distribution Checklist

| Item | Requirement | Current State | Action Needed Before Submission |
|---|---|---|---|
| **[ ] 2.1** | **Packaged Executable Integrity** | `dist/package/win-unpacked/SlothSort.exe` (246.58 MB) verified | Verified functional. Do NOT rebuild. |
| **[ ] 2.2** | **Zipped Release Archive** | Unpacked directory only | Compress `dist/package/win-unpacked` into `SlothSort-v0.1.0-win-x64.zip`. |
| **[ ] 2.3** | **GitHub Release Created** | No GitHub remote configured yet | Create a GitHub Release tag `v0.1.0` and attach `SlothSort-v0.1.0-win-x64.zip`. |
| **[ ] 2.4** | **SmartScreen Note Documented** | Documented in proposed README and reports | Ensure users are guided to click "More info" -> "Run anyway". |

---

## 3. Screenshots & Visual Assets Checklist

All 10 live UI screenshots are verified and located in `artifacts/phase-3b/screenshots/`:

| Item | Screenshot Asset | Caption / Submission Purpose | Verified? |
|---|---|---|---|
| **[x] 3.1** | `stage10_01_launch.png` | Clean application startup screen with "Select Folder" entry point. | **YES (109 KB)** |
| **[x] 3.2** | `stage10_02_scanned.png` | Discovered folder metadata card displaying detected files and sizes. | **YES (128 KB)** |
| **[x] 3.3** | `stage10_03_inference_review.png` | Staging review queue showing incoming local AI proposal in `pending_review`. | **YES (153 KB)** |
| **[x] 3.4** | `stage10_04_approved.png` | User-edited destination and filename with cryptographic approval signature. | **YES (150 KB)** |
| **[x] 3.5** | `stage10_05_executed.png` | Batch execution completed with destination confirmed and source unlinked. | **YES (148 KB)** |
| **[x] 3.6** | `stage10_06_history.png` | Persistent history tab displaying completed operations with timestamps. | **YES (147 KB)** |
| **[x] 3.7** | `stage10_07_undone.png` | Verifiable 1-click undo showing status updated to `undone` and file restored. | **YES (147 KB)** |
| **[x] 3.8** | `stage10_08_relaunch_history.png` | App restarted; history cleanly restored from persistent JSONL journal. | **YES (109 KB)** |

---

## 4. DEV Community Submission Post Checklist

The DEV article must be published on [dev.to](https://dev.to) during the challenge submission window:

| Item | Section / Requirement | Content Outline |
|---|---|---|
| **[ ] 4.1** | **Title & Tagging** | Title: *SlothSort: The Privacy-First, Slow-and-Steady AI File Organizer That Runs 100% on Your Laptop*<br>Tags: `#devchallenge`, `#opensourceai`, `#localai`, `#electron` |
| **[ ] 4.2** | **Cover Image** | High-resolution logo or screenshot collage featuring SlothSort's dark-mode UI. |
| **[ ] 4.3** | **The Hook** | Why sending file metadata to the cloud is a privacy violation, and why organizing files with local AI matters. |
| **[ ] 4.4** | **Why "Slow and Steady"** | Highlight the Hacktoberfest Week 3 theme: pacing CPU inference (~20s/file), sequential queueing, untrusted model outputs, strict human approval, and 1-click undo. |
| **[ ] 4.5** | **Architecture Deep-Dive** | Explain the Electron IPC boundary (`contextIsolation`), Windows path security, cryptographic SHA-256 fingerprints, and append-only JSONL journal recovery. |
| **[ ] 4.6** | **Embedded Visuals** | Embed screenshots (`stage10_03_inference_review.png`, `stage10_06_history.png`, `stage10_07_undone.png`). |
| **[ ] 4.7** | **Repository & Release Links** | Direct link to public GitHub repository and `v0.1.0` release ZIP. |

---

## 5. Verification Commands Pre-Submission Sanity Check

Run these commands before final submission to guarantee repository health:

```powershell
# 1. Run all 152 automated tests
npm test && npm run test:audit

# 2. Check Git status (must be clean working tree after staging)
git status

# 3. Check that no sensitive files or node_modules are tracked
git ls-files | Select-String -Pattern "\.env|node_modules|temp_|id_rsa"
```

---

## 6. External Challenge Requirements (Requires User Confirmation)

The following items depend on the official DEV challenge rules and require final confirmation:
- **[ ] Exact Submission Form:** Confirm whether entry is submitted purely via the DEV article with specific tags, or if a separate Google Form / GitHub issue is required.
- **[ ] Submission Deadline:** Confirm exact closing time and timezone (e.g., Sunday 11:59 PM UTC).
- **[ ] Video Requirement:** Confirm whether an optional short demo video (e.g., Loom or YouTube) improves judging scores.
