// Web Worker: vygeneruje mapu prachu (9,2 mil. bodů) mimo hlavní vlákno, aby menu nezamrzlo.
// Odpověď: { dust: Uint8Array, init: Int32Array } (předané bez kopírování).
import { initGrid } from './hexgrid.js';
import { generateDust, hexes } from './dustmap.js';

self.onmessage = () => {
  initGrid();
  const dust = generateDust();
  const init = hexes.init;
  self.postMessage({ dust, init }, [dust.buffer, init.buffer]);
};
