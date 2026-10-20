import { OllamaClient } from './ollamaClient.js';
import { FileMetadata } from './types.js';
import { validateModelOutput } from './validator.js';

async function main() {
  const model = process.env.SLOTHSORT_MODEL || 'gemma3:4b';
  const client = new OllamaClient({ model });

  console.log(`SlothSort Local Inference Prototype`);
  console.log(`Connecting to local Ollama with model: ${model}...\n`);

  const health = await client.checkHealth();
  if (!health.isHealthy) {
    console.error(`Error: Ollama is not reachable at http://127.0.0.1:11434 (${health.error}).`);
    console.error(`Ensure Ollama is installed and running, then try again.`);
    process.exit(1);
  }

  const sampleFile: FileMetadata = {
    filename: 'IMG_4921.png',
    extension: '.png',
    sizeBytes: 4890000,
    mimeType: 'image/png',
    textExcerpt: 'Visual content hint: High dynamic range photograph of sunset over ocean horizon.'
  };

  console.log('Sending sample file for classification:');
  console.log(JSON.stringify(sampleFile, null, 2));

  try {
    const start = performance.now();
    const result = await client.classify(sampleFile);
    const duration = Math.round(performance.now() - start);

    console.log(`\nInference completed in ${duration}ms:`);
    console.log('Raw model output:');
    console.log(result.rawText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.rawText);
    } catch {
      console.error('Model output was not valid JSON!');
      process.exit(1);
    }

    const validation = validateModelOutput(parsed);
    console.log('\nValidation result:');
    if (validation.isValid && validation.sanitized) {
      console.log('STATUS: VALID');
      console.log(JSON.stringify(validation.sanitized, null, 2));
    } else {
      console.log('STATUS: INVALID');
      console.log('Errors:', validation.errors);
    }
  } catch (err: unknown) {
    console.error('Inference error:', err);
  }
}

main().catch(console.error);
