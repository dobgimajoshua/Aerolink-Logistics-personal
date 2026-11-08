"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  MARKER_COLORS,
  MARKER_LABELS,
  cargoMarkerElement,
  ensurePulseKeyframes,
  escapeHtml,
  pointAtProgress,
  type CargoOnRoute,
  type MapPoint,
} from "./map-shared";
import { timeProgress, travelledProgressFromScans } from "@/lib/utils/progress";

interface Props {
  points: MapPoint[];
  cargo?: CargoOnRoute | null;
  className?: string;
  heightClassName?: string;
  connect?: boolean;
  /** Called when the map cannot load, so the caller can fall back. */
  onFailure?: () => void;
}

/**
 * OpenFreeMap serves OpenStreetMap vector tiles with no key, no account and no
 * usage cap, which is what lets the live map work on a fresh deployment.
 */
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** Long enough for a slow connection; short enough not to strand the visitor. */
const LOAD_TIMEOUT_MS = 15_000;

function markerElement(point: MapPoint): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-label", `${MARKER_LABELS[point.kind]}: ${point.label}`);
  el.style.cssText = [
    "width:18px",
    "height:18px",
    "border-radius:9999px",
    "border:3px solid #ffffff",
    `background:${MARKER_COLORS[point.kind]}`,
    "box-shadow:0 2px 8px rgba(11,14,20,.4)",
    "cursor:pointer",
    point.kind === "current" ? "animation:freightcargoxpress-pulse 2.4s ease-out infinite" : "",
  ]
    .filter(Boolean)
    .join(";");
  return el;
}

/**
 * Live map that needs no API key: MapLibre GL rendering OpenStreetMap tiles.
 * Used whenever no Google or Mapbox key is configured, and drawn the same way
 * — markers, a dashed route, and the package advancing along it in real time.
 */
export function OpenShipmentMap({
  points,
  className,
  heightClassName = "h-72 sm:h-96 lg:h-[28rem]",
  connect = true,
  cargo = null,
  onFailure,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;

    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;
    let tick: number | undefined;
    let loadTimer: number | undefined;

    const fail = (reason: unknown) => {
      console.warn("[map] OpenStreetMap map unavailable:", reason);
      if (!cancelled) onFailure?.();
    };

    void (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (cancelled || !containerRef.current) return;

        /*
         * MapLibre looks for its worker next to its own script, which no longer
         * exists once the bundler has split it into chunks. Point it at the
         * published copy of the exact version that is running instead.
         */
        maplibre.setWorkerUrl(
          `https://cdn.jsdelivr.net/npm/maplibre-gl@${maplibre.getVersion()}/dist/maplibre-gl-worker.mjs`,
        );
        ensurePulseKeyframes();

        const lngs = points.map((p) => p.lng);
        const lats = points.map((p) => p.lat);

        map = new maplibre.Map({
          container: containerRef.current,
          style: STYLE_URL,
          ...(points.length === 1
            ? { center: [points[0].lng, points[0].lat] as [number, number], zoom: 5 }
            : {
                bounds: [
                  [Math.min(...lngs), Math.min(...lats)],
                  [Math.max(...lngs), Math.max(...lats)],
                ] as [[number, number], [number, number]],
                fitBoundsOptions: { padding: 48, maxZoom: 6 },
              }),
          attributionControl: { compact: true },
          // Requires ctrl / two fingers to zoom, so the page still scrolls
          // normally when a map fills the width on a phone.
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");

        // Only a map that never loads counts as a failure. Individual tile
        // errors after that are transient and MapLibre retries them itself.
        loadTimer = window.setTimeout(
          () => fail(new Error(`map did not load within ${LOAD_TIMEOUT_MS / 1000}s`)),
          LOAD_TIMEOUT_MS,
        );
        map.on("error", (event) => {
          if (!map?.loaded()) fail(event.error);
        });

        map.on("load", () => {
          window.clearTimeout(loadTimer);
          if (cancelled || !map) return;
          setReady(true);

          if (connect && points.length > 1) {
            map.addSource("route", {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: points.map((p) => [p.lng, p.lat]),
                },
              },
            });
            map.addLayer({
              id: "route-line",
              type: "line",
              source: "route",
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": "#1c3fd8",
                "line-width": 3,
                "line-opacity": 0.9,
                "line-dasharray": [1.5, 2],
              },
            });
          }

          for (const point of points) {
            // The cargo marker already shows the current position.
            if (cargo && point.kind === "current") continue;
            new maplibre.Marker({ element: markerElement(point) })
              .setLngLat([point.lng, point.lat])
              .setPopup(
                new maplibre.Popup({ offset: 14, closeButton: false }).setHTML(
                  `<div style="font-family:system-ui,sans-serif;padding:2px 4px">
                     <strong style="display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6a7688">${MARKER_LABELS[point.kind]}</strong>
                     <span style="font-size:14px;font-weight:600;color:#151a22">${escapeHtml(point.label)}</span>
                   </div>`,
                ),
              )
              .addTo(map);
          }

          if (cargo && points.length > 1) {
            const path = points.map((p) => ({ lat: p.lat, lng: p.lng }));

            // The same honest position the other providers use: distance
            // covered while moving, at the mode's real speed, with no glide.
            const positionNow = () =>
              (cargo.status === "delivered"
                ? 1
                : travelledProgressFromScans(
                    cargo.scans,
                    cargo.routeKm,
                    cargo.cargoType,
                    cargo.status,
                  )) ??
              timeProgress(cargo.shipDate, cargo.deliveryDate) ??
              cargo.progress;
            const lngLatNow = (): [number, number] => {
              const at = pointAtProgress(path, positionNow());
              return [at.lng, at.lat];
            };

            const element = cargoMarkerElement(cargo);
            element.title = cargo.label;
            const cargoMarker = new maplibre.Marker({ element })
              .setLngLat(lngLatNow())
              .addTo(map);

            if (cargo.moving) {
              tick = window.setInterval(() => {
                if (!cancelled) cargoMarker.setLngLat(lngLatNow());
              }, 1_000);
            }
          }
        });
      } catch (error) {
        // Typically a browser without WebGL.
        fail(error);
      }
    })();

    return () => {
      cancelled = true;
      if (loadTimer) window.clearTimeout(loadTimer);
      if (tick) window.clearInterval(tick);
      map?.remove();
    };
  }, [points, connect, cargo, onFailure]);

  return (
    <div className={cn("relative overflow-hidden bg-ink-100", className)}>
      <div ref={containerRef} className={cn("w-full", heightClassName)} />
      {!ready ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink-100"
        >
          <span className="text-sm font-semibold text-ink-500">Loading map…</span>
        </div>
      ) : null}
    </div>
  );
}
