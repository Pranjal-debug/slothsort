# SlothSort 🦥

> **"Slow and Steady"** — Privacy-first Windows desktop AI file organizer for Hacktoberfest 2026 Open-Source AI Challenge (Week 3).

SlothSort helps users organize cluttered folders by intelligently classifying files, suggesting meaningful filenames, and proposing destination categories.

All inference is performed strictly **locally** via Ollama on open-weight models. User files and contents are **never sent to external services or cloud APIs**. All file operations require explicit user review and approval.

---

## Architecture & Safety Guarantees

1. **Local-Only Inference:** Driven by local quantized LLMs (e.g. `gemma3:4b` or `gemma2:2b`) running via local Ollama daemon on `127.0.0.1:11434`.
2. **Untrusted Model Output:** All model responses are treated as untrusted suggestions, validated through strict programmatic guardrails (`src/validator.ts`).
3. **Windows Safety Constraints:**
   - Illegal characters (`< > : " / \ | ? *`) and control characters are rejected.
   - Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, etc.) are prohibited.
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
│   ├── validator.ts      # Programmatic sanitizer and validation rules
│   ├── testCases.ts      # 24 synthetic test cases & malformed test payloads
│   ├── testValidator.ts  # 29 unit tests verifying validator integrity
│   ├── ollamaClient.ts   # Local HTTP client communicating with Ollama
│   ├── evaluator.ts      # Full benchmarking harness (latency, accuracy, memory)
│   └── index.ts          # Minimal prototype CLI runner
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

---

## Setup & Running the Prototype

### Prerequisites
- Node.js 18+ (tested on Node.js v26.10.0)
- Git (tested on Git 2.50.1)
- [Ollama](https://ollama.com/) running locally

### Installation
```bash
git clone <repo-url>
cd slothsort
npm install
```

### Run Validator Unit Tests
```bash
npm run test:validator
```

### Run Prototype Inference
```bash
npm run prototype
```

### Run Full Synthetic Evaluation Suite (24 Test Cases)
```bash
npm test
```
To specify a different local model:
```bash
npx tsx src/evaluator.ts gemma2:2b
```
