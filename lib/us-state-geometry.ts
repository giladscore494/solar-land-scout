import { feature } from "topojson-client";
import topoModule from "us-atlas/states-10m.json";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { fipsToUsps } from "./fips";

let cached: FeatureCollection<Geometry> | null = null;

export function getUsStateFeatures(): FeatureCollection<Geometry> {
  if (cached) return cached;
  type TopoShape = import("topojson-specification").Topology<{
    states: import("topojson-specification").GeometryCollection;
  }>;
  const topo = (topoModule as unknown as { default?: unknown }).default ?? topoModule;
  const statesFc = feature(topo as TopoShape, (topo as TopoShape).objects.states) as
    | FeatureCollection<Geometry>
    | Feature<Geometry>;
  cached = statesFc.type === "FeatureCollection"
    ? statesFc
    : { type: "FeatureCollection", features: [statesFc] };
  cached.features = cached.features.map((entry) => {
    const fips = (entry.id != null ? String(entry.id) : null) ?? (entry.properties as { STATEFP?: string } | null)?.STATEFP ?? null;
    const stateCode = fips ? fipsToUsps(fips) : null;
    return {
      ...entry,
      properties: {
        ...(entry.properties ?? {}),
        state_code: stateCode,
      },
    };
  });
  return cached;
}

export function getStateFeature(stateCode: string) {
  return getUsStateFeatures().features.find(
    (feature) => (feature.properties as { state_code?: string } | null)?.state_code === stateCode
  ) ?? null;
}

export function getFeatureBounds(feature: Feature<Geometry>) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  walkCoordinates(feature.geometry, ([lng, lat]) => {
    minX = Math.min(minX, lng);
    minY = Math.min(minY, lat);
    maxX = Math.max(maxX, lng);
    maxY = Math.max(maxY, lat);
  });
  if (!Number.isFinite(minX)) return null;
  return {
    minLng: minX,
    minLat: minY,
    maxLng: maxX,
    maxLat: maxY,
  };
}

export function centroidOfFeature(feature: Feature<Geometry>): Position | null {
  let x = 0;
  let y = 0;
  let count = 0;
  walkCoordinates(feature.geometry, ([lng, lat]) => {
    x += lng;
    y += lat;
    count += 1;
  });
  if (!count) return null;
  return [x / count, y / count];
}

export function pointInsideFeature(position: Position, feature: Feature<Geometry>): boolean {
  const [lng, lat] = position;
  const geometry = feature.geometry;
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    return pointInsidePolygon(lng, lat, geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => pointInsidePolygon(lng, lat, polygon));
  }
  return false;
}

function pointInsidePolygon(lng: number, lat: number, polygon: number[][][]) {
  const [outer, ...holes] = polygon;
  if (!rayCast(lng, lat, outer)) return false;
  return !holes.some((ring) => rayCast(lng, lat, ring));
}

function rayCast(lng: number, lat: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function walkCoordinates(geometry: Geometry | null, visit: (position: Position) => void) {
  if (!geometry) return;
  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring) => ring.forEach((position) => visit(position)));
    return;
  }
  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => ring.forEach((position) => visit(position))));
  }
}
