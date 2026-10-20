import { ALLOWED_CATEGORIES, FileMetadata, InferenceMetrics } from './types.js';

export interface OllamaClientConfig {
  baseUrl?: string;
  model: string;
  temperature?: number;
}

export interface RawInferenceResult {
  rawText: string;
  metrics: InferenceMetrics;
}

export class OllamaClient {
  private baseUrl: string;
  private model: string;
  private temperature: number;

  constructor(config: OllamaClientConfig) {
    this.baseUrl = config.baseUrl || 'http://127.0.0.1:11434';
    this.model = config.model;
    this.temperature = config.temperature ?? 0.1;
  }

  /**
   * Checks whether the Ollama server is reachable and responsive.
   */
  async checkHealth(): Promise<{ isHealthy: boolean; version?: string; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`, {
        signal: AbortSignal.timeout(3000)
      });
      if (!response.ok) {
        return { isHealthy: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }
      const data = await response.json() as { version?: string };
      return { isHealthy: true, version: data.version };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { isHealthy: false, error: msg };
    }
  }

  /**
   * Lists models currently loaded or available in the local Ollama instance.
   */
  async listLocalModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(4000)
      });
      if (!response.ok) return [];
      const data = await response.json() as { models?: Array<{ name: string }> };
      return (data.models || []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  /**
   * Builds the strict system & user prompt for classification.
   */
  private buildPrompt(metadata: FileMetadata): string {
    const contextItems: string[] = [
      `Filename: "${metadata.filename}"`,
      `Extension: "${metadata.extension || 'None'}"`,
      `Size: ${metadata.sizeBytes} bytes`
    ];

    if (metadata.mimeType) {
      contextItems.push(`MIME Type: "${metadata.mimeType}"`);
    }
    if (metadata.isScreenshotHint) {
      contextItems.push('Screenshot Signal: Likely screenshot or screen capture.');
    }
    if (metadata.textExcerpt) {
      contextItems.push(`File Content / Metadata Excerpt:\n"""\n${metadata.textExcerpt}\n"""`);
    } else {
      contextItems.push('File Content / Metadata Excerpt: [None provided / zero-length / binary]');
    }

    return `You are SlothSort, an intelligent, privacy-preserving desktop file organization assistant.
Your task is to classify a single user file and suggest a safe, descriptive filename and destination.

Allowed Categories (choose EXACTLY one):
${ALLOWED_CATEGORIES.map(c => `- "${c}"`).join('\n')}

Category Definitions:
- "Documents": Reports, contracts, PDFs, spreadsheets, meeting notes, word documents, presentations, text documents.
- "Images": Photos, digital artwork, camera photos (excluding UI screenshots).
- "Screenshots": Screen captures, desktop/mobile screenshots, error dialog captures.
- "Projects": Source code files, code repositories, package manifests, build scripts, development files.
- "Installers": Executable setup files, MSI packages, installers, updater executables.
- "Archives": Compressed containers (.zip, .tar.gz, .7z, .rar) and backup packages.
- "Other": Media files (audio, video), empty/unknown data files, logs, or unclassifiable files.

Filename Rules:
- Propose a clean, concise, descriptive filename with its appropriate extension.
- If the current filename is already clear and descriptive, retain or lightly polish it.
- Never use illegal Windows characters: < > : " / \\ | ? *
- Never use Windows reserved names: CON, PRN, AUX, NUL, COM1-9, LPT1-9.
- If there is insufficient context to give a specific new name, keep the original filename.

Destination Rules:
- Propose a simple relative category or subfolder path (e.g. "Documents", "Documents/Finance", "Images/Vacation").
- Never use absolute paths, drive letters, or directory traversals ("..").

Output Requirements:
Return a single, raw JSON object conforming EXACTLY to this schema with NO extra commentary or markdown:
{
  "category": "Documents" | "Images" | "Screenshots" | "Projects" | "Installers" | "Archives" | "Other",
  "suggestedFilename": "string",
  "proposedDestination": "string",
  "confidence": "high" | "medium" | "low",
  "reasoning": "string"
}

Target File Context:
${contextItems.join('\n')}
`;
  }

  /**
   * Executes inference via the local Ollama /api/generate endpoint.
   */
  async classify(metadata: FileMetadata): Promise<RawInferenceResult> {
    const prompt = this.buildPrompt(metadata);
    const startTime = performance.now();

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        format: 'json',
        options: {
          temperature: this.temperature
        }
      })
    });

    const totalDurationMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama inference failed [HTTP ${response.status}]: ${errText}`);
    }

    const data = await response.json() as {
      response: string;
      total_duration?: number;
      prompt_eval_duration?: number;
      eval_duration?: number;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const metrics: InferenceMetrics = {
      totalDurationMs,
      promptEvalDurationMs: data.prompt_eval_duration ? Math.round(data.prompt_eval_duration / 1e6) : undefined,
      evalDurationMs: data.eval_duration ? Math.round(data.eval_duration / 1e6) : undefined,
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count
    };

    return {
      rawText: data.response,
      metrics
    };
  }
}
