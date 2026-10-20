# SlothSort 🦥

> **"Slow and Steady"** — Privacy-first Windows desktop AI file organizer for Hacktoberfest 2026 Open-Source AI Challenge (Week 3).

SlothSort helps users organize cluttered folders by intelligently classifying files, suggesting meaningful filenames, and proposing destination categories.

All inference is performed strictly **locally** via Ollama on open-weight models. User files and contents are **never sent to external services or cloud APIs**. All file operations require explicit user review and approval.

---

## Phase 1 Feasibility & Benchmark Summary

- **Local Model:** `gemma3:4b` (quantized Q4_K_M, 3.4 GB)
- **Model Storage:** Configured on Drive `D:\ollama\models` to safeguard Drive C:
- **Runtime:** Ollama daemon v0.40.6 on `127.0.0.1:11434` (CPU inference with AVX2 via AMD Ryzen 5 5500U)
- **Structured Output Validity:** **100% (24/24)**
- **Classification Accuracy:** **100% (24/24)**
- **Generation Speed:** ~9.1 tokens/sec
- **Cold-Start Latency:** 19,971 ms
- **Warm Median Latency:** 21,750 ms (Range: 18,476 ms – 25,372 ms)
- **Offline Verification:** Confirmed 100% local loopback execution with zero external network socket activity.

---

## Architecture & Safety Guarantees

1. **Local-Only Inference:** Driven by local quantized LLMs running via local Ollama daemon on `127.0.0.1:11434`.
2. **Untrusted Model Output:** All model responses are treated as untrusted suggestions, validated through strict programmatic guardrails (`src/validator.ts`).
3. **Windows Safety Constraints:**
   - Illegal characters (`< > : " / \ | ? *`) and control characters are rejected.
   - Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) are prohibited.
   - Traversal attacks (`..`) and absolute drive root paths are strictly disallowed.
4. **Fixed Categories:**
   - `Documents`
   - `Images`
   - `Screenshots`
   - `Projects`
   - `Installers`
   - `Archives`
   - `Other`

---

## Project Structure

```
slothsort/
├── src/
│   ├── types.ts          # Core schemas, interfaces, and category definitions
│   ├── validator.ts      # Programmatic sanitizer and Windows validation rules
│   ├── testCases.ts      # 24 synthetic test cases & malformed test payloads
│   ├── testValidator.ts  # 29 unit tests verifying validator integrity
│   ├── ollamaClient.ts   # Local HTTP client communicating with Ollama
│   ├── evaluator.ts      # Full benchmarking harness (latency, accuracy, memory, speed)
│   ├── testOffline.ts    # Offline loopback verification suite
│   └── index.ts          # Minimal prototype CLI runner
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

---

## Setup & Running the Prototype

### Prerequisites
- Windows 10/11 64-bit
- Node.js 18+ (tested on Node.js v26.10.0)
- Ollama v0.40.6+ with `OLLAMA_MODELS=D:\ollama\models`
- Model `gemma3:4b` downloaded via `ollama pull gemma3:4b`

### Installation
```bash
git clone <repo-url>
cd slothsort
npm install
```

### Verified Commands

1. **Run Programmatic Validator Unit Tests (29 tests):**
   ```bash
   npm run test:validator
   ```

2. **Run Single-File Prototype Inference:**
   ```bash
   npm run prototype
   ```

3. **Run 24-Case Synthetic Evaluation Benchmark:**
   ```bash
   npm test
   ```

4. **Run Offline Verification Test:**
   ```bash
   npm run test:offline
   ```

---

## Next Steps for Phase 2 (Electron Desktop Application)

1. **Desktop Shell Integration:** Initialize Electron + React + TypeScript boilerplate using a secure IPC architecture (`contextBridge` and `preload.js`).
2. **Ollama Service Manager:** Implement background lifecycle management for Ollama (health monitoring, automatic startup, model download progress indicator).
3. **Staging & Review UI:** Build the review queue interface where users can preview proposed renames and destination moves before approving.
4. **Atomic & Reversible File Operations:** Implement a safe transaction engine that stages changes, writes an operation log, and supports instant 1-click Undo.
5. **Background Batch Worker:** Queue folder scans asynchronously with throttling to keep the UI fluid while local CPU inference proceeds in the background ("Slow and Steady").
