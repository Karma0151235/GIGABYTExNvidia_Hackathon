"use client";

import { useEffect, useRef } from "react";
import maplibregl, {
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
} from "maplibre-gl";
import { LocateFixed, MapPinned, Radar } from "lucide-react";
import type { RiskAssessment, Signal, SignalCluster } from "../types";

type Props = {
  clusters: SignalCluster[];
  signals?: Signal[];
  risks?: RiskAssessment[];
  selectedId?: string;
  onSelect: (id: string) => void;
};

const riskColor = (level: RiskAssessment["level"]) =>
  level === "critical" ? "#dc2626" : level === "high" ? "#ea580c" : level === "medium" ? "#9333ea" : "#64748b";

const severityColor = (severity: number) =>
  severity >= 90 ? "#dc2626" : severity >= 80 ? "#f59e0b" : "#0891b2";

export default function SignalFusionMap({ clusters, signals = [], risks = [], selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const clustersRef = useRef(clusters);
  const risksRef = useRef(risks);
  const signalsRef = useRef(signals);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);

  clustersRef.current = clusters;
  risksRef.current = risks;
  signalsRef.current = signals;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [101.706, 3.154],
      zoom: 12.7,
      maxZoom: 18.5,
      attributionControl: false,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
          },
        },
        layers: [{
          id: "osm",
          type: "raster",
          source: "osm",
          paint: {
            "raster-saturation": -0.82,
            "raster-contrast": 0.06,
            "raster-brightness-min": 0.22,
            "raster-brightness-max": 0.94,
          },
        }],
      },
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      addOracleLayers(map);
      addEvidenceLayers(map);
      addFusionLayers(map);
      updateFusionSource(map, clustersRef.current, selectedRef.current);
      updateOracleSource(map, risksRef.current);
      updateEvidenceSource(map, signalsRef.current);
      fitClusters(map, clustersRef.current);
    });
    map.on("click", "fusion-cluster-core", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (id) onSelectRef.current(String(id));
    });
    map.on("mouseenter", "fusion-cluster-core", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "fusion-cluster-core", () => {
      map.getCanvas().style.cursor = "";
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    updateFusionSource(map, clusters, selectedId);
    updateOracleSource(map, risks);
    updateEvidenceSource(map, signals);
  }, [clusters, signals, risks, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    const selected = clusters.find((cluster) => cluster.id === selectedId);
    if (!map?.isStyleLoaded() || !selected) return;
    map.flyTo({
      center: [selected.longitude, selected.latitude],
      zoom: Math.max(map.getZoom(), 14),
      duration: 850,
    });
  }, [clusters, selectedId]);

  const refit = () => {
    const map = mapRef.current;
    if (map) fitClusters(map, clusters);
  };

  return (
    <div className="sf-map relative h-full min-h-[350px] overflow-hidden rounded-2xl border border-slate-300 bg-slate-900 shadow-inner">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(14,165,233,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.035)_1px,transparent_1px)] bg-[size:36px_36px]" />
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-xl border border-white/15 bg-slate-950/85 px-3 py-2 text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-200 shadow-xl backdrop-blur-xl">
        <Radar size={13} className="animate-pulse" />
        Predictive correlation / Greater KL
      </div>
      <button
        type="button"
        onClick={refit}
        className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-slate-950/85 text-slate-200 shadow-xl backdrop-blur-xl transition hover:text-cyan-300"
        title="Fit all clusters"
      >
        <LocateFixed size={15} />
      </button>
      <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-3 rounded-xl border border-white/15 bg-slate-950/85 px-3 py-2 text-[8px] font-bold uppercase tracking-wider text-slate-400 shadow-xl backdrop-blur-xl">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />Critical</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />High</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-500" />Observed</span>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 hidden items-center gap-2 rounded-xl border border-white/15 bg-slate-950/85 px-3 py-2 text-[8px] font-bold uppercase tracking-wider text-slate-400 shadow-xl backdrop-blur-xl sm:flex">
        <MapPinned size={12} className="text-cyan-300" />
        {signals.length} retained signals / {clusters.length} operational cluster
      </div>
    </div>
  );
}

function addOracleLayers(map: MapLibreMap) {
  map.addSource("oracleRisks", { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "oracle-zone-fill",
    type: "circle",
    source: "oracleRisks",
    paint: {
      // ~3 km watch radius, scaled by zoom
      "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 10, 24, 13, 190, 16, 1500],
      "circle-color": ["get", "color"],
      "circle-opacity": 0.1,
    },
  });
  map.addLayer({
    id: "oracle-zone-ring",
    type: "circle",
    source: "oracleRisks",
    paint: {
      "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 10, 24, 13, 190, 16, 1500],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": 1.6,
      "circle-stroke-opacity": 0.55,
    },
  });
  map.addLayer({
    id: "oracle-zone-label",
    type: "symbol",
    source: "oracleRisks",
    layout: {
      "text-field": ["get", "label"],
      "text-size": 10,
      "text-offset": [0, -1.2],
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": ["get", "color"],
      "text-halo-color": "#ffffff",
      "text-halo-width": 2,
    },
  });
}

function updateOracleSource(map: MapLibreMap, risks: RiskAssessment[]) {
  const source = map.getSource("oracleRisks") as GeoJSONSource | undefined;
  source?.setData({
    type: "FeatureCollection",
    features: risks.map((risk) => ({
      type: "Feature",
      properties: {
        id: risk.id,
        label: `ORACLE / ${risk.zone.toUpperCase()}`,
        color: riskColor(risk.level),
      },
      geometry: { type: "Point", coordinates: [risk.longitude, risk.latitude] },
    })),
  });
}

const evidenceColor: Record<Signal["source"], string> = {
  WEATHER: "#0284c7",
  TRAFFIC: "#d97706",
  CCTV: "#475569",
  CALL: "#dc2626",
  FIELD: "#047857",
  RADIO: "#0f766e",
  SMS: "#7c3aed",
  APP: "#4f46e5",
};

const evidenceCode: Record<Signal["source"], string> = {
  WEATHER: "W",
  TRAFFIC: "T",
  CCTV: "C",
  CALL: "9",
  FIELD: "F",
  RADIO: "R",
  SMS: "S",
  APP: "A",
};

function addEvidenceLayers(map: MapLibreMap) {
  map.addSource("fusionSignals", { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "signal-halo",
    type: "circle",
    source: "fusionSignals",
    paint: {
      "circle-radius": ["case", ["==", ["get", "role"], "primary_report"], 13, 10],
      "circle-color": ["get", "color"],
      "circle-opacity": 0.12,
      "circle-blur": 0.3,
    },
  });
  map.addLayer({
    id: "signal-core",
    type: "circle",
    source: "fusionSignals",
    paint: {
      "circle-radius": ["case", ["==", ["get", "role"], "primary_report"], 7, 5],
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: "signal-code",
    type: "symbol",
    source: "fusionSignals",
    layout: {
      "text-field": ["get", "code"],
      "text-size": 8,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#ffffff" },
  });
}

function updateEvidenceSource(map: MapLibreMap, signals: Signal[]) {
  const source = map.getSource("fusionSignals") as GeoJSONSource | undefined;
  source?.setData({
    type: "FeatureCollection",
    features: signals.map((signal) => ({
      type: "Feature",
      properties: {
        id: signal.id,
        source: signal.source,
        role: signal.evidence_role,
        color: evidenceColor[signal.source],
        code: evidenceCode[signal.source],
      },
      geometry: { type: "Point", coordinates: [signal.longitude, signal.latitude] },
    })),
  });
}

function addFusionLayers(map: MapLibreMap) {
  map.addSource("fusionClusters", { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "fusion-heat",
    type: "heatmap",
    source: "fusionClusters",
    maxzoom: 16,
    paint: {
      "heatmap-weight": ["get", "weight"],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.7, 15, 1.35],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 28, 15, 62],
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.72, 16, 0.18],
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0,
        "rgba(8,145,178,0)",
        0.18,
        "rgba(34,211,238,0.35)",
        0.42,
        "rgba(250,204,21,0.52)",
        0.68,
        "rgba(249,115,22,0.68)",
        1,
        "rgba(220,38,38,0.82)",
      ],
    },
  });
  map.addLayer({
    id: "fusion-cluster-glow",
    type: "circle",
    source: "fusionClusters",
    paint: {
      "circle-radius": [
        "case",
        ["get", "selected"],
        30,
        ["interpolate", ["linear"], ["get", "signals"], 1, 16, 10, 25],
      ],
      "circle-color": ["get", "color"],
      "circle-opacity": ["case", ["get", "selected"], 0.23, 0.12],
      "circle-blur": 0.5,
    },
  });
  map.addLayer({
    id: "fusion-cluster-ring",
    type: "circle",
    source: "fusionClusters",
    paint: {
      "circle-radius": [
        "case",
        ["get", "selected"],
        15,
        ["interpolate", ["linear"], ["get", "signals"], 1, 9, 10, 13],
      ],
      "circle-color": "rgba(255,255,255,0)",
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": ["case", ["get", "selected"], 4, 2],
      "circle-stroke-opacity": 0.85,
    },
  });
  map.addLayer({
    id: "fusion-cluster-core",
    type: "circle",
    source: "fusionClusters",
    paint: {
      "circle-radius": ["case", ["get", "selected"], 9, 7],
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  });
  map.addLayer({
    id: "fusion-cluster-count",
    type: "symbol",
    source: "fusionClusters",
    layout: {
      "text-field": ["to-string", ["get", "signals"]],
      "text-size": 10,
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": ["get", "color"],
      "text-halo-width": 1,
    },
  });
  map.addLayer({
    id: "fusion-cluster-label",
    type: "symbol",
    source: "fusionClusters",
    minzoom: 12,
    layout: {
      "text-field": ["get", "label"],
      "text-size": ["case", ["get", "selected"], 12, 10],
      "text-offset": [0, 1.8],
      "text-anchor": "top",
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#0f172a",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2,
    },
  });
}

function updateFusionSource(
  map: MapLibreMap,
  clusters: SignalCluster[],
  selectedId?: string,
) {
  const source = map.getSource("fusionClusters") as GeoJSONSource | undefined;
  source?.setData({
    type: "FeatureCollection",
    features: clusters
      .filter((cluster) => cluster.status !== "dismissed")
      .map((cluster) => ({
        type: "Feature",
        properties: {
          id: cluster.id,
          label: `${cluster.priority ?? "--"} / ${cluster.confidence}% / ${cluster.signal_count} signals`,
          signals: cluster.signal_count,
          confidence: cluster.confidence,
          weight: Math.min(1, cluster.severity / 120 + cluster.signal_count / 40),
          color: severityColor(cluster.severity),
          selected: cluster.id === selectedId,
        },
        geometry: {
          type: "Point",
          coordinates: [cluster.longitude, cluster.latitude],
        },
      })),
  });
}

function fitClusters(map: MapLibreMap, clusters: SignalCluster[]) {
  const active = clusters.filter((cluster) => cluster.status !== "dismissed");
  if (active.length === 0) return;
  const bounds = new LngLatBounds();
  active.forEach((cluster) => bounds.extend([cluster.longitude, cluster.latitude]));
  map.fitBounds(bounds, { padding: 74, maxZoom: 14.2, duration: 850 });
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
