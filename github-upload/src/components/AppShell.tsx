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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Zintex Remodeling Group" className="h-8 w-auto shrink-0 object-contain" />

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
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
            aria-label="Use my location"
            title="Use my current location"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="8" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /><circle cx="12" cy="12" r="2" fill="currentColor" />
            </svg>
          </button>
        </div>

        <button
          onClick={() => setFilters((f) => ({ ...f, hasPhotos: !f.hasPhotos }))}
          aria-pressed={filters.hasPhotos}
          title="Only show pins with photos"
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
            filters.hasPhotos
              ? "border-[#003366] bg-[#003366] text-white hover:bg-[#002a52]"
              : "border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          Photos only
        </button>
        <button
          onClick={() => setReviewsOpen(true)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Reviews
        </button>
        <Link
          href="/opt-out"
          className="rounded-md px-2 py-1.5 text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
        >
          Opt-Out
        </Link>
      </header>

      {/* Body */}
      <div className="relative flex min-h-0 flex-1">
        {/* Sidebar: always visible on md+, toggle on mobile */}
        <div className={`${mobileList ? "block" : "hidden"} absolute inset-0 z-10 md:static md:z-0 md:block`}>
          <Sidebar
            items={items}
            total={total}
            loading={loading}
            selectedId={selectedId}
            onSelect={selectProject}
            onLoadMore={loadMore}
            hasMore={items.length < total}
          />
        </div>

        <main className="min-w-0 flex-1">
          <MapView
            pins={pins}
            selectedId={selectedId}
            command={command}
            onSelect={selectProject}
          />
        </main>

        {/* Mobile list toggle */}
        <button
          onClick={() => setMobileList((v) => !v)}
          className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-brand-600 px-4 py-2 text-xs font-semibold text-white shadow-lg md:hidden"
        >
          {mobileList ? "Show map" : `List (${total.toLocaleString()})`}
        </button>
      </div>

      <FiltersPanel
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        locations={locations}
        filters={filters}
        onChange={setFilters}
      />
      <ReviewsPanel
        open={reviewsOpen}
        onClose={() => setReviewsOpen(false)}
        locations={locations}
        activeLocationIds={filters.locationIds}
        onSelectProject={(id) => {
          setReviewsOpen(false);
          selectProject(id);
        }}
      />
      {modalId && (
        <ProjectModal
          projectId={modalId}
          onClose={() => {
            setModalId(null);
            setSelectedId(null);
          }}
        />
      )}
      {contactOpen && <ContactModal onClose={() => setContactOpen(false)} />}
    </div>
  );
}
