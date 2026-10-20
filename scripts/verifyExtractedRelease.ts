import { PackagedAppDriver } from './packagedAppDriver.js';

async function main() {
  const driver = new PackagedAppDriver();
  driver.exePath = 'D:\\SlothSort-Phase3B-Test\\release_zip_test\\SlothSort.exe';
  driver.userDataDir = 'D:\\SlothSort-Phase3B-Test\\release_zip_profile';

  console.log('[VerifyExtractedRelease] Launching extracted binary from release ZIP...');
  try {
    await driver.launch({ port: 9244 });
    await new Promise((r) => setTimeout(r, 2500));

    const title = await driver.eval('document.title');
    console.log('[VerifyExtractedRelease] Document Title:', title);

    const hasSlothSortApi = await driver.eval('typeof window.slothsort === "object" && window.slothsort !== null');
    console.log('[VerifyExtractedRelease] Has window.slothsort API:', hasSlothSortApi);

    if (title.includes('SlothSort') && hasSlothSortApi) {
      console.log('[VerifyExtractedRelease] SUCCESS: Extracted ZIP binary launches and initializes cleanly!');
    } else {
      throw new Error(`Unexpected document title or missing window.slothsort API: title=${title}, api=${hasSlothSortApi}`);
    }
  } finally {
    await driver.close();
    console.log('[VerifyExtractedRelease] Extracted app closed cleanly.');
  }
}

main().catch((err) => {
  console.error('[VerifyExtractedRelease] Verification failed:', err);
  process.exit(1);
});
