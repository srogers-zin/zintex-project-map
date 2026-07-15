import type { StyleSpecification } from "maplibre-gl";

// Credential-free basemap: MapLibre GL + OpenStreetMap raster tiles.
// No API token required — this is the swap point for a branded basemap.
//
// To switch to Mapbox later: set NEXT_PUBLIC_MAPBOX_TOKEN and return
// `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=...`
// (MapLibre can consume Mapbox styles). For production traffic, prefer a
// self-hosted or commercial tile provider over the public OSM tile servers,
// whose usage policy discourages heavy embedding.
export const OSM_STYLE: StyleSpecification = {
  version: 8,
  // Glyphs are required for any symbol layer with text (our cluster counts).
  // MapLibre's demo endpoint serves Noto Sans font PBFs, no key required.
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "osm", type: "raster", source: "osm" },
  ],
};

// Territory center and default zoom for first load — framed to show the whole
// multi-state footprint (TX, OK, AR, LA, MS, TN, KS), not just Texas.
export const DEFAULT_CENTER: [number, number] = [-94.5, 33.8];
export const DEFAULT_ZOOM = 4.4;
