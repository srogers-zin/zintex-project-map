"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import Supercluster from "supercluster";
import type { ProjectPin } from "@/lib/types";
import type { MapCommand } from "@/lib/filters";
import { OSM_STYLE, DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/map-style";

interface MapViewProps {
  pins: ProjectPin[];
  selectedId: string | null;
  command: MapCommand;
  onSelect: (id: string) => void;
  // Fires (without recentering the map) the first time a has-photos pin comes
  // into view at AUTO_OPEN_MIN_ZOOM or closer, so the modal pops without a
  // click. Suppressed while a modal is already open, so it can't yank the
  // user away from something they're already looking at.
  onAutoOpen: (id: string) => void;
  suppressAutoOpen: boolean;
}

// GeoJSON feature properties we carry through Supercluster.
type PinProps = { pinId: string; hasPhotos: boolean };

// Zoom level at which "zoomed into a location" kicks in for auto-open.
// Lower = triggers with less zooming in. MapLibre zoom levels roughly:
// 10 = metro area, 12 = city/neighborhood, 14 = street/block, 16 = building.
const AUTO_OPEN_MIN_ZOOM = 11;

export function MapView({ pins, selectedId, command, onSelect, onAutoOpen, suppressAutoOpen }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const clusterRef = useRef<Supercluster<PinProps> | null>(null);
  const readyRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onAutoOpenRef = useRef(onAutoOpen);
  onAutoOpenRef.current = onAutoOpen;
  const suppressAutoOpenRef = useRef(suppressAutoOpen);
  suppressAutoOpenRef.current = suppressAutoOpen;
  // Pins we've already auto-opened once this session, so scrolling back past
  // the same project doesn't keep popping it again.
  const autoOpenedRef = useRef<Set<string>>(new Set());
  // Always-current pins, so the map `load` handler (which is attached during the
  // first render, when pins is still []) rebuilds the index from live data.
  const pinsRef = useRef(pins);
  pinsRef.current = pins;

  // --- init map once ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "top-right");

    // Keep the canvas sized to its flex container. MapLibre only tracks window
    // resizes by default, so container-driven layout changes need this.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    map.on("load", () => {
      map.resize();
      map.addSource("pins", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Cluster bubbles.
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "pins",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#1f6feb",
          "circle-opacity": 0.85,
          "circle-radius": ["step", ["get", "point_count"], 16, 25, 22, 100, 30, 750, 40],
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "pins",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
        },
        paint: { "text-color": "#ffffff" },
      });

      // Individual project points.
      map.addLayer({
        id: "unclustered",
        type: "circle",
        source: "pins",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["case", ["get", "hasPhotos"], "#16a34a", "#94a3b8"],
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      // Selected point highlight.
      map.addLayer({
        id: "selected",
        type: "circle",
        source: "pins",
        filter: ["==", ["get", "pinId"], "__none__"],
        paint: {
          "circle-color": "#f59e0b",
          "circle-radius": 10,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("click", "clusters", (e) => {
        const feat = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
        const clusterId = feat?.properties?.cluster_id;
        const cluster = clusterRef.current;
        if (clusterId == null || !cluster) return;
        const zoom = cluster.getClusterExpansionZoom(clusterId);
        const [lng, lat] = (feat.geometry as GeoJSON.Point).coordinates;
        map.easeTo({ center: [lng, lat], zoom: Math.min(zoom, 16) });
      });
      map.on("click", "unclustered", (e) => {
        const feat = e.features?.[0];
        const pinId = feat?.properties?.pinId as string | undefined;
        if (pinId) onSelectRef.current(pinId);
      });
      for (const layer of ["clusters", "unclustered"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }

      map.on("moveend", render);
      readyRef.current = true;
      rebuildIndex();
      render();
    });

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild the Supercluster index whenever the pin set changes.
  function rebuildIndex() {
    const index = new Supercluster<PinProps>({ radius: 60, maxZoom: 16 });
    index.load(
      pinsRef.current.map((p) => ({
        type: "Feature" as const,
        properties: { pinId: p.id, hasPhotos: p.hasPhotos },
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      })),
    );
    clusterRef.current = index;
  }

  // Query clusters for the current viewport and push to the GeoJSON source.
  function render() {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster || !readyRef.current) return;
    const b = map.getBounds();
    const bbox: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth(),
    ];
    const zoom = Math.round(map.getZoom());
    const features = cluster.getClusters(bbox, zoom);
    const src = map.getSource("pins") as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features });

    // Auto-open: once zoomed in past AUTO_OPEN_MIN_ZOOM, the first has-photos
    // pin visible in the viewport that we haven't already shown pops its
    // modal without needing a click. Only one at a time, and never while a
    // modal is already up.
    if (!suppressAutoOpenRef.current && map.getZoom() >= AUTO_OPEN_MIN_ZOOM) {
      for (const f of features) {
        const props = f.properties as (Partial<PinProps> & { cluster?: boolean }) | null;
        if (!props || props.cluster) continue; // skip cluster bubbles, only individual pins
        if (props.hasPhotos && props.pinId && !autoOpenedRef.current.has(props.pinId)) {
          autoOpenedRef.current.add(props.pinId);
          onAutoOpenRef.current(props.pinId);
          break;
        }
      }
    }
  }

  // Re-index + re-render when pins change.
  useEffect(() => {
    if (!readyRef.current) return;
    rebuildIndex();
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins]);

  // Highlight the selected pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("selected")) return;
    map.setFilter("selected", ["==", ["get", "pinId"], selectedId ?? "__none__"]);
  }, [selectedId]);

  // Handle imperative commands (flyTo / fitPins).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !command) return;
    if (command.kind === "flyTo") {
      map.flyTo({ center: command.center, zoom: command.zoom });
    } else if (command.kind === "fitPins") {
      if (pins.length === 0) return;
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      for (const p of pins) {
        minLng = Math.min(minLng, p.lng);
        minLat = Math.min(minLat, p.lat);
        maxLng = Math.max(maxLng, p.lng);
        maxLat = Math.max(maxLat, p.lat);
      }
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, maxZoom: 13 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  return <div ref={containerRef} className="h-full w-full" />;
}
