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

interface MapViewProps {
  states: StateMacro[];
  sites: CandidateSite[];
  selectedStateCode: string | null;
  selectedSiteId: string | null;
  onSelectState: (code: string | null) => void;
  onSelectSite: (id: string | null) => void;
  basemap?: "dark" | "satellite";
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
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef<boolean>(false);

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
  const g = f.geometry;
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
