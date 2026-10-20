import { SlothSortAPI } from '../../main/preload.js';

declare global {
  interface Window {
    slothsort: SlothSortAPI;
  }
}

export {};
