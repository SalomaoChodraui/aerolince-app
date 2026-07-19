import type { AerolinceApi } from '../preload/index.js';

declare global {
  interface Window {
    aerolince: AerolinceApi;
  }
}

export {};
