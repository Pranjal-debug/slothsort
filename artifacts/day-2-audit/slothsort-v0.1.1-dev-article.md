---
title: "SlothSort v0.1.1: A Privacy-First Desktop AI File Organizer That Keeps Humans in Control"
published: false
description: "SlothSort v0.1.1 is a local-first Windows desktop file organizer powered by Ollama and gemma3:4b, with review-gated file operations and verifiable undo."
tags: devchallenge, hf26challenge, opensourceai, productivity
cover_image: https://raw.githubusercontent.com/Pranjal-debug/slothsort/master/artifacts/phase-3b/screenshots/stage10_03_inference_review.png
canonical_url: https://github.com/Pranjal-debug/slothsort
---

*This is a submission for the Hacktoberfest Open-Source AI Challenge Week 3: Slow and Steady.*

---

## What I Built

### The Problem: Cluttered Folders and Cloud Privacy Risks

Downloads, Desktop folders, and project directories become difficult to search when filenames and file types accumulate without a consistent structure. Many AI organizers also require sending private documents, images, or source code to a remote service, while giving users limited visibility into the resulting file operations.

SlothSort addresses the problem with a slower, reviewable workflow:

1. Scan a selected folder without modifying files.
2. Send bounded file context to a separately installed local Ollama runtime.
3. Review, edit, approve, or reject each untrusted suggestion.
4. Execute only approved operations with collision and fingerprint checks.
5. Inspect the journal and undo completed operations after integrity verification.

### The Solution: SlothSort v0.1.1

**SlothSort v0.1.1** is a Windows x64 desktop application built around the Week 3 theme **"Slow and Steady."** It uses the open-weight `gemma3:4b` model through a separately installed Ollama runtime.

Inference uses local loopback HTTP at `127.0.0.1:11434`; it is not a cloud API integration. In the validated packaged workflow, the renderer resource audit recorded an empty `resourceUrls` list, with no Google Fonts or other external resources requested. This documents the tested application workflow; it is not a claim that the entire computer or operating system is network-isolated.

Most importantly, **the human remains in control**:

- The model produces untrusted suggestions only.
- Nothing is moved or renamed until the user reviews and approves it.
- Proposal edits invalidate earlier approval signatures.
- SHA-256 fingerprints are recorded for execution and verifiable undo.
- Existing destination files are never overwritten.

![SlothSort Desktop Overview](https://raw.githubusercontent.com/Pranjal-debug/slothsort/master/artifacts/phase-3b/screenshots/stage10_01_launch.png)
*Figure 1: SlothSort startup showing the local Ollama connection and model status.*

---

## Core Features at a Glance

- **Local inference:** `gemma3:4b` runs through separately installed Ollama on loopback (`127.0.0.1:11434`). The model is not bundled in the Windows ZIP.
- **Sensitive-data suppression:** Secrets such as `.env`, `id_rsa`, `.key`, `.pem`, and `credentials.json`, along with browser profile data, are excluded from text excerpts. System and dependency directories are skipped.
- **Untrusted model guardrails:** Suggestions are checked against Windows filename rules, reserved device names, traversal segments, absolute paths, allowed categories, and valid confidence values.
- **Human approval gate:** Users can approve, reject, or edit proposals. Editing requires fresh approval.
- **Collision protection:** Existing destination files are preserved rather than replaced.
- **Verifiable undo:** The JSONL journal records operation state and fingerprints so completed moves can be checked before restoration.
- **Crash-resilient journaling:** Valid history survives a corrupt or truncated trailing record.

---

## Demo

### 1. Safe Scanning & Discovery

SlothSort performs a non-destructive scan. Standard documents receive bounded text excerpts, while binary and media files are inspected using metadata and filename signals.

![Non-Destructive Folder Scan](https://raw.githubusercontent.com/Pranjal-debug/slothsort/master/artifacts/phase-3b/screenshots/stage10_02_scanned.png)
*Figure 2: Discovered files are staged without modifying anything on disk.*

### 2. Local AI Suggestions in the Review Queue

The sequential queue sends one file at a time to local `gemma3:4b`. The model proposes a category, destination, filename, and explanation for review.

![Local AI Proposal in Review Queue](https://raw.githubusercontent.com/Pranjal-debug/slothsort/master/artifacts/phase-3b/screenshots/stage10_03_inference_review.png)
*Figure 3: A local model proposal remains pending until the user takes a review action.*

### 3. Human Review & Proposal Editing

Users can accept a suggestion, reject it, or edit the destination and filename. An edit clears the previous approval signature and requires a fresh approval.

![Human Approval Gate & Proposal Editing](https://raw.githubusercontent.com/Pranjal-debug/slothsort/master/artifacts/phase-3b/screenshots/stage10_04_approved.png)
*Figure 4: An edited proposal is explicitly approved before execution.*

### 4. Safe Batch Execution

The main process revalidates paths, checks for destination collisions, verifies the source fingerprint, performs the move, and confirms the destination fingerprint before recording completion.

![Approved File Operation Executed](https://raw.githubusercontent.com/Pranjal-debug/slothsort/master/artifacts/phase-3b/screenshots/stage10_05_executed.png)
*Figure 5: The approved operation completed with the destination verified and the source removed.*

### 5. Instant 1-Click Undo

The History tab verifies the moved destination before restoring the file to its original location. Undo refuses to overwrite a new file that occupies the original path.

![1-Click Verifiable Undo](https://raw.githubusercontent.com/Pranjal-debug/slothsort/master/artifacts/phase-3b/screenshots/stage10_07_undone.png)
*Figure 6: The original file was restored after destination-integrity verification.*

---

## Code and Release

SlothSort is open source under the MIT License:

- **GitHub Repository:** [https://github.com/Pranjal-debug/slothsort](https://github.com/Pranjal-debug/slothsort)
- **Windows Release v0.1.1:** **TODO — replace with the live GitHub v0.1.1 release URL after the release is published.**
- **Standalone Download:** **TODO — replace with the live download URL for `SlothSort-v0.1.1-win-x64.zip` after the release asset is uploaded.**

The validated local candidate ZIP is `SlothSort-v0.1.1-win-x64.zip` with size `158,411,658` bytes and SHA-256:

```text
9749092838b08d14641ecb483d893fd53224645a90cc54844b4959494b8b3f42
```

The two TODO placeholders above must be replaced with the actual v0.1.1 release and asset links after publication. No v0.1.1 GitHub URL exists yet.

---

## How I Built It

SlothSort uses a React renderer, an Electron main process, a context-isolated preload bridge, deterministic validators, a sequential inference queue, and an append-only journal.

```text
┌────────────────────────────────────────────────────────┐
│                   React 19 Frontend                    │
│    (State Machine, Review Queue, History, Dark CSS)    │
└──────────────────────────┬─────────────────────────────┘
                           │ contextBridge (IPC)
┌──────────────────────────▼─────────────────────────────┐
│                 Electron Main Process                  │
│  ┌─────────────────┐  ┌───────────────┐  ┌──────────┐  │
│  │ Path Security   │  │ File Executor │  │ Journal  │  │
│  │ (Sanitization)  │  │ (Verified I/O)│  │ (Undo)   │  │
│  └─────────────────┘  └───────────────┘  └──────────┘  │
└──────────────────────────┬─────────────────────────────┘
                           │ Loopback HTTP (127.0.0.1:11434)
┌──────────────────────────▼─────────────────────────────┐
│             Ollama Daemon (gemma3:4b)                  │
│                 (Local CPU Inference)                  │
└────────────────────────────────────────────────────────┘
```

### Technology Stack

- **Desktop Framework:** Electron `44.9.1`
- **Frontend:** React 19, TypeScript, and Vite 8
- **Validation environment:** Windows 11, Node.js `v26.10.0`, npm `11.19.1`
- **Local AI Engine:** Ollama `0.40.6` with `gemma3:4b`

### Filesystem Safety Decisions

#### Same-volume moves

For a same-volume move, SlothSort creates a destination hard link with `fs.promises.link()`. A hard link refuses to replace an existing destination. SlothSort then verifies the destination SHA-256 fingerprint before unlinking the source. If source removal fails, it removes the newly created destination link.

This is intentionally described as **no-overwrite hard-link creation followed by source unlink**, rather than as a rename-based move.

#### Cross-volume moves

For a cross-volume move, SlothSort creates a destination-based temporary path in this form:

```text
<destinationPath>.tmp.<timestamp>.<random>
```

It copies the source to that temporary path, verifies the SHA-256 fingerprint, links the temporary file into the final destination without replacing a competing file, removes the temporary link, verifies the final destination, and only then unlinks the source. Copy, verification, finalization, or source-removal failures clean up or roll back the destination state.

#### Electron security boundary

- `contextIsolation: true` and `nodeIntegration: false` separate renderer content from Node.js APIs.
- The main process validates paths and proposal data independently of renderer input.
- Popups are denied and navigation away from bundled local content is blocked.
- The tested packaged renderer requested no external resources.

---

## Measured Performance & Testing Rigor

### Inference latency

The existing Phase 3B measurements were taken on this development machine:

- AMD Ryzen 5 5500U, 6 cores / 12 threads
- 16 GB DDR4 RAM
- Windows 11
- Ollama `0.40.6` with `gemma3:4b` running locally on CPU

Four recorded inference samples measured between **19,658 ms and 20,734 ms per file**, or approximately **20 seconds per file** on that machine. This is an observed CPU measurement, not a performance guarantee for other hardware, models, or file contents.

### Memory observations

The Phase 3B report recorded approximately **142 MB RAM for the idle Electron app** and approximately **215 MB for the app plus 3.8 GB for Ollama during inference**. These are measurements from the tested development machine and should be treated as approximate observations, not fixed system requirements.

### Automated test coverage

The `package.json` `npm test` script runs these six deterministic suites:

| Suite | Checks |
|---|---:|
| `test:validator` | 29 |
| `test:scanner` | 22 |
| `test:queue` | 22 |
| `test:executor` | 40 |
| `test:audit` | 39 |
| `test:hardening` | 10 |
| **Total run by `npm test`** | **162** |

The separate `npm run test:windows-hardening` command adds **5 Windows/NTFS cross-volume checks**. Those five checks are **not included** in the 162-check `npm test` total, so they are reported separately rather than double-counted.

The validated Windows evidence recorded:

- `npm test`: **162/162 passed**
- `npm run test:windows-hardening`: **5/5 passed**
- Production build: passed
- TypeScript check: passed
- Windows package build: passed
- Packaged workflow: **8/8 checks passed**, including local Ollama detection, scan, inference, edit/approval, move, history, undo, restart persistence, and renderer resource auditing
- Extracted ZIP executable launch: passed

---

## Why Open Innovation Matters

The Week 3 theme **"Slow and Steady"** is a good fit for file management. SlothSort favors local processing, explicit approval, deterministic validation, and reversible operations over fast, opaque automation.

Open-weight models and open-source software make it possible to inspect the safety boundary, run inference on a user's own machine, and keep the decision to move a file with the user.

---

## Known Limitations & Requirements

- **Separate Ollama installation:** Ollama is not bundled. Users must install Ollama separately and install `gemma3:4b`, for example with `ollama pull gemma3:4b`.
- **Initial model download:** An internet connection is required to install Ollama and download the model. Inference in the tested workflow uses local loopback HTTP.
- **Unsigned Windows executable:** The executable is not Authenticode-signed. Windows Defender SmartScreen may show an “Unknown Publisher” or “Unrecognized app” warning on first run; users must select **More info** → **Run anyway** only if they trust the artifact.
- **CPU latency:** The measured Ryzen 5 5500U result was approximately 20 seconds per file. Smaller batches of 10–30 files are more practical than very large folders on CPU-only systems.
- **Tested machine scope:** Validation was performed on the development Windows 11 machine. A clean third-party Windows machine without developer tools was not available for this run.
- **Linux/WSL reproducibility:** Windows validation was performed on the target Windows environment. Earlier Linux/WSL checks passed before the shared dependency directory was switched to Windows-native dependencies. The current shared `node_modules` directory contains Windows-native packages, so Linux/WSL tests are not currently repeatable from that directory without restoring or installing Linux-compatible dependencies. This is a dependency-environment limitation, not an application-defect result.

### Roadmap for v0.2.0

- Windows taskbar progress integration.
- Optional GPU acceleration for discrete NVIDIA or AMD graphics.
- Custom user-defined category presets and rule overrides.

---

## Try It Out

- **Download Release v0.1.1:** **TODO — replace with the live GitHub v0.1.1 release URL after publication.**
- **Standalone ZIP:** **TODO — replace with the live asset URL for `SlothSort-v0.1.1-win-x64.zip` after upload.**
- **Explore the Source Code:** [GitHub Repository](https://github.com/Pranjal-debug/slothsort)

The two release-link TODOs must be replaced after the v0.1.1 GitHub release and asset are publicly available. Until then, this draft intentionally contains no invented release URL.

If you find SlothSort helpful or have ideas for improvements, please star the repo, open an issue, or leave a comment below. Happy Hacktoberfest! 🦥
