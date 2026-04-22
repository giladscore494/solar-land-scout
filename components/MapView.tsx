"use client";

import { useEffect, useRef } from "react";
import type {
  Map as MapLibreMap,
  LngLatBoundsLike,
  PaddingOptions,
  StyleSpecification,
  MapMouseEvent,
  MapGeoJSONFeature,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { CandidateSite, Language, StateMacro } from "@/types/domain";
import { colorForScore } from "@/lib/color-ramp";
import { fipsToUsps } from "@/lib/fips";
import { localizeStateName } from "@/lib/i18n";

const US_BOUNDS: LngLatBoundsLike = [
  [-170, 18],
  [-60, 55],
];
const US_MAX_BOUNDS: LngLatBoundsLike = [
  [-179, 5],
  [-50, 72],
];
const STATE_PADDING: PaddingOptions = { top: 90, bottom: 90, left: 80, right: 520 };
const STATE_LABEL_TEXT_SIZE_STOPS = [3.2, 9, 5.5, 12, 8.5, 13] as const;
const STATE_LABEL_OPACITY_STOPS = [3.2, 0.42, 4.8, 0.65, 8, 0.18] as const;

interface MapViewProps {
  states: StateMacro[];
  sites: CandidateSite[];
  selectedStateCode: string | null;
  selectedSiteId: string | null;
  language: Language;
  onSelectState: (code: string | null) => void;
  onSelectSite: (id: string | null) => void;
}

export default function MapView({
  states,
  sites,
  selectedStateCode,
  selectedSiteId,
  language,
  onSelectState,
  onSelectSite,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);

  const callbackRef = useRef({ onSelectState, onSelectSite });
  callbackRef.current = { onSelectState, onSelectSite };

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      const { feature } = await import("topojson-client");
      const topoModule = await import("us-atlas/states-10m.json");
      if (cancelled) return;

      type TopoShape = import("topojson-specification").Topology<{
        states: import("topojson-specification").GeometryCollection;
      }>;
      const topo = ((topoModule as { default?: unknown }).default ?? topoModule) as unknown as TopoShape;
      const statesFc = feature(topo, topo.objects.states) as FeatureCollection | Feature;
      const statesGeoJson: FeatureCollection<Geometry> =
        statesFc.type === "FeatureCollection"
          ? (statesFc as FeatureCollection<Geometry>)
          : { type: "FeatureCollection", features: [statesFc as Feature<Geometry>] };

      const { polygonFeatures, labelFeatures } = hydrateStateCollections(statesGeoJson, states, language);
      const map = new maplibregl.Map({
        container: containerRef.current!,
        style: buildStyle(),
        bounds: US_BOUNDS,
        fitBoundsOptions: { padding: 40 },
        maxBounds: US_MAX_BOUNDS,
        minZoom: 2.5,
        maxZoom: 12,
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

        map.addSource("us-states", { type: "geojson", data: polygonFeatures });
        map.addSource("state-labels", { type: "geojson", data: labelFeatures });
        map.addSource("candidate-sites", { type: "geojson", data: emptyFc() });

        map.addLayer({
          id: "states-fill",
          type: "fill",
          source: "us-states",
          paint: {
            "fill-color": ["case", ["!", ["has", "fill_color"]], "#0f1626", ["to-color", ["get", "fill_color"], "#0f1626"]],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false], 0.96,
              ["boolean", ["feature-state", "hover"], false], 0.9,
              0.74,
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
              ["boolean", ["feature-state", "selected"], false], "#ffe08a",
              ["boolean", ["feature-state", "hover"], false], "#9aa7bd",
              "#1f2a3d",
            ],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false], 2.4,
              ["boolean", ["feature-state", "hover"], false], 1.5,
              0.85,
            ],
          },
        });

        map.addLayer({
          id: "state-labels",
          type: "symbol",
          source: "state-labels",
          minzoom: 3.2,
          layout: {
            "text-field": ["get", "label"],
            "text-size": ["interpolate", ["linear"], ["zoom"], ...STATE_LABEL_TEXT_SIZE_STOPS],
            "text-letter-spacing": 0.03,
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Regular"],
            "text-max-width": 8,
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": "#d5deef",
            "text-opacity": ["interpolate", ["linear"], ["zoom"], ...STATE_LABEL_OPACITY_STOPS],
            "text-halo-color": "rgba(7,10,16,0.95)",
            "text-halo-width": 1.2,
          },
        });

        map.addLayer({
          id: "sites-glow",
          type: "circle",
          source: "candidate-sites",
          paint: {
            "circle-radius": [
              "case",
              ["boolean", ["feature-state", "selected"], false], ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 22, 11, 28],
              ["boolean", ["feature-state", "hover"], false], ["interpolate", ["linear"], ["zoom"], 4, 8, 8, 18, 11, 24],
              ["interpolate", ["linear"], ["zoom"], 4, 6, 8, 14, 11, 20],
            ],
            "circle-color": ["case", ["boolean", ["feature-state", "selected"], false], "#ffe08a", "#ffb020"],
            "circle-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false], 0.55,
              ["boolean", ["feature-state", "hover"], false], 0.34,
              0.2,
            ],
            "circle-blur": 0.75,
          },
        });

        map.addLayer({
          id: "sites-dot",
          type: "circle",
          source: "candidate-sites",
          paint: {
            "circle-radius": [
              "case",
              ["boolean", ["feature-state", "selected"], false], ["interpolate", ["linear"], ["zoom"], 4, 4.5, 8, 8.5, 11, 11],
              ["boolean", ["feature-state", "hover"], false], ["interpolate", ["linear"], ["zoom"], 4, 4, 8, 7.5, 11, 9.5],
              ["interpolate", ["linear"], ["zoom"], 4, 3.5, 8, 6.5, 11, 8.5],
            ],
            "circle-color": ["case", ["boolean", ["feature-state", "selected"], false], "#ffe08a", "#ffb020"],
            "circle-stroke-color": "#070a10",
            "circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.4, 1.6],
          },
        });

        readyRef.current = true;

        let hoverId: number | string | null = null;
        let hoverSiteId: string | null = null;
        const setStateHover = (id: number | string | null) => {
          if (hoverId !== null) map.setFeatureState({ source: "us-states", id: hoverId }, { hover: false });
          hoverId = id;
          if (id !== null) map.setFeatureState({ source: "us-states", id }, { hover: true });
        };
        const setSiteHover = (id: string | null) => {
          if (hoverSiteId !== null) map.setFeatureState({ source: "candidate-sites", id: hoverSiteId }, { hover: false });
          hoverSiteId = id;
          if (id !== null) map.setFeatureState({ source: "candidate-sites", id }, { hover: true });
        };

        const selectStateFromFeature = (feature?: MapGeoJSONFeature) => {
          const code = (feature?.properties as { state_code?: string } | null)?.state_code ?? null;
          if (code) callbackRef.current.onSelectState(code);
        };

        map.on("mousemove", "states-fill", (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
          map.getCanvas().style.cursor = "pointer";
          const feature = event.features?.[0];
          if (!feature || feature.id == null) return;
          setStateHover(feature.id as number);
        });
        map.on("mouseleave", "states-fill", () => {
          map.getCanvas().style.cursor = "";
          setStateHover(null);
        });
        map.on("click", "states-fill", (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
          selectStateFromFeature(event.features?.[0]);
        });
        map.on("click", "state-labels", (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
          selectStateFromFeature(event.features?.[0]);
        });

        map.on("mousemove", "sites-dot", (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
          map.getCanvas().style.cursor = "pointer";
          const siteId = (event.features?.[0]?.properties as { id?: string } | null)?.id ?? null;
          setSiteHover(siteId);
        });
        map.on("mouseleave", "sites-dot", () => {
          map.getCanvas().style.cursor = "";
          setSiteHover(null);
        });
        map.on("click", "sites-dot", (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
          const siteId = (event.features?.[0]?.properties as { id?: string } | null)?.id;
          if (siteId) callbackRef.current.onSelectSite(siteId);
        });
      });
    })().catch((error) => {
      console.error("MapView init failed:", error);
    });

    return () => {
      cancelled = true;
      readyRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const statesSource = map.getSource("us-states") as { _data?: FeatureCollection<Geometry>; setData: (data: FeatureCollection<Geometry>) => void } | undefined;
    const labelsSource = map.getSource("state-labels") as { setData: (data: FeatureCollection<Geometry>) => void } | undefined;
    if (!statesSource?._data || !labelsSource) return;
    const hydrated = hydrateStateCollections(statesSource._data, states, language);
    statesSource.setData(hydrated.polygonFeatures);
    labelsSource.setData(hydrated.labelFeatures);
  }, [states, language]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const siteSource = map.getSource("candidate-sites") as { setData: (data: FeatureCollection<Geometry>) => void } | undefined;
    if (!siteSource) return;
    siteSource.setData({
      type: "FeatureCollection",
      features: sites.map((site) => ({
        type: "Feature",
        id: site.id,
        geometry: { type: "Point", coordinates: [site.lng, site.lat] },
        properties: { id: site.id, title: site.title, score: site.overall_site_score, state_code: site.state_code },
      })),
    });
  }, [sites]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const statesSource = map.getSource("us-states") as { _data?: FeatureCollection<Geometry> } | undefined;
    statesSource?._data?.features.forEach((feature) => {
      if (feature.id != null) map.setFeatureState({ source: "us-states", id: feature.id as number }, { selected: false });
    });

    if (!selectedStateCode) {
      map.fitBounds(US_BOUNDS, { padding: 40, duration: 900, essential: true });
      return;
    }

    const selectedFeature = statesSource?._data?.features.find(
      (feature) => (feature.properties as { state_code?: string } | null)?.state_code === selectedStateCode
    );
    if (!selectedFeature) return;
    if (selectedFeature.id != null) map.setFeatureState({ source: "us-states", id: selectedFeature.id as number }, { selected: true });
    const bounds = bboxOfFeature(selectedFeature);
    if (bounds) {
      map.fitBounds(bounds, { padding: STATE_PADDING, duration: 1200, essential: true, maxZoom: 8.2 });
    }
  }, [selectedStateCode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !selectedStateCode) return;
    const visibleSites = sites.filter((site) => site.state_code === selectedStateCode);
    if (!visibleSites.length) return;
    if (visibleSites.length === 1) {
      map.easeTo({ center: [visibleSites[0].lng, visibleSites[0].lat], zoom: Math.max(map.getZoom(), 9.4), duration: 900 });
      return;
    }
    const bounds = boundsForSites(visibleSites);
    if (bounds) {
      map.fitBounds(bounds, { padding: STATE_PADDING, duration: 1100, maxZoom: 9.6, essential: true });
    }
  }, [selectedStateCode, sites]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    sites.forEach((site) => map.setFeatureState({ source: "candidate-sites", id: site.id }, { selected: false }));
    if (!selectedSiteId) return;
    map.setFeatureState({ source: "candidate-sites", id: selectedSiteId }, { selected: true });
    const site = sites.find((entry) => entry.id === selectedSiteId);
    if (site) {
      map.easeTo({ center: [site.lng, site.lat], zoom: Math.max(map.getZoom(), 10.2), duration: 900 });
    }
  }, [selectedSiteId, sites]);

  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-0 map-grid-bg" />
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}

function hydrateStateCollections(base: FeatureCollection<Geometry>, states: StateMacro[], language: Language) {
  const byCode = new Map(states.map((state) => [state.state_code, state]));
  const polygonFeatures: FeatureCollection<Geometry> = {
    type: "FeatureCollection",
    features: base.features.map((feature) => {
      const fips = (feature.id != null ? String(feature.id) : null) ?? (feature.properties as { STATEFP?: string } | null)?.STATEFP ?? null;
      const stateCode = fips ? fipsToUsps(fips) : null;
      const macro = stateCode ? byCode.get(stateCode) : undefined;
      return {
        ...feature,
        id: fips ? Number(fips) : feature.id,
        properties: {
          ...(feature.properties ?? {}),
          state_code: stateCode,
          state_name_en: macro?.state_name_en ?? (feature.properties as { name?: string } | null)?.name ?? null,
          state_name_he: macro?.state_name_he ?? (feature.properties as { name?: string } | null)?.name ?? null,
          macro_total_score: macro?.macro_total_score ?? null,
          recommended_label: macro?.recommended_label ?? null,
          fill_color: macro ? colorForScore(macro.macro_total_score) : "#0f1626",
        },
      };
    }),
  };

  const labelFeatures: FeatureCollection<Geometry> = {
    type: "FeatureCollection",
    features: polygonFeatures.features
      .map((feature) => {
        const labelPoint = labelPointForFeature(feature);
        if (!labelPoint) return null;
        const stateCode = (feature.properties as { state_code?: string } | null)?.state_code ?? null;
        const macro = stateCode ? byCode.get(stateCode) : undefined;
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: labelPoint },
          properties: {
            state_code: stateCode,
            label: macro ? localizeStateName(macro, language) : (feature.properties as { name?: string } | null)?.name ?? "",
          },
        } as Feature<Geometry>;
      })
      .filter((feature): feature is Feature<Geometry> => Boolean(feature)),
  };

  return { polygonFeatures, labelFeatures };
}

function emptyFc(): FeatureCollection<Geometry> {
  return { type: "FeatureCollection", features: [] };
}

function bboxOfFeature(feature: Feature<Geometry>): [[number, number], [number, number]] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const applyRing = (ring: number[][]) => {
    for (const [lng, lat] of ring) {
      minX = Math.min(minX, lng);
      minY = Math.min(minY, lat);
      maxX = Math.max(maxX, lng);
      maxY = Math.max(maxY, lat);
    }
  };
  const geometry = feature.geometry;
  if (!geometry) return null;
  if (geometry.type === "Polygon") geometry.coordinates.forEach(applyRing);
  else if (geometry.type === "MultiPolygon") geometry.coordinates.forEach((polygon) => polygon.forEach(applyRing));
  else return null;
  if (!Number.isFinite(minX)) return null;
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

function labelPointForFeature(feature: Feature<Geometry>): [number, number] | null {
  let x = 0;
  let y = 0;
  let count = 0;
  const addRing = (ring: number[][]) => {
    ring.forEach(([lng, lat]) => {
      x += lng;
      y += lat;
      count += 1;
    });
  };
  const geometry = feature.geometry;
  if (!geometry) return null;
  if (geometry.type === "Polygon") geometry.coordinates.forEach(addRing);
  else if (geometry.type === "MultiPolygon") geometry.coordinates.forEach((polygon) => polygon.forEach(addRing));
  else return null;
  if (!count) return null;
  return [x / count, y / count];
}

function boundsForSites(sites: CandidateSite[]): [[number, number], [number, number]] | null {
  if (!sites.length) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  sites.forEach((site) => {
    minLng = Math.min(minLng, site.lng);
    minLat = Math.min(minLat, site.lat);
    maxLng = Math.max(maxLng, site.lng);
    maxLat = Math.max(maxLat, site.lat);
  });
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

function buildStyle(): StyleSpecification {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key && key.trim() !== "") {
    return `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${encodeURIComponent(key)}` as unknown as StyleSpecification;
  }
  return {
    version: 8,
    name: "solar-dark-fallback",
    sources: {},
    layers: [{ id: "bg", type: "background", paint: { "background-color": "#070a10" } }],
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  };
}
