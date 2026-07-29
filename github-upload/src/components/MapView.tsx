"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { ProjectPin } from "@/lib/types";
import type { MapCommand } from "@/lib/filters";
import { OSM_STYLE, DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/map-style";

interface MapViewProps {
  pins: ProjectPin[];
  selectedId: string | null;
  command: MapCommand;
  onSelect: (id: string) => void;
}

// GeoJSON feature properties for each pin. Pins are always rendered
// individually (no clustering), so there's no cluster/point_count property.
type PinProps = { pinId: string; hasPhotos: boolean; highVolumeUntagged: boolean };

export function MapView({ pins, selectedId, command, onSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
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

      // Every project point, always rendered individually — no clustering.
      map.addLayer({
        id: "unclustered",
        type: "circle",
        source: "pins",
        paint: {
          // Blue: featured on the map (1+ tagged photo). Red: NOT on the map
          // yet, but CompanyCam shows 15+ photos for the job — a "go tag
          // this one" signal for Sales Leadership (see
          // scripts/flag-companycam-volume.ts). Grey: everything else.
          "circle-color": [
            "case",
            ["get", "hasPhotos"], "#003366",
            ["get", "highVolumeUntagged"], "#dc2626",
            "#94a3b8",
          ],
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

      map.on("click", "unclustered", (e) => {
        const feat = e.features?.[0];
        const pinId = feat?.properties?.pinId as string | undefined;
        if (pinId) onSelectRef.current(pinId);
      });
      map.on("mouseenter", "unclustered", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "unclustered", () => (map.getCanvas().style.cursor = ""));

      readyRef.current = true;
      updateSource();
    });

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push every pin to the GeoJSON source as its own point — no clustering,
  // no bbox/zoom filtering. Every pin stays individually visible and
  // clickable at any zoom level.
  function updateSource() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("pins") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: pinsRef.current.map((p) => ({
        type: "Feature" as const,
        properties: { pinId: p.id, hasPhotos: p.hasPhotos, highVolumeUntagged: p.highVolumeUntagged } satisfies PinProps,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      })),
    });
  }

  // Re-push data when pins change.
  useEffect(() => {
    if (!readyRef.current) return;
    updateSource();
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
