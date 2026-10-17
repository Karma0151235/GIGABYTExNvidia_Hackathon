"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
} from "maplibre-gl";
import {
  ambulances as mockAmbulances,
  hospitals as mockHospitals,
  incidents as mockIncidents,
  klCenter,
  responseRoutes as mockResponseRoutes,
} from "@/lib/emergencyData";
import type {
  AmbulanceUnit,
  Coordinate,
  Incident,
  ResponseRoute,
} from "@/types/emergency";
import type { RoutingStatus } from "@/modules/live-dispatch/types";
import {
  Ambulance,
  Clock3,
  Crosshair,
  Layers,
  LoaderCircle,
  MapPin,
  Navigation2,
  RefreshCw,
  Route,
  Target,
  Wifi,
  WifiOff,
  ZoomIn,
} from "lucide-react";

type Props = {
  routes?: ResponseRoute[];
  incidentsData?: Incident[];
  unitsData?: AmbulanceUnit[];
  hospitalsData?: import("@/types/emergency").Hospital[];
  routingStatus?: RoutingStatus;
  routingError?: string | null;
  onRetryRouting?: () => void;
  selectedIncidentId?: string;
  selectedUnitId?: string;
  selectedRouteId?: string;
  onSelectIncident: (id: string) => void;
  onSelectUnit: (id: string) => void;
  onSelectRoute: (id: string) => void;
  compact?: boolean;
};

type LayerKey =
  | "ambulances"
  | "incidents"
  | "hospitals"
  | "routes"
  | "heatmap"
  | "coverage"
  | "traffic";

const layerIdsByKey: Record<LayerKey, string[]> = {
  ambulances: ["ambulance-halo", "ambulance-icons", "ambulance-labels"],
  incidents: ["incident-pulse", "incident-ring", "incident-circles", "incident-symbols", "incident-labels"],
  hospitals: ["hospital-halo", "hospital-circles", "hospital-symbols", "hospital-labels"],
  routes: [
    "route-glow",
    "route-casing",
    "response-route-line",
    "route-direction-arrows",
    "animated-response-route-line",
    "route-vehicle-icons",
    "route-endpoint-halo",
    "route-endpoint-circles",
    "route-endpoint-symbols",
    "route-endpoint-labels",
  ],
  heatmap: ["demand-heatmap"],
  coverage: ["coverage-fill", "coverage-outline"],
  traffic: ["traffic-overlay"],
};

const statusColor: Record<AmbulanceUnit["status"], string> = {
  Available: "#10b981",
  "En route": "#2563eb",
  "On scene": "#f59e0b",
  Transporting: "#7c3aed",
  "At hospital": "#14b8a6",
  Offline: "#94a3b8",
};

const severityColor: Record<Incident["severity"], string> = {
  Critical: "#991b1b",
  High: "#dc2626",
  Medium: "#f59e0b",
  Low: "#64748b",
};

export default function DispatchMap({
  routes = mockResponseRoutes,
  incidentsData = mockIncidents,
  unitsData = mockAmbulances,
  hospitalsData = mockHospitals,
  routingStatus,
  routingError,
  onRetryRouting,
  selectedIncidentId,
  selectedUnitId,
  selectedRouteId,
  onSelectIncident,
  onSelectUnit,
  onSelectRoute,
  compact = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const selectedIncidentRef = useRef<string | undefined>(selectedIncidentId);
  const selectedUnitRef = useRef<string | undefined>(selectedUnitId);
  const selectedRouteRef = useRef<string | undefined>(selectedRouteId);
  const onSelectIncidentRef = useRef(onSelectIncident);
  const onSelectUnitRef = useRef(onSelectUnit);
  const onSelectRouteRef = useRef(onSelectRoute);
  const lastFocusedRouteRef = useRef<string | undefined>(undefined);
  const routesRef = useRef(routes);
  const incidentsRef = useRef(incidentsData);
  const unitsRef = useRef(unitsData);
  const hospitalsRef = useRef(hospitalsData);
  const [layersOpen, setLayersOpen] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    ambulances: true,
    incidents: true,
    hospitals: true,
    routes: true,
    heatmap: true,
    coverage: true,
    traffic: false,
  });

  const selectedIncident = useMemo(
    () => incidentsData.find((incident) => incident.id === selectedIncidentId),
    [incidentsData, selectedIncidentId],
  );
  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId),
    [routes, selectedRouteId],
  );
  const selectedUnit = useMemo(
    () => unitsData.find((unit) => unit.id === selectedRoute?.unitId),
    [selectedRoute?.unitId, unitsData],
  );

  useEffect(() => {
    selectedIncidentRef.current = selectedIncidentId;
    selectedUnitRef.current = selectedUnitId;
    selectedRouteRef.current = selectedRouteId;
    routesRef.current = routes;
    incidentsRef.current = incidentsData;
    unitsRef.current = unitsData;
    hospitalsRef.current = hospitalsData;
    onSelectIncidentRef.current = onSelectIncident;
    onSelectUnitRef.current = onSelectUnit;
    onSelectRouteRef.current = onSelectRoute;
  }, [hospitalsData, incidentsData, onSelectIncident, onSelectRoute, onSelectUnit, routes, selectedIncidentId, selectedRouteId, selectedUnitId, unitsData]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: klCenter,
      zoom: compact ? 11.5 : 12.2,
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
            attribution: "OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
            paint: {
              "raster-saturation": -0.82,
              "raster-contrast": 0.04,
              "raster-brightness-min": 0.12,
              "raster-brightness-max": 0.88,
            },
          },
        ],
      },
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    mapRef.current = map;

    map.on("load", () => {
      addSourcesAndLayers(map);
      updateStaticSources(
        map,
        routesRef.current,
        incidentsRef.current,
        unitsRef.current,
        hospitalsRef.current,
        selectedIncidentRef.current,
        selectedUnitRef.current,
        selectedRouteRef.current,
      );
      updateAnimatedSources(
        map,
        routesRef.current,
        progressRef.current,
        selectedIncidentRef.current,
        selectedRouteRef.current,
      );
      attachSelectionHandlers(
        map,
        (id) => onSelectIncidentRef.current(id),
        (id) => onSelectUnitRef.current(id),
        (id) => onSelectRouteRef.current(id),
      );
    });

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, [compact]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    updateStaticSources(map, routes, incidentsData, unitsData, hospitalsData, selectedIncidentId, selectedUnitId, selectedRouteId);
    updateAnimatedSources(map, routes, progressRef.current, selectedIncidentId, selectedRouteId);
  }, [hospitalsData, incidentsData, routes, selectedIncidentId, selectedRouteId, selectedUnitId, unitsData]);

  useEffect(() => {
    if (compact || !selectedRouteId) {
      if (!selectedRouteId) lastFocusedRouteRef.current = undefined;
      return;
    }
    const map = mapRef.current;
    const route = routes.find((item) => item.id === selectedRouteId);
    if (!map?.isStyleLoaded() || !route) return;
    const first=route.coordinates[0];
    const last=route.coordinates[route.coordinates.length-1];
    const focusKey=`${route.id}:${route.coordinates.length}:${first?.join(",")}:${last?.join(",")}`;
    if (lastFocusedRouteRef.current === focusKey) return;
    lastFocusedRouteRef.current = focusKey;

    const bounds = new LngLatBounds();
    route.coordinates.forEach((coordinate) => bounds.extend(coordinate));
    map.fitBounds(bounds, {
      padding: { top: 110, right: 340, bottom: 150, left: 80 },
      maxZoom: 14.4,
      duration: 900,
    });
  }, [compact, routes, selectedRouteId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    for (const [key, visible] of Object.entries(layers) as Array<[LayerKey, boolean]>) {
      for (const layerId of layerIdsByKey[key]) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
        }
      }
    }
  }, [layers]);

  useEffect(() => {
    const tick = (timestamp: number) => {
      const map = mapRef.current;
      const last = lastFrameRef.current ?? timestamp;
      const delta = timestamp - last;
      lastFrameRef.current = timestamp;
      progressRef.current = (progressRef.current + delta / 30000) % 1;

      if (map?.isStyleLoaded()) {
        // Keep route motion outside React so live data updates do not reset the map.
        // so React does not rerender on every animation frame.
        updateAnimatedSources(map, routes, progressRef.current, selectedIncidentId, selectedRouteId);
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      lastFrameRef.current = null;
    };
  }, [routes, selectedIncidentId, selectedRouteId]);

  const fitActiveIncidents = () => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = new LngLatBounds();
    incidentsData.slice(0, 12).forEach((incident) => bounds.extend(incident.coordinate));
    map.fitBounds(bounds, { padding: 80, duration: 650 });
  };

  const fitSelectedRoute = () => {
    const map = mapRef.current;
    const route = routes.find((item) => item.id === selectedRouteId);
    if (!map || !route) return;
    const bounds = new LngLatBounds();
    route.coordinates.forEach((coordinate) => bounds.extend(coordinate));
    map.fitBounds(bounds, { padding: 90, duration: 650 });
  };

  const resetView = () => {
    mapRef.current?.flyTo({ center: klCenter, zoom: compact ? 11.5 : 12.2, duration: 650 });
  };

  return (
    <div className={`relative h-full overflow-hidden rounded-2xl border border-slate-300/80 bg-slate-900 shadow-[0_24px_70px_rgba(15,23,42,0.18)] ${compact ? "min-h-0" : "min-h-[540px]"}`}>
      <div ref={containerRef} className="absolute inset-0" />

      {routingStatus ? <div
        className={`absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.16em] shadow-xl backdrop-blur-xl ${
          routingStatus === "online"
            ? "border-emerald-300/70 bg-emerald-950/85 text-emerald-300"
            : routingStatus === "loading"
              ? "border-cyan-300/70 bg-slate-950/85 text-cyan-300"
              : "border-red-300/70 bg-red-950/85 text-red-200"
        }`}
        title={routingError ?? "Road geometry calculated from the local OpenStreetMap graph"}
      >
        {routingStatus === "online" ? <Wifi size={14} /> : null}
        {routingStatus === "loading" ? <LoaderCircle className="animate-spin" size={14} /> : null}
        {routingStatus === "offline" ? <WifiOff size={14} /> : null}
        <span>
          {routingStatus === "online"
            ? `Local OSM / ${routes.length} road routes`
            : routingStatus === "loading"
              ? "Snapping routes to roads"
              : "Local routing offline"}
        </span>
        {routingStatus === "offline" && onRetryRouting ? (
          <button
            type="button"
            onClick={onRetryRouting}
            title="Retry local routing"
            className="ml-1 rounded-full p-0.5 transition hover:bg-white/10"
          >
            <RefreshCw size={13} />
          </button>
        ) : null}
      </div> : null}

      {!compact ? (
        <div className="absolute left-4 top-4 z-10 flex gap-2">
          <MapButton icon={Target} label="Fit incidents" onClick={fitActiveIncidents} />
          <MapButton icon={Route} label="Fit route" onClick={fitSelectedRoute} disabled={!selectedRouteId} />
          <MapButton icon={ZoomIn} label="Reset" onClick={resetView} />
        </div>
      ) : null}

      {!compact ? (
        <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
          {layersOpen ? (
            <div className="w-[230px] rounded-2xl border border-white/15 bg-slate-950/90 p-3.5 text-white shadow-2xl backdrop-blur-xl">
              <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">
                <span>Operational Layers</span>
                <span className="text-slate-500">{Object.values(layers).filter(Boolean).length}/7</span>
              </div>
              {(Object.keys(layers) as LayerKey[]).map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-xs text-slate-300 transition hover:text-white"
                >
                  <span className="capitalize">{key === "heatmap" ? "Demand Heatmap" : key}</span>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}
                    className="h-4 w-4 accent-cyan-400"
                  />
                </label>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setLayersOpen((current) => !current)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] shadow-xl backdrop-blur-xl transition ${
              layersOpen
                ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-100"
                : "border-white/15 bg-slate-950/85 text-slate-200 hover:bg-slate-900"
            }`}
          >
            <Layers size={14} />
            Layers
          </button>
        </div>
      ) : null}

      {!compact && selectedIncident && selectedRoute ? (
        <div className="absolute right-4 top-4 z-10 w-[300px] overflow-hidden rounded-2xl border border-white/15 bg-slate-950/90 text-white shadow-2xl backdrop-blur-xl">
          <div className="border-b border-white/10 bg-gradient-to-r from-red-500/15 via-transparent to-cyan-500/10 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-red-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-400 shadow-[0_0_10px_#f87171]" />
                Active Mission
              </div>
              <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-cyan-200">
                OSRM Live
              </span>
            </div>
            <div className="mt-2 text-base font-bold text-white">{selectedIncident.type}</div>
            <div className="mt-0.5 text-xs text-slate-400">
              {selectedIncident.id} / {selectedIncident.area}
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-white/10 border-b border-white/10">
            <MissionMetric icon={Clock3} label="ETA" value={`${selectedRoute.etaMinutes.toFixed(1)} min`} />
            <MissionMetric icon={Navigation2} label="Distance" value={`${selectedRoute.distanceKm.toFixed(2)} km`} />
            <MissionMetric icon={MapPin} label="Road nodes" value={String(selectedRoute.coordinates.length)} />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-300">
                <Ambulance size={17} />
              </div>
              <div>
                <div className="text-xs font-bold text-white">{selectedUnit?.id ?? selectedRoute.unitId}</div>
                <div className="text-[10px] text-slate-500">{selectedUnit?.crew ?? "Response unit"}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Route</div>
              <div className="text-[11px] font-semibold text-cyan-300">{selectedRoute.id}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MissionMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <div className="px-3 py-3">
      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
        <Icon size={11} className="text-cyan-400" />
        {label}
      </div>
      <div className="mt-1 text-xs font-bold text-white">{value}</div>
    </div>
  );
}

function MapButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Crosshair;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-slate-950/85 text-slate-200 shadow-xl backdrop-blur-xl transition hover:border-cyan-400/35 hover:bg-slate-900 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-35"
    >
      <Icon size={17} />
    </button>
  );
}

function ensureMapImages(map: MapLibreMap) {
  if (map.hasImage("ambulance-unit")) return;
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create ambulance map icon");

  context.scale(2, 2);
  context.fillStyle = "#082f49";
  context.strokeStyle = "#f8fafc";
  context.lineWidth = 1.25;
  context.beginPath();
  context.roundRect(3, 7, 15, 10, 2);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(18, 10);
  context.lineTo(21, 10);
  context.lineTo(22, 13);
  context.lineTo(22, 17);
  context.lineTo(18, 17);
  context.closePath();
  context.fillStyle = "#0e7490";
  context.fill();
  context.stroke();
  context.fillStyle = "#ffffff";
  context.fillRect(8.75, 8.5, 1.5, 5);
  context.fillRect(7, 10.25, 5, 1.5);
  context.fillStyle = "#020617";
  context.beginPath();
  context.arc(7, 18, 1.7, 0, Math.PI * 2);
  context.arc(18, 18, 1.7, 0, Math.PI * 2);
  context.fill();
  map.addImage("ambulance-unit", context.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 });
}

function addSourcesAndLayers(map: MapLibreMap) {
  ensureMapImages(map);
  map.addSource("coverageZones", { type: "geojson", data: emptyCollection() });
  map.addSource("demandHeatmapPoints", { type: "geojson", data: emptyCollection() });
  map.addSource("responseRoutes", { type: "geojson", data: emptyCollection() });
  map.addSource("routeEndpoints", { type: "geojson", data: emptyCollection() });
  map.addSource("animatedResponseRoutes", { type: "geojson", data: emptyCollection() });
  map.addSource("ambulanceFlow", { type: "geojson", data: emptyCollection() });
  map.addSource("incidents", { type: "geojson", data: emptyCollection() });
  map.addSource("ambulances", { type: "geojson", data: emptyCollection() });
  map.addSource("hospitals", { type: "geojson", data: emptyCollection() });
  map.addSource("trafficIncidents", { type: "geojson", data: emptyCollection() });

  map.addLayer({
    id: "coverage-fill",
    type: "fill",
    source: "coverageZones",
    paint: { "fill-color": "#14b8a6", "fill-opacity": 0.08 },
  });
  map.addLayer({
    id: "coverage-outline",
    type: "line",
    source: "coverageZones",
    paint: { "line-color": "#14b8a6", "line-width": 1, "line-opacity": 0.35 },
  });
  map.addLayer({
    id: "demand-heatmap",
    type: "heatmap",
    source: "demandHeatmapPoints",
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 0, 0, 10, 1],
      "heatmap-intensity": 0.9,
      "heatmap-radius": 34,
      "heatmap-opacity": 0.52,
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0,
        "rgba(255,255,255,0)",
        0.2,
        "#fef3c7",
        0.5,
        "#f59e0b",
        0.8,
        "#dc2626",
        1,
        "#991b1b",
      ],
    },
  });
  map.addLayer({
    id: "traffic-overlay",
    type: "circle",
    source: "trafficIncidents",
    layout: { visibility: "none" },
    paint: {
      "circle-color": "#f59e0b",
      "circle-radius": 18,
      "circle-opacity": 0.16,
      "circle-stroke-color": "#f59e0b",
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "route-glow",
    type: "line",
    source: "responseRoutes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["case", ["get", "selected"], "#38bdf8", ["get", "color"]],
      "line-width": ["case", ["get", "selected"], 18, 9],
      "line-opacity": ["case", ["get", "selected"], 0.34, ["get", "dim"], 0.008, 0.08],
      "line-blur": ["case", ["get", "selected"], 7, 3],
    },
  });
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "responseRoutes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["case", ["get", "selected"], "#f8fafc", "#ffffff"],
      "line-width": ["case", ["get", "selected"], 10, 5.5],
      "line-opacity": ["case", ["get", "selected"], 0.98, ["get", "dim"], 0.07, 0.68],
    },
  });
  map.addLayer({
    id: "response-route-line",
    type: "line",
    source: "responseRoutes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["case", ["get", "selected"], "#0284c7", ["get", "color"]],
      "line-width": ["case", ["get", "selected"], 6.5, 3],
      "line-opacity": ["case", ["get", "selected"], 1, ["get", "dim"], 0.1, 0.82],
    },
  });
  map.addLayer({
    id: "route-direction-arrows",
    type: "symbol",
    source: "responseRoutes",
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 92,
      "text-field": ">",
      "text-size": ["case", ["get", "selected"], 16, 12],
      "text-rotation-alignment": "map",
      "text-keep-upright": false,
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": ["case", ["get", "selected"], "#ffffff", "#f8fafc"],
      "text-halo-color": ["case", ["get", "selected"], "#0369a1", ["get", "color"]],
      "text-halo-width": 2,
      "text-opacity": ["case", ["get", "selected"], 1, ["get", "dim"], 0.04, 0.72],
    },
  });
  map.addLayer({
    id: "animated-response-route-line",
    type: "line",
    source: "animatedResponseRoutes",
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["case", ["get", "selected"], 3, 1.5],
      "line-opacity": ["case", ["get", "selected"], 0.95, ["get", "dim"], 0.04, 0.3],
      "line-blur": 0.4,
    },
  });
  map.addLayer({
    id: "route-vehicle-icons",
    type: "symbol",
    source: "ambulanceFlow",
    layout: {
      "icon-image": "ambulance-unit",
      "icon-size": ["case", ["get", "selected"], 0.98, 0.76],
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-opacity": ["case", ["get", "selected"], 1, ["get", "dim"], 0.14, 0.82],
    },
  });
  map.addLayer({
    id: "route-endpoint-halo",
    type: "circle",
    source: "routeEndpoints",
    paint: {
      "circle-radius": 18,
      "circle-color": ["get", "color"],
      "circle-opacity": 0.16,
      "circle-blur": 0.35,
    },
  });
  map.addLayer({
    id: "route-endpoint-circles",
    type: "circle",
    source: "routeEndpoints",
    paint: {
      "circle-radius": 10,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: "route-endpoint-symbols",
    type: "symbol",
    source: "routeEndpoints",
    layout: {
      "text-field": ["get", "symbol"],
      "text-size": 12,
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": ["get", "color"],
      "text-halo-width": 1,
    },
  });
  map.addLayer({
    id: "route-endpoint-labels",
    type: "symbol",
    source: "routeEndpoints",
    layout: {
      "text-field": ["get", "label"],
      "text-size": 10,
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
  map.addLayer({
    id: "incident-pulse",
    type: "circle",
    source: "incidents",
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["case", ["get", "selected"], 30, ["get", "critical"], 23, 16],
      "circle-opacity": ["case", ["get", "selected"], 0.2, 0.09],
      "circle-blur": 0.45,
    },
  });
  map.addLayer({
    id: "incident-ring",
    type: "circle",
    source: "incidents",
    paint: {
      "circle-radius": ["case", ["get", "selected"], 15, 11],
      "circle-color": "rgba(255,255,255,0)",
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": ["case", ["get", "selected"], 3, 1.5],
      "circle-stroke-opacity": 0.8,
    },
  });
  map.addLayer({
    id: "incident-circles",
    type: "circle",
    source: "incidents",
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["case", ["get", "selected"], 9, 6.5],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  });
  map.addLayer({
    id: "incident-symbols",
    type: "symbol",
    source: "incidents",
    layout: { "text-field": "!", "text-size": ["case", ["get", "selected"], 14, 11], "text-font": ["Open Sans Bold"], "text-allow-overlap": true },
    paint: { "text-color": "#ffffff" },
  });
  map.addLayer({
    id: "incident-labels",
    type: "symbol",
    source: "incidents",
    layout: {
      "text-field": ["get", "label"],
      "text-size": ["case", ["get", "selected"], 12, 10],
      "text-offset": [0, 1.8],
      "text-anchor": "top",
    },
    paint: {
      "text-color": "#450a0a",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2,
    },
  });
  map.addLayer({
    id: "hospital-halo",
    type: "circle",
    source: "hospitals",
    paint: {
      "circle-radius": ["case", ["get", "selected"], 22, 16],
      "circle-color": "#0d9488",
      "circle-opacity": ["case", ["get", "selected"], 0.18, 0.08],
      "circle-blur": 0.35,
    },
  });
  map.addLayer({
    id: "hospital-circles",
    type: "circle",
    source: "hospitals",
    paint: {
      "circle-color": "#14b8a6",
      "circle-radius": ["case", ["get", "selected"], 13, 9],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: "hospital-symbols",
    type: "symbol",
    source: "hospitals",
    layout: {
      "text-field": "+",
      "text-size": ["case", ["get", "selected"], 17, 14],
      "text-font": ["Open Sans Bold"],
      "text-anchor": "center",
    },
    paint: { "text-color": "#ffffff" },
  });
  map.addLayer({
    id: "hospital-labels",
    type: "symbol",
    source: "hospitals",
    minzoom: 11,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 10,
      "text-offset": [0, 1.8],
      "text-anchor": "top",
    },
    paint: {
      "text-color": "#0f766e",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2,
    },
  });
  map.addLayer({
    id: "ambulance-halo",
    type: "circle",
    source: "ambulances",
    paint: {
      "circle-radius": ["case", ["get", "selected"], 19, 13],
      "circle-color": ["get", "color"],
      "circle-opacity": ["case", ["get", "selected"], 0.2, 0.09],
      "circle-blur": 0.3,
    },
  });
  map.addLayer({
    id: "ambulance-icons",
    type: "symbol",
    source: "ambulances",
    layout: {
      "icon-image": "ambulance-unit",
      "icon-size": ["case", ["get", "selected"], 0.94, 0.74],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-opacity": ["case", ["get", "selected"], 1, 0.9],
    },
  });
  map.addLayer({
    id: "ambulance-labels",
    type: "symbol",
    source: "ambulances",
    layout: {
      "text-field": ["case", ["get", "selected"], ["get", "label"], ""],
      "text-size": ["case", ["get", "selected"], 11, 9],
      "text-offset": [0, -2.1],
      "text-anchor": "bottom",
    },
    paint: {
      "text-color": "#1e3a8a",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2,
    },
  });
}

function updateStaticSources(
  map: MapLibreMap,
  routes: ResponseRoute[],
  operationalIncidents: Incident[],
  operationalUnits: AmbulanceUnit[],
  operationalHospitals: import("@/types/emergency").Hospital[],
  selectedIncidentId?: string,
  selectedUnitId?: string,
  selectedRouteId?: string,
) {
  setSourceData(map, "coverageZones", {
    type: "FeatureCollection",
    features: operationalHospitals.map((hospital) => ({
      type: "Feature",
      properties: { id: hospital.id },
      geometry: circlePolygon(hospital.coordinate, 0.028),
    })),
  });
  setSourceData(map, "demandHeatmapPoints", {
    type: "FeatureCollection",
    features: operationalIncidents.map((incident) => ({
      type: "Feature",
      properties: { weight: incident.severity === "Critical" ? 10 : incident.severity === "High" ? 7 : 4 },
      geometry: { type: "Point", coordinates: incident.coordinate },
    })),
  });
  setSourceData(map, "trafficIncidents", {
    type: "FeatureCollection",
    features: routes.slice(0, 5).map((route) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: route.coordinates[Math.floor(route.coordinates.length / 2)] },
    })),
  });
  setSourceData(map, "responseRoutes", routesToFeatures(routes, selectedRouteId, selectedIncidentId));
  const activeRoute = routes.find((route) => route.id === selectedRouteId);
  const hospitalLeg = activeRoute?.leg === "to_hospital";
  setSourceData(map, "routeEndpoints", {
    type: "FeatureCollection",
    features: activeRoute
      ? [
          {
            type: "Feature",
            properties: {
              id: activeRoute.unitId,
              kind: "origin",
              label: hospitalLeg ? `${activeRoute.incidentId} / SCENE` : `${activeRoute.unitId} / ORIGIN`,
              symbol: hospitalLeg ? "!" : "A",
              color: hospitalLeg ? "#dc2626" : "#0284c7",
            },
            geometry: { type: "Point", coordinates: activeRoute.coordinates[0] },
          },
          {
            type: "Feature",
            properties: {
              id: hospitalLeg ? activeRoute.hospitalId : activeRoute.incidentId,
              kind: "destination",
              label: hospitalLeg ? `${activeRoute.hospitalId} / HOSPITAL` : `${activeRoute.incidentId} / SCENE`,
              symbol: hospitalLeg ? "+" : "!",
              color: hospitalLeg ? "#0d9488" : "#dc2626",
            },
            geometry: {
              type: "Point",
              coordinates: activeRoute.coordinates[activeRoute.coordinates.length - 1],
            },
          },
        ]
      : [],
  });
  setSourceData(map, "incidents", {
    type: "FeatureCollection",
    features: operationalIncidents.map((incident) => ({
      type: "Feature",
      properties: {
        id: incident.id,
        label: incident.severity === "Critical" ? "Critical" : incident.id,
        color: severityColor[incident.severity],
        critical: incident.severity === "Critical",
        selected: incident.id === selectedIncidentId,
      },
      geometry: { type: "Point", coordinates: incident.coordinate },
    })),
  });
  setSourceData(map, "hospitals", {
    type: "FeatureCollection",
    features: operationalHospitals.map((hospital) => ({
      type: "Feature",
      properties: {
        id: hospital.id,
        name: hospital.name,
        selected: routes.some((route) => route.hospitalId === hospital.id && route.id === selectedRouteId),
      },
      geometry: { type: "Point", coordinates: hospital.coordinate },
    })),
  });
  setSourceData(map, "ambulances", {
    type: "FeatureCollection",
    features: operationalUnits.filter((unit) => !unit.assignedIncidentId).map((unit) => ({
      type: "Feature",
      properties: {
        id: unit.id,
        label: unit.id,
        color: statusColor[unit.status],
        selected: unit.id === selectedUnitId,
      },
      geometry: { type: "Point", coordinates: unit.coordinate },
    })),
  });
}

function updateAnimatedSources(
  map: MapLibreMap,
  routes: ResponseRoute[],
  progress: number,
  selectedIncidentId?: string,
  selectedRouteId?: string,
) {
  setSourceData(map, "animatedResponseRoutes", {
    type: "FeatureCollection",
    features: routes.map((route, index) => {
      const selected = route.id === selectedRouteId || route.incidentId === selectedIncidentId;
      return {
        type: "Feature",
        properties: {
          id: route.id,
          color: route.color,
          selected,
          dim: Boolean((selectedRouteId || selectedIncidentId) && !selected),
        },
        geometry: {
          type: "LineString",
          coordinates: partialLine(route.coordinates, Math.min(1, progress * 1.25 + index * 0.02)),
        },
      };
    }),
  });

  setSourceData(map, "ambulanceFlow", {
    type: "FeatureCollection",
    features: routes.filter((route) => route.leg !== "to_hospital").map((route, routeIndex) => {
      const selected = route.id === selectedRouteId || route.incidentId === selectedIncidentId;
      const position = pointAndBearingAlongLine(
        route.coordinates,
        (progress + routeIndex * 0.045) % 1,
      );
      return {
        type: "Feature",
        properties: {
          id: `${route.id}-vehicle`,
          routeId: route.id,
          unitId: route.unitId,
          selected,
          dim: Boolean((selectedRouteId || selectedIncidentId) && !selected),
          bearing: position.bearing,
        },
        geometry: {
          type: "Point",
          coordinates: position.coordinate,
        },
      };
    }),
  });
}

function attachSelectionHandlers(
  map: MapLibreMap,
  onSelectIncident: (id: string) => void,
  onSelectUnit: (id: string) => void,
  onSelectRoute: (id: string) => void,
) {
  ["incident-pulse", "incident-ring", "incident-circles"].forEach((layerId) => {
    map.on("click", layerId, (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (id) onSelectIncident(String(id));
    });
  });
  map.on("click", "ambulance-icons", (event) => {
    const id = event.features?.[0]?.properties?.id;
    if (id) onSelectUnit(String(id));
  });
  map.on("click", "route-casing", (event) => {
    const id = event.features?.[0]?.properties?.id;
    if (id) onSelectRoute(String(id));
  });
  map.on("click", "route-vehicle-icons", (event) => {
    const routeId = event.features?.[0]?.properties?.routeId;
    if (routeId) onSelectRoute(String(routeId));
  });
  ["incident-pulse", "incident-ring", "incident-circles", "ambulance-icons", "route-casing", "route-vehicle-icons"].forEach((layerId) => {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  });
}

function routesToFeatures(routes: ResponseRoute[], selectedRouteId?: string, selectedIncidentId?: string) {
  return {
    type: "FeatureCollection" as const,
    features: routes.map((route) => {
      const selected = route.id === selectedRouteId || route.incidentId === selectedIncidentId;
      return {
        type: "Feature" as const,
        properties: {
          id: route.id,
          color: route.color,
          selected,
          dim: Boolean((selectedRouteId || selectedIncidentId) && !selected),
          eta: route.etaMinutes,
          distance: route.distanceKm,
          unitId: route.unitId,
          incidentId: route.incidentId,
        },
        geometry: { type: "LineString" as const, coordinates: route.coordinates },
      };
    }),
  };
}

function setSourceData(map: MapLibreMap, sourceId: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data);
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function circlePolygon(center: Coordinate, radius: number): GeoJSON.Polygon {
  const points: Coordinate[] = [];
  for (let index = 0; index <= 64; index += 1) {
    const angle = (index / 64) * Math.PI * 2;
    points.push([
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ]);
  }
  return { type: "Polygon", coordinates: [points] };
}

function partialLine(points: Coordinate[], progress: number): Coordinate[] {
  if (points.length < 2) return points;
  const clamped = Math.max(0.02, Math.min(progress, 1));
  const targetDistance = lineDistance(points) * clamped;
  const output: Coordinate[] = [points[0]];
  let walked = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const segment = distance(start, end);
    if (walked + segment <= targetDistance) {
      output.push(end);
      walked += segment;
    } else {
      const local = (targetDistance - walked) / segment;
      output.push([
        start[0] + (end[0] - start[0]) * local,
        start[1] + (end[1] - start[1]) * local,
      ]);
      break;
    }
  }

  return output;
}

function pointAndBearingAlongLine(
  points: Coordinate[],
  progress: number,
): { coordinate: Coordinate; bearing: number } {
  const partial = partialLine(points, progress);
  const coordinate = partial[partial.length - 1] ?? points[0];
  const previous = partial[partial.length - 2] ?? points[0];
  const longitudeDelta = coordinate[0] - previous[0];
  const latitudeDelta = coordinate[1] - previous[1];
  const bearing = (Math.atan2(longitudeDelta, latitudeDelta) * 180) / Math.PI;
  return { coordinate, bearing };
}

function lineDistance(points: Coordinate[]) {
  return points.slice(0, -1).reduce((sum, point, index) => sum + distance(point, points[index + 1]), 0);
}

function distance(start: Coordinate, end: Coordinate) {
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}
