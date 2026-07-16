"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Location, Project, ProjectPin } from "@/lib/types";
import { EMPTY_FILTERS, type Filters, type MapCommand } from "@/lib/filters";
import { fetchLocations, fetchPins, fetchProjects } from "@/lib/api-client";
import { MapView } from "@/components/MapView";
import { Sidebar } from "@/components/Sidebar";
import { FiltersPanel } from "@/components/FiltersPanel";
import { ReviewsPanel } from "@/components/ReviewsPanel";
import { ProjectModal } from "@/components/ProjectModal";
import { ContactModal } from "@/components/ContactModal";

const PAGE = 50;

export function AppShell() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [pins, setPins] = useState<ProjectPin[]>([]);
  const [items, setItems] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalId, setModalId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [mobileList, setMobileList] = useState(false);
  const [command, setCommand] = useState<MapCommand>(null);
  const [searchInput, setSearchInput] = useState("");
  const nonce = useRef(0);

  // Initial load: locations + open shared project (?project=) if present.
  useEffect(() => {
    fetchLocations().then(setLocations);
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("project");
    if (shared) setModalId(shared);
  }, []);

  // Refetch pins + first page of list whenever filters change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchPins(filters), fetchProjects(filters, PAGE, 0)]).then(([p, list]) => {
      if (cancelled) return;
      setPins(p);
      setItems(list.items);
      setTotal(list.total);
      setOffset(list.items.length);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const loadMore = useCallback(() => {
    setLoading(true);
    fetchProjects(filters, PAGE, offset).then((list) => {
      setItems((prev) => [...prev, ...list.items]);
      setOffset((prev) => prev + list.items.length);
      setLoading(false);
    });
  }, [filters, offset]);

  function selectProject(id: string) {
    setSelectedId(id);
    setModalId(id);
    const pin = pins.find((p) => p.id === id);
    if (pin) setCommand({ kind: "flyTo", center: [pin.lng, pin.lat], zoom: 13, nonce: nonce.current++ });
  }

  // Same as selectProject but skips the flyTo/recenter - used when a pin
  // auto-opens itself just by scrolling into view. Recentering here would
  // shift the viewport, which could bring another has-photos pin into frame
  // and cause auto-opens to cascade/jump around the map.
  function autoSelectProject(id: string) {
    setSelectedId(id);
    setModalId(id);
  }

  function runSearch() {
    setFilters((f) => ({ ...f, search: searchInput }));
    setCommand({ kind: "fitPins", nonce: nonce.current++ });
  }

  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition(
      (pos) =>
        setCommand({
          kind: "flyTo",
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 11,
          nonce: nonce.current++,
        }),
      () => alert("Couldn't get your location. Please allow location access."),
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      {/* Header */}
      <header className="z-20 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">Zintex Project Map</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Search city or address..."
            className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          />
          <button
            onClick={runSearch}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
          >
            Search
          </button>
          <button
            onClick={useMyLocation}
            className="rounded-md border
