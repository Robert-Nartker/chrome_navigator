// Types for loader.js (untyped demo code; the engine objects are left as `any`).
export function parseSafetensorsHeaderStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ header: any; headerLen: number; dataBase: number; leftover: Uint8Array }>;
export function prepareWasmReducedImage(header: any, Module: any): { reducedPtr: number; reducedLen: number; wasmNormMap: Map<string, number> };
export function extractModelDescriptorsFromHeader(header: any, dataBase: number): { decEntries: any[]; encEntries: any[]; decLayers: number; encLayers: number };
export function buildIntervalDispatchTable(header: any, dataBase: number, decoder: any, encoder: any, wasmNormMap: Map<string, number>): any[];
export class IntervalDispatcher {
  constructor(intervals: any[], device: any, Module: any);
}
export function streamChunksToTargets(o: {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  dispatcher: IntervalDispatcher;
  initialFileOffset: number;
  totalBytes: number;
  device: any;
  excessChunk?: Uint8Array;
  reportProgress?: (current: number, total: number) => void;
}): Promise<void>;
export function setupGpuHooks(gpu: any, encoder: any, Module: any): void;
