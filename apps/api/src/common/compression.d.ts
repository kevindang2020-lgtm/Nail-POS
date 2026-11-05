// Minimal local typings for `compression` 1.8.1 (only what http-compression.ts uses) — avoids pulling @types/compression
// and its @types/express dependency tree in just for two signatures.
declare module 'compression' {
  import type { RequestHandler, Request, Response } from 'express';
  interface CompressionOptions { threshold?: number | string; filter?: (req: Request, res: Response) => boolean; level?: number }
  interface CompressionFn { (options?: CompressionOptions): RequestHandler; filter(req: Request, res: Response): boolean }
  const compression: CompressionFn;
  export default compression;
}
