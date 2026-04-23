import { getStateBbox } from "./state-bbox";

export interface GridCell {
  id: string;
  stateCode: string;
  row: number;
  col: number;
  centerLat: number;
  centerLng: number;
  bboxDeg: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  sizeKm: number;
}

const DEFAULT_SIZE_KM = 10;
const MAX_CELLS = 2500;

export function buildGridForState(stateCode: string, sizeKm = DEFAULT_SIZE_KM): GridCell[] {
  const bbox = getStateBbox(stateCode);
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const dLat = sizeKm / 111;
  const dLng = sizeKm / (111 * Math.cos((midLat * Math.PI) / 180));

  const cells: GridCell[] = [];

  const numRows = Math.ceil((bbox.maxLat - bbox.minLat) / dLat);
  const numCols = Math.ceil((bbox.maxLng - bbox.minLng) / dLng);

  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      const centerLat = bbox.minLat + (row + 0.5) * dLat;
      const centerLng = bbox.minLng + (col + 0.5) * dLng;

      // Only include cells whose center is within the bounding box
      if (centerLat > bbox.maxLat || centerLng > bbox.maxLng) continue;

      cells.push({
        id: `${stateCode}-r${row}-c${col}`,
        stateCode,
        row,
        col,
        centerLat: Number(centerLat.toFixed(5)),
        centerLng: Number(centerLng.toFixed(5)),
        bboxDeg: [
          Number((bbox.minLng + col * dLng).toFixed(5)),
          Number((bbox.minLat + row * dLat).toFixed(5)),
          Number((bbox.minLng + (col + 1) * dLng).toFixed(5)),
          Number((bbox.minLat + (row + 1) * dLat).toFixed(5)),
        ],
        sizeKm,
      });
    }
  }

  return prioritizeCells(cells, 75).slice(0, MAX_CELLS);
}

export function prioritizeCells(cells: GridCell[], _stateMacroScore: number): GridCell[] {
  if (cells.length === 0) return cells;

  // Calculate the center of the bounding box
  const centerLat = cells.reduce((sum, c) => sum + c.centerLat, 0) / cells.length;
  const centerLng = cells.reduce((sum, c) => sum + c.centerLng, 0) / cells.length;

  // Sort by distance to center (center-out spiral effect)
  return [...cells].sort((a, b) => {
    const distA = Math.sqrt(
      (a.centerLat - centerLat) ** 2 + (a.centerLng - centerLng) ** 2
    );
    const distB = Math.sqrt(
      (b.centerLat - centerLat) ** 2 + (b.centerLng - centerLng) ** 2
    );
    return distA - distB;
  });
}
