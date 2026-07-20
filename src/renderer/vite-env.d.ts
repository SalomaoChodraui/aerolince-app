// Tipos do ambiente vite no renderer (import.meta.env.*), mínimos e sem depender de
// `vite/client` — que declararia `*.svg` de novo e conflitaria com ./svg.d.ts.
// A Task 10 reutiliza `import.meta.env.DEV` na captura real do VAD.
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
