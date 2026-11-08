import { Flag, MapPin, Navigation, type LucideIcon } from "lucide-react";

import type { CargoType, ShipmentStatus } from "@/types";
import { CARGO_ICONS, haversineKm, type ScanLeg } from "@/lib/utils/progress";

export interface MapPoint {
  kind: "origin" | "current" | "destination" | "hub";
  label: string;
  lat: number;
  lng: number;
}

/** One palette shared by every map provider so markers read identically. */
export const MARKER_COLORS: Record<MapPoint["kind"], string> = {
  origin: "#1c3fd8",
  current: "#fb5c11",
  destination: "#0f2166",
  hub: "#3161f7",
};

export const MARKER_LABELS: Record<MapPoint["kind"], string> = {
  origin: "Origin",
  current: "Current location",
  destination: "Destination",
  hub: "Service point",
};

export const MARKER_ICONS: Record<MapPoint["kind"], LucideIcon> = {
  origin: MapPin,
  current: Navigation,
  destination: Flag,
  hub: MapPin,
};

/**
 * Everything the map needs to draw the package itself: where along the route
 * it sits, whether it should be animating, and what to draw.
 */
export interface CargoOnRoute {
  /**
   * Position derived from the shipment's status. Used only when the journey
   * has no dates to measure against.
   */
  progress: number;
  moving: boolean;
  cargoType: CargoType;
  imageUrl: string | null;
  label: string;
  /** The journey's real span, so the marker can advance with the clock. */
  shipDate: string | null;
  deliveryDate: string | null;
  /** Real travel speed for this mode, km/h — 60 on land. */
  speedKmh: number;
  /** Length of the drawn route in km, used with the speed to place the marker. */
  routeKm: number;
  /** Decides whether the clock runs: moving accrues distance, held does not. */
  status: ShipmentStatus;
  /**
   * The status changes, oldest first. Distance is accrued across the stretches
   * the shipment was moving, so a hold keeps the ground it had covered.
   */
  scans: ScanLeg[];
}

/**
 * The DOM node that travels the route. An uploaded photo is used when there is
 * one; otherwise the vehicle glyph. Built as raw DOM because both map
 * providers take elements, not React nodes.
 */
export function cargoMarkerElement(cargo: CargoOnRoute): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("aria-label", cargo.label);
  wrapper.style.cssText = [
    "width:46px",
    "height:46px",
    "border-radius:9999px",
    "border:3px solid #ffffff",
    "background:#fb5c11",
    "box-shadow:0 4px 14px rgba(11,14,20,.45)",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "overflow:hidden",
    cargo.moving ? "animation:freightcargoxpress-pulse 2.4s ease-out infinite" : "",
  ]
    .filter(Boolean)
    .join(";");

  if (cargo.imageUrl) {
    const img = document.createElement("img");
    img.src = cargo.imageUrl;
    img.alt = "";
    img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
    wrapper.appendChild(img);
  } else {
    wrapper.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none"
      stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      >${CARGO_ICONS[cargo.cargoType]}</svg>`;
  }

  return wrapper;
}

/**
 * Interpolation along an ordered list of points, weighted by real distance.
 *
 * Giving each leg an equal share of the progress would make the marker sprint
 * across a long ocean leg and crawl through a short one. Progress here is a
 * fraction of the route's *length*, so a constant 60 km/h stays constant
 * wherever on the route the package happens to be.
 */
export function pointAtProgress(
  points: { lat: number; lng: number }[],
  progress: number,
): { lat: number; lng: number } {
  if (points.length === 0) return { lat: 0, lng: 0 };
  if (points.length === 1) return points[0];

  const clamped = Math.min(Math.max(progress, 0), 1);

  const legs = points.slice(1).map((p, i) => haversineKm(points[i], p));
  const total = legs.reduce((sum, km) => sum + km, 0);

  // Degenerate route (every point identical): nothing to interpolate along.
  if (total === 0) return points[0];

  let remaining = clamped * total;
  for (let i = 0; i < legs.length; i++) {
    if (remaining <= legs[i] || i === legs.length - 1) {
      const t = legs[i] === 0 ? 0 : Math.min(remaining / legs[i], 1);
      const a = points[i];
      const b = points[i + 1];
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    remaining -= legs[i];
  }

  return points[points.length - 1];
}

const PULSE_STYLE_ID = "freightcargoxpress-marker-pulse";

/** Injects the marker pulse animation once per page, for DOM-built markers. */
export function ensurePulseKeyframes() {
  if (document.getElementById(PULSE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PULSE_STYLE_ID;
  style.textContent = `@keyframes freightcargoxpress-pulse{0%{box-shadow:0 0 0 0 rgba(251,92,17,.55)}70%{box-shadow:0 0 0 16px rgba(251,92,17,0)}100%{box-shadow:0 0 0 0 rgba(251,92,17,0)}}`;
  document.head.appendChild(style);
}

/** For labels interpolated into popup HTML. */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
