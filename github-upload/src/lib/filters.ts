// Shared client filter state shape.
export interface Filters {
  tags: string[];
  locationIds: string[];
  search: string;
}

export const EMPTY_FILTERS: Filters = { tags: [], locationIds: [], search: "" };

// Map command bus — AppShell issues these, MapView consumes them via effect.
export type MapCommand =
  | { kind: "flyTo"; center: [number, number]; zoom: number; nonce: number }
  | { kind: "fitPins"; nonce: number }
  | null;
