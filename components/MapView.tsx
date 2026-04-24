"use client";

import { useEffect, useRef } from "react";
import type {
  Map as MapLibreMap,
  LngLatBoundsLike,
  StyleSpecification,
  MapMouseEvent,
  MapGeoJSONFeature,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { CandidateSite, StateMacro } from "@/types/domain";
import type { ScanState } from "./ScanController";
import { colorForScore } from "@/lib/color-ramp";
import { fipsToUsps } from "@/lib/fips";

// Continental-US view bounds (wider on purpose to include AK/HI insets if shown).
const US_BOUNDS: LngLatBoundsLike = [
  [-170, 18], // SW
  [-60, 55], // NE
];
// Softer "max" bounds so users can't pan off the Americas entirely.
const US_MAX_BOUNDS: LngLatBoundsLike = [
  [-179, 5],
  [-50, 72],
];
const MIN_CELL_SCAN_ZOOM = 7;
const MIN_PARCEL_SCAN_ZOOM = 10;
const CELL_CAMERA_DURATION_MS = 400;
const PARCEL_CAMERA_DURATION_MS = 450;

interface MapViewProps {
  states: StateMacro[];
  sites: CandidateSite[];
  selectedStateCode: string | null;
  selectedSiteId: string | null;
  onSelectState: (code: string | null) => void;
  onSelectSite: (id: string | null) => void;
  basemap?: "dark" | "satellite";
  scanState?: ScanState;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

let warnedMissingMapbox = false;

export default function MapView({
  states,
  sites,
  selectedStateCode,
  selectedSiteId,
  onSelectState,
  onSelectSite,
  basemap = "dark",
  scanState,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef<boolean>(false);
  // Throttle camera moves to at most 1 per 500ms to avoid jitter during fast scans.
  const lastCameraMoveRef = useRef<number>(0);

  // Keep stable refs to latest callbacks so handlers don't churn.
  const cbRef = useRef({ onSelectState, onSelectSite });
  cbRef.current = { onSelectState, onSelectSite };

  /* ---------------------------- Map initialization --------------------------- */

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    (async () => {
      // Dynamic import — maplibre-gl is browser-only.
      const maplibregl = (await import("maplibre-gl")).default;

      // Load US states TopoJSON and convert to GeoJSON.
      const { feature } = await import("topojson-client");
      // Static JSON import from us-atlas. Webpack/Next bundle this.
      const topoModule = await import("us-atlas/states-10m.json");
      if (cancelled) return;

      // us-atlas Topology is loosely typed; cast to the shape topojson-client needs.
      type TopoShape = import("topojson-specification").Topology<{
        states: import("topojson-specification").GeometryCollection;
      }>;
      const topo = ((topoModule as { default?: unknown }).default ??
        topoModule) as unknown as TopoShape;
      const statesFc = feature(topo, topo.objects.states) as
        | FeatureCollection
        | Feature;
      const statesGeoJson: FeatureCollection<Geometry> =
        statesFc.type === "FeatureCollection"
          ? (statesFc as FeatureCollection<Geometry>)
          : {
              type: "FeatureCollection",
              features: [statesFc as Feature<Geometry>],
            };

      // Join macro scores onto each feature (attach via feature.properties).
      const byCode = new Map(states.map((s) => [s.state_code, s]));
      statesGeoJson.features = statesGeoJson.features.map((f) => {
        const fips =
          (f.id != null ? String(f.id) : null) ??
          (f.properties as { STATEFP?: string } | null)?.STATEFP ??
          null;
        const usps = fips ? fipsToUsps(fips) : null;
        const macro = usps ? byCode.get(usps) : undefined;
        return {
          ...f,
          id: fips ? Number(fips) : f.id,
          properties: {
            ...(f.properties ?? {}),
            state_code: usps ?? null,
            state_name: macro?.state_name ?? (f.properties as { name?: string } | null)?.name ?? null,
            macro_total_score: macro?.macro_total_score ?? null,
            recommended_label: macro?.recommended_label ?? null,
            fill_color: macro
              ? colorForScore(macro.macro_total_score)
              : "#0f1626",
          },
        };
      });

      const style = buildStyle();

      const map = new maplibregl.Map({
        container: containerRef.current!,
        style,
        bounds: US_BOUNDS,
        fitBoundsOptions: { padding: 40 },
        maxBounds: US_MAX_BOUNDS,
        minZoom: 2.5,
        maxZoom: 11,
        attributionControl: { compact: true },
        renderWorldCopies: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchZoomRotate: true,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;

      map.on("load", () => {
        if (cancelled) return;

        map.addSource("us-states", { type: "geojson", data: statesGeoJson });
        map.addSource("candidate-sites", {
          type: "geojson",
          data: emptyFc(),
        });

        // Scan overlay sources (populated dynamically during a scan).
        map.addSource("scan-cells", { type: "geojson", data: emptyFc() });
        map.addSource("scan-parcels", { type: "geojson", data: emptyFc() });

        // Scan cell fill (soft colors: green=passed, amber=soft-reject, red=hard-reject).
        map.addLayer({
          id: "scan-cells-fill",
          type: "fill",
          source: "scan-cells",
          paint: {
            "fill-color": [
              "match",
              ["get", "verdict"],
              "passed", "#22c55e",
              "soft_reject", "#f59e0b",
              "#ef4444",
            ],
            "fill-opacity": 0.18,
          },
        });
        map.addLayer({
          id: "scan-cells-outline",
          type: "line",
          source: "scan-cells",
          paint: {
            "line-color": [
              "match",
              ["get", "verdict"],
              "passed", "#22c55e",
              "soft_reject", "#f59e0b",
              "#ef4444",
            ],
            "line-width": 1,
            "line-opacity": 0.55,
          },
        });

        // Parcel engine overlay.
        map.addLayer({
          id: "scan-parcels-fill",
          type: "fill",
          source: "scan-parcels",
          paint: {
            "fill-color": [
              "case",
              ["==", ["get", "status"], "error"], "#a855f7",
              ["==", ["get", "status"], "rejected"], "#ef4444",
              ["!", ["has", "score"]], "#64748b",
              [
                "interpolate",
                ["linear"],
                ["get", "score"],
                0, "#f59e0b",
                60, "#84cc16",
                85, "#22c55e",
              ],
            ],
            "fill-opacity": 0.3,
          },
        });
        map.addLayer({
          id: "scan-parcels-outline",
          type: "line",
          source: "scan-parcels",
          paint: {
            "line-color": [
              "case",
              ["==", ["get", "status"], "error"], "#c084fc",
              ["==", ["get", "status"], "rejected"], "#f87171",
              "#86efac",
            ],
            "line-width": 0.8,
            "line-opacity": 0.6,
          },
        });

        // Optional Mapbox satellite raster basemap (hidden by default).
        if (MAPBOX_TOKEN.trim() !== "") {
          map.addSource("mapbox-satellite", {
            type: "raster",
            tiles: [
              `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/{z}/{x}/{y}?access_token=${encodeURIComponent(
                MAPBOX_TOKEN
              )}`,
            ],
            tileSize: 512,
            attribution:
              '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.maxar.com/">Maxar</a>',
          });
          map.addLayer({
            id: "mapbox-satellite",
            type: "raster",
            source: "mapbox-satellite",
            layout: { visibility: "none" },
            paint: { "raster-opacity": 0.95 },
          });
        } else if (!warnedMissingMapbox) {
          warnedMissingMapbox = true;
          // eslint-disable-next-line no-console
          console.warn(
            "[MapView] NEXT_PUBLIC_MAPBOX_TOKEN is not set — satellite basemap toggle disabled."
          );
        }

        // Base state fill (choropleth by macro score), plus hover & selected feature-states.
        map.addLayer({
          id: "states-fill",
          type: "fill",
          source: "us-states",
          paint: {
            "fill-color": [
              "case",
              ["!", ["has", "fill_color"]],
              "#0f1626",
              ["to-color", ["get", "fill_color"], "#0f1626"],
            ],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              0.95,
              ["boolean", ["feature-state", "hover"], false],
              0.85,
              0.7,
            ],
          },
        });

        map.addLayer({
          id: "states-outline",
          type: "line",
          source: "us-states",
          paint: {
            "line-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              "#ffe08a",
              ["boolean", ["feature-state", "hover"], false],
              "#9aa7bd",
              "#1f2a3d",
            ],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              2.2,
              ["boolean", ["feature-state", "hover"], false],
              1.4,
              0.8,
            ],
          },
        });


        map.addLayer({
          id: "state-labels",
          type: "symbol",
          source: "us-states",
          layout: {
            "text-field": ["coalesce", ["get", "state_name"], ""],
            "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 6, 12, 9, 14],
            "text-font": ["Open Sans Regular"],
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": "#cbd5e1",
            "text-halo-color": "#020617",
            "text-halo-width": 1,
          },
          minzoom: 3,
        });

        // Candidate sites: glow halo + inner dot.
        map.addLayer({
          id: "sites-glow",
          type: "circle",
          source: "candidate-sites",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              3, 6,
              6, 14,
              9, 20,
            ],
            "circle-color": "#ffb020",
            "circle-opacity": 0.18,
            "circle-blur": 0.6,
          },
        });
        map.addLayer({
          id: "sites-dot",
          type: "circle",
          source: "candidate-sites",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              3, 3,
              6, 6,
              9, 9,
            ],
            "circle-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              "#ffe08a",
              ["boolean", ["get", "excluded"], false],
              "#dc2626",
              "#ffb020",
            ],
            "circle-stroke-color": [
              "case",
              ["boolean", ["get", "excluded"], false],
              "#fca5a5",
              "#070a10",
            ],
            "circle-stroke-width": 1.5,
          },
        });

        readyRef.current = true;

        /* ----------------------------- Interactions ----------------------------- */

        let hoverId: number | string | null = null;
        const setHover = (id: number | string | null) => {
          if (hoverId !== null) {
            map.setFeatureState({ source: "us-states", id: hoverId }, { hover: false });
          }
          hoverId = id;
          if (id !== null) {
            map.setFeatureState({ source: "us-states", id }, { hover: true });
          }
        };

        map.on("mousemove", "states-fill", (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
          map.getCanvas().style.cursor = "pointer";
          const f = e.features?.[0];
          if (!f || f.id == null) return;
          setHover(f.id as number);
        });
        map.on("mouseleave", "states-fill", () => {
          map.getCanvas().style.cursor = "";
          setHover(null);
        });

        map.on("click", "states-fill", (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
          const f = e.features?.[0];
          if (!f) return;
          const code = (f.properties as { state_code?: string } | null)?.state_code ?? null;
          if (code) cbRef.current.onSelectState(code);
        });

        map.on("click", "sites-dot", (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
          const f = e.features?.[0];
          if (!f) return;
          const id = (f.properties as { id?: string } | null)?.id;
          if (id) cbRef.current.onSelectSite(id);
        });
        map.on("mouseenter", "sites-dot", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "sites-dot", () => {
          map.getCanvas().style.cursor = "";
        });
      });
    })().catch((err) => {
      // Non-fatal; the UI still works without the map canvas.
      // eslint-disable-next-line no-console
      console.error("MapView init failed:", err);
    });

    return () => {
      cancelled = true;
      readyRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once — downstream data is pushed via other effects

  /* -------------------------- Push state updates to map ------------------------ */

  // Re-apply macro scores if `states` array changes after init.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("us-states") as
      | { _data?: FeatureCollection; setData: (d: FeatureCollection) => void }
      | undefined;
    if (!src || !src._data) return;
    const byCode = new Map(states.map((s) => [s.state_code, s]));
    const next: FeatureCollection = {
      ...src._data,
      features: src._data.features.map((f) => {
        const usps = (f.properties as { state_code?: string } | null)?.state_code ?? null;
        const macro = usps ? byCode.get(usps) : undefined;
        return {
          ...f,
          properties: {
            ...(f.properties ?? {}),
            macro_total_score: macro?.macro_total_score ?? null,
            recommended_label: macro?.recommended_label ?? null,
            fill_color: macro ? colorForScore(macro.macro_total_score) : "#0f1626",
          },
        };
      }),
    };
    src.setData(next);
  }, [states]);

  // Push candidate sites to the map as a FeatureCollection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("candidate-sites") as
      | { setData: (d: FeatureCollection) => void }
      | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: sites.map((s) => ({
        type: "Feature",
        id: s.id,
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        properties: {
          id: s.id,
          title: s.title,
          score: s.overall_site_score,
          state_code: s.state_code,
          excluded:
            s.in_protected_area === true || s.in_flood_zone === true,
        },
      })),
    });
  }, [sites]);

  // Toggle satellite raster + state choropleth visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const hasSat = !!map.getLayer("mapbox-satellite");
    const satVis = basemap === "satellite" ? "visible" : "none";
    const choroVis = basemap === "satellite" ? "none" : "visible";
    if (hasSat) map.setLayoutProperty("mapbox-satellite", "visibility", satVis);
    if (map.getLayer("states-fill")) {
      map.setLayoutProperty("states-fill", "visibility", choroVis);
    }
  }, [basemap]);

  // Selection + zoom behavior.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    // Reset all states selected=false then mark selected one.
    const src = map.getSource("us-states") as { _data?: FeatureCollection } | undefined;
    src?._data?.features.forEach((f) => {
      if (f.id != null) {
        map.setFeatureState({ source: "us-states", id: f.id as number }, { selected: false });
      }
    });

    if (!selectedStateCode) {
      map.fitBounds(US_BOUNDS, { padding: 40, duration: 900, essential: true });
      return;
    }

    const feat = src?._data?.features.find(
      (f) => (f.properties as { state_code?: string } | null)?.state_code === selectedStateCode
    );
    if (!feat) return;
    if (feat.id != null) {
      map.setFeatureState({ source: "us-states", id: feat.id as number }, { selected: true });
    }
    const b = bboxOfFeature(feat);
    if (b) {
      map.fitBounds(b, { padding: 70, duration: 1000, essential: true, maxZoom: 9.2 });
    }
  }, [selectedStateCode]);

  // Highlight selected site.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    // Clear previous
    sites.forEach((s) => {
      map.setFeatureState({ source: "candidate-sites", id: s.id }, { selected: false });
    });
    if (selectedSiteId) {
      map.setFeatureState(
        { source: "candidate-sites", id: selectedSiteId },
        { selected: true }
      );
      const s = sites.find((x) => x.id === selectedSiteId);
      if (s) {
        map.easeTo({
          center: [s.lng, s.lat],
          zoom: Math.max(map.getZoom(), 10),
          duration: 800,
        });
      }
    }
  }, [selectedSiteId, sites]);

  // Update scan-cells overlay as cells arrive during a scan.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("scan-cells") as
      | { setData: (d: FeatureCollection) => void }
      | undefined;
    if (!src) return;

    if (!scanState || scanState.status === "idle") {
      src.setData(emptyFc());
      return;
    }

    const features: Feature[] = [];
    for (const [cellId, cell] of scanState.cellResults) {
      const [minLng, minLat, maxLng, maxLat] = cell.bbox;
      features.push({
        type: "Feature",
        id: cellId,
        geometry: {
          type: "Polygon",
          coordinates: [[
            [minLng, minLat],
            [maxLng, minLat],
            [maxLng, maxLat],
            [minLng, maxLat],
            [minLng, minLat],
          ]],
        },
        properties: { cellId, verdict: cell.verdict },
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }, [scanState?.cellResults, scanState?.status]);

  // Update scan-parcels overlay as parcel results arrive during a scan.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("scan-parcels") as
      | { setData: (d: FeatureCollection) => void }
      | undefined;
    if (!src) return;

    if (!scanState || scanState.status === "idle" || scanState.engine !== "parcel") {
      src.setData(emptyFc());
      return;
    }

    const features: Feature[] = [];
    for (const [parcelId, parcel] of scanState.parcelResults) {
      if (!parcel.geometry) continue;
      features.push({
        type: "Feature",
        id: parcelId,
        geometry: parcel.geometry,
        properties: {
          parcelId,
          status: parcel.status,
          reason: parcel.reason ?? null,
          ...(parcel.properties ?? {}),
          ...(parcel.score != null ? { score: parcel.score } : {}),
        },
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }, [scanState?.engine, scanState?.parcelResults, scanState?.status]);

  // Pan to current cell during scan.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (!scanState?.currentCellId) return;
    const cell = scanState.cellResults.get(scanState.currentCellId);
    if (!cell) return;
    // Throttle: at most one camera move per 500ms.
    const now = Date.now();
    if (now - lastCameraMoveRef.current < 500) return;
    lastCameraMoveRef.current = now;
    const [minLng, minLat, maxLng, maxLat] = cell.bbox;
    const centerLng = (minLng + maxLng) / 2;
    const centerLat = (minLat + maxLat) / 2;
    map.easeTo({
      center: [centerLng, centerLat],
      zoom: Math.max(map.getZoom(), MIN_CELL_SCAN_ZOOM),
      duration: CELL_CAMERA_DURATION_MS,
    });
  }, [scanState?.currentCellId]);

  // Pan/fit to the active parcel during parcel scans.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (scanState?.engine !== "parcel" || !scanState.currentParcelId) return;
    const parcel = scanState.parcelResults.get(scanState.currentParcelId);
    if (!parcel) return;
    const now = Date.now();
    if (now - lastCameraMoveRef.current < 500) return;
    lastCameraMoveRef.current = now;

    if (parcel.centroid) {
      map.easeTo({
        center: [parcel.centroid.lng, parcel.centroid.lat],
        zoom: Math.max(map.getZoom(), MIN_PARCEL_SCAN_ZOOM),
        duration: PARCEL_CAMERA_DURATION_MS,
      });
      return;
    }

    if (!parcel.geometry) return;
    const bounds = bboxOfGeometry(parcel.geometry);
    if (!bounds) return;
    map.fitBounds(bounds, {
      padding: 80,
      duration: PARCEL_CAMERA_DURATION_MS,
      essential: true,
      maxZoom: 12.5,
    });
  }, [scanState?.currentParcelId, scanState?.engine]);

  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-0 map-grid-bg" />
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}

export const mapboxTokenConfigured: boolean = MAPBOX_TOKEN.trim() !== "";

/* --------------------------------- helpers --------------------------------- */

function emptyFc(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

/**
 * Rough bbox extractor for a GeoJSON (Multi)Polygon without pulling in turf.
 * Good enough for state-level fitBounds.
 */
function bboxOfFeature(
  f: Feature
): [[number, number], [number, number]] | null {
  return bboxOfGeometry(f.geometry);
}

function bboxOfGeometry(
  g: Geometry | null | undefined
): [[number, number], [number, number]] | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const eachRing = (ring: number[][]) => {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  };
  if (!g) return null;
  if (g.type === "Polygon") {
    g.coordinates.forEach(eachRing);
  } else if (g.type === "MultiPolygon") {
    g.coordinates.forEach((p) => p.forEach(eachRing));
  } else {
    return null;
  }
  if (!Number.isFinite(minX)) return null;
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

/**
 * Build a MapLibre style. If a MapTiler key is present we use their dark theme
 * as a base. Otherwise we use a minimal dark background + our state polygons,
 * which still renders a perfectly usable dark choropleth.
 */
function buildStyle(): StyleSpecification {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key && key.trim() !== "") {
    return `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${encodeURIComponent(
      key
    )}` as unknown as StyleSpecification;
  }
  // Fallback — no tiles, just a dark canvas. Our state polygons are the map.
  return {
    version: 8,
    name: "solar-dark-fallback",
    sources: {},
    layers: [
      {
        id: "bg",
        type: "background",
        paint: { "background-color": "#070a10" },
      },
    ],
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  };
}
