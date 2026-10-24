# SlothSort v0.1.1 — Windows Patch Release Candidate

SlothSort v0.1.1 is a security and release-hygiene patch release candidate for Windows x64.

## Highlights

- Blocks execution and undo through NTFS junctions, symlinks, and other reparse-point paths that resolve outside the selected root.
- Requires a scan-time SHA-256 source fingerprint before an approved file can be moved.
- Rejects approval before analysis completes and validates edited proposals, including confidence values, in the main process.
- Prevents destination replacement when a competing file appears between preflight and execution.
- Hardens cross-volume copy, verification, finalization, and source-removal failure cleanup so the source is preserved and temporary destinations are removed or rolled back.
- Removes the Google Fonts dependency and keeps packaged renderer requests local-only during the validated workflow.
- `npm test` covers 162 deterministic checks, including the 10-test `test:hardening` suite. The separate `npm run test:windows-hardening` command covers 5 Windows/NTFS cross-volume hardening checks.
- Corrects the Electron Builder allowlist so previous `dist/package` and `dist/release` outputs are not recursively embedded in `app.asar`.

## Validation evidence

- Windows 11 build `10.0.26300.9711`, AMD64.
- Node.js `v26.10.0`, npm `11.19.1`.
- Ollama `0.40.6` with `gemma3:4b` installed locally.
- C: and D: confirmed as NTFS volumes.
- Windows `npm test`: 162 deterministic checks passed.
- Windows `npm run test:windows-hardening`: 5/5 checks passed.
- Fresh packaged workflow passed: launch, local model detection, synthetic scan, inference, edit, approval, move, history, undo, restart, and renderer resource audit.
- Extracted ZIP executable launched successfully.

## Candidate artifact

- Filename: `SlothSort-v0.1.1-win-x64.zip`
- Executable: `SlothSort.exe`
- Executable size: `246,588,416` bytes
- Executable SHA-256: `eb2ddc7eae02ed42757a29f59c0e8280b6a4ee95b0f750eb0f42f15c91859c82`
- ZIP size: `158,411,658` bytes
- ZIP SHA-256: `9749092838b08d14641ecb483d893fd53224645a90cc54844b4959494b8b3f42`

## Known limitations

- The Windows executable is unsigned and may trigger the SmartScreen “Unrecognized app” warning. Select **More info** → **Run anyway** if you trust the downloaded artifact.
- The model is not bundled. An initial internet connection is required to install Ollama and run `ollama pull gemma3:4b`; inference itself uses local loopback only.
- The packaged workflow was validated on the development Windows 11 machine. A clean third-party Windows machine without developer tools was not available for this run.
- CPU inference remains slow on consumer hardware, approximately 20 seconds per file on the measured Ryzen 5 5500U system.
- The shared WSL2/Linux workspace is not currently repeatable after Windows-native dependencies were installed; earlier Linux/WSL checks passed before that switch, and the Windows run is authoritative for this Windows candidate.

## Release status

This is a release candidate only. No Git commit, tag, push, GitHub release, or DEV article publication was performed as part of this preparation.
