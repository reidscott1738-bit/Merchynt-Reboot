const R = 6371; // km

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type GridPoint = { index: number; lat: number; lng: number; row: number; col: number };

/**
 * Square grid of gridSize x gridSize points centered on the business, spanning
 * the given radius. Points are deterministic for a configuration so historical
 * runs of the same configuration version are comparable point-by-point.
 */
export function generateGrid(center: { lat: number; lng: number }, radiusKm: number, gridSize: number): GridPoint[] {
  if (!Number.isInteger(gridSize) || gridSize < 3 || gridSize > 15 || gridSize % 2 === 0) {
    throw new Error("Grid size must be an odd number between 3 and 15");
  }
  if (!(radiusKm > 0 && radiusKm <= 50)) throw new Error("Radius must be between 0 and 50 km");
  if (Math.abs(center.lat) > 85 || Math.abs(center.lng) > 180) throw new Error("Invalid center coordinates");
  const half = (gridSize - 1) / 2;
  const stepKm = radiusKm / half;
  const latStep = stepKm / 111.32;
  const lngStep = stepKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  const points: GridPoint[] = [];
  let index = 0;
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      points.push({
        index: index++,
        row,
        col,
        lat: round6(center.lat + (half - row) * latStep),
        lng: round6(center.lng + (col - half) * lngStep),
      });
    }
  }
  return points;
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}
