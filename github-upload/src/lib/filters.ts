// Shared client filter state shape.
export interface Filters {
  tags: string[];
  locationIds: string[];
  search: string;
  hasPhotos: boolean; // "Photos only" toggle
}

export const EMPTY_FILTERS: Filters = { tags: [], locationIds: [], search: "", hasPhotos: false };

// Map command bus — AppShell issues these, MapView consumes them via effect.
export type MapCommand =
  | { kind: "flyTo"; center: [number, number]; zoom: number; nonce: number }
  | { kind: "fitPins"; nonce: number }
  | null;
