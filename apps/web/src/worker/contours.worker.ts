import type { GridSpec } from "@marsmap/core";
import { elevationContours } from "../map/contours";

self.onmessage = (event: MessageEvent<{ grid: GridSpec; elevation: Float32Array }>) => {
  self.postMessage(elevationContours(event.data.grid, event.data.elevation));
};
