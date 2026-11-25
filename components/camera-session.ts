type Point = { x: number; y: number };
export type Box = Point & { width: number; height: number; id: string };
type Match = { cardId: string; evidence: string };
type MatchResult = { region: Box; candidates: Match[]; additionalCandidates?: Match[]; diagnostics?: { matchBackend?: string } };
export type PhaseTimes = { prepare: number; retrieve: number; verify: number; yieldWait: number; verifyDetail?: { geometry?: number } };
type Engine = {
  initialize(): Promise<void>;
  recognizeRegions(photo: HTMLCanvasElement, boxes: Box[]): Promise<{ regions: MatchResult[]; timingsMs: PhaseTimes }>;
  dispose(): Promise<void>;
};
export const engineModule = (file: string) => import(/* @vite-ignore */ new URL('/camera-engine/src/' + file + '.mjs', document.baseURI).href);

// One index per open inventory dialog. Photos and results stay in the capture UI.
export function createCameraSession(liveIds: string[]) {
  let generation = 0;
  let pending: Promise<{ engine: Engine; setupMs: number }> | undefined;
  let active: Engine | undefined;
  let progress: ((message: string) => void) | undefined;
  function reset() {
    generation++; pending = undefined; progress = undefined;
    const engine = active; active = undefined;
    return engine?.dispose();
  }
  function prepare(report?: (message: string) => void) {
    if (report) progress = report;
    if (!pending) {
      const token = generation;
      const start = performance.now();
      pending = (async () => {
        const module = await engineModule('multi-engine');
        if (token !== generation) throw Error('準備を中止しました。');
        const engine: Engine = module.createMultiEngine({ liveCardIds: liveIds, onProgress: (p: { status: string }) => {
          if (token === generation) progress?.(p.status);
        } });
        active = engine;
        await engine.initialize();
        if (token !== generation) throw Error('準備を中止しました。');
        return { engine, setupMs: performance.now() - start };
      })().catch(async err => { if (token === generation) await reset(); throw err; });
    }
    return pending;
  }
  return { prepare, reset, clearProgress() { progress = undefined; } };
}
export type CameraSession = ReturnType<typeof createCameraSession>;
export type ScanTiming = { setupMs: number; waitMs: number; matchMs: number; elapsedMs: number; phases: PhaseTimes; backends: string[] };
