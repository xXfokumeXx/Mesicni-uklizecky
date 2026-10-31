// Web Worker: počítá okna osvětlení (stíny terénu) mimo hlavní vlákno, aby hra nezasekávala.
// Zpráva: { key, f, oi, oj, dir, Q, step } → odpověď { key, data: Float32Array }.
import { chunkWindows } from './sunwindow.js';

self.onmessage = e => {
  const job = e.data;
  const data = chunkWindows(job);
  self.postMessage({ key: job.key, data }, [data.buffer]);
};
