/// <reference lib="webworker" />
import { solidify, type SolidifyInput } from "./solidify";

// Le calcul prend quelques secondes : hors du fil de la page.
self.onmessage = (event: MessageEvent<Omit<SolidifyInput, "onProgress">>) => {
  try {
    const out = solidify({
      ...event.data,
      onProgress: (fraction, step) => self.postMessage({ type: "progress", fraction, step }),
    });
    self.postMessage({ type: "done", out }, [out.positions.buffer, out.indices.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
