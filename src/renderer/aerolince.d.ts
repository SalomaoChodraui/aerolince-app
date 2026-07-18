import type { AerolinceApi } from '../preload/index.js';

declare global {
  interface Window {
    aerolince: AerolinceApi;
  }
}

declare module '*.svg' {
  const url: string;
  export default url;
}

export {};
