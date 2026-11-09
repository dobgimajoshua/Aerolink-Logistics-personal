"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { GoogleShipmentMap } from "./google-shipment-map";
import { OpenShipmentMap } from "./open-shipment-map";
import { googleMapsKey } from "@/lib/maps/google-loader";
import { STATUS_LABELS } from "@/lib/utils/format";
import { kmCovered } from "@/lib/utils/progress";
import {
  MARKER_COLORS,
  cargoColorFor,
  MARKER_ICONS,
  MARKER_LABELS,
  escapeHtml,
  pointAtProgress,
  type CargoOnRoute,
  type MapPoint,
} from "./map-shared";
import { useLiveCargoProgress } from "./use-live-progress";

export type { MapPoint } from "./map-shared";

interface ShipmentMapProps {
  points: MapPoint[];
  className?: string;
  /** Tailwind height classes — the map must adapt to small screens. */
  heightClassName?: string;
  /** Draw a route line through the points in order. Off for network views. */
  connect?: boolean;
  /** The package itself, drawn travelling the route. */
  cargo?: CargoOnRoute | null;
}

/**
 * Picks the best map provider available, in order:
 *
 *   1. Google Maps  — when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set
 *   2. Mapbox GL    — when NEXT_PUBLIC_MAPBOX_TOKEN is set
 *   3. MapLibre GL  — OpenStreetMap tiles, no key needed
 *   4. A schematic plot of the same coordinates
 *
 * Each provider degrades to the next if it fails at runtime, so the page is
 * never left with an empty grey box.
 */
export function ShipmentMap({ cargo = null, className, ...rest }: ShipmentMapProps) {
  /*
   * The page refreshes itself to pick up status changes, and every refresh
   * hands over new-but-equal objects. Holding them steady means the map is
   * rebuilt only when the shipment actually changed, not on every refresh.
   */
  const points = useStableValue(rest.points);
  const stableCargo = useStableValue(cargo);

  return (
    <div className="relative">
      <MapProvider {...rest} points={points} cargo={stableCargo} className={className} />
      {stableCargo ? <CargoStatusBadge cargo={stableCargo} /> : null}
    </div>
  );
}

/** Returns the same reference for as long as the value is structurally equal. */
function useStableValue<T>(value: T): T {
  const key = JSON.stringify(value);
  const [held, setHeld] = useState({ key, value });
  if (held.key !== key) {
    setHeld({ key, value });
    return value;
  }
  return held.value;
}

/**
 * Says what the package is doing. Its position cannot say it on its own: at a
 * real road speed a package set in transit a minute ago has moved a kilometre,
 * which looks exactly like standing still.
 */
function CargoStatusBadge({ cargo }: { cargo: CargoOnRoute }) {
  const progress = useLiveCargoProgress(cargo);
  const covered = kmCovered(cargo.routeKm, progress);
  const total = Math.round(cargo.routeKm);

  const detail =
    cargo.status === "delivered"
      ? "Arrived at destination"
      : cargo.moving
        ? `Moving · ${Math.round(cargo.speedKmh)} km/h`
        : cargo.status === "pending"
          ? covered > 0
            ? "Stopped · awaiting dispatch"
            : "Awaiting pickup"
          : "Stopped";

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-5rem)] rounded-lg bg-white/95 px-3 py-2 shadow-md backdrop-blur">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-ink-900">
        <span
          aria-hidden
          className={cn("size-2.5 shrink-0 rounded-full", cargo.moving && "animate-pulse")}
          style={{ background: cargoColorFor(cargo.status) }}
        />
        {STATUS_LABELS[cargo.status]}
      </p>
      <p className="mt-0.5 text-[0.6875rem] font-semibold text-ink-600">
        {detail}
        {total > 0 ? ` · ${covered.toLocaleString()} of ${total.toLocaleString()} km` : ""}
      </p>
    </div>
  );
}

function MapProvider({
  points,
  className,
  heightClassName = "h-72 sm:h-96 lg:h-[28rem]",
  connect = true,
  cargo = null,
}: ShipmentMapProps) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [googleFailed, setGoogleFailed] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  const useGoogle = Boolean(googleMapsKey()) && !googleFailed && points.length > 0;
  const onGoogleFailure = useCallback(() => setGoogleFailed(true), []);
  const onOpenFailure = useCallback(() => setOpenFailed(true), []);

  useEffect(() => {
    if (useGoogle || !token || !containerRef.current || points.length === 0) return;

    let map: import("mapbox-gl").Map | undefined;
    let cancelled = false;

    (async () => {
      try {
        const mapboxgl = (await import("mapbox-gl")).default;
        await import("mapbox-gl/dist/mapbox-gl.css");
        if (cancelled || !containerRef.current) return;

        mapboxgl.accessToken = token;
        map = new mapboxgl.Map({
          container: containerRef.current,
          style: "mapbox://styles/mapbox/light-v11",
          bounds: bounds(points),
          fitBoundsOptions: { padding: 64, maxZoom: 6 },
          attributionControl: true,
          cooperativeGestures: true,
        });

        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

        map.on("load", () => {
          if (!map) return;

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
              "line-opacity": 0.85,
              "line-dasharray": [1.5, 2],
            },
          });
          }

          for (const point of points) {
            const el = document.createElement("div");
            el.className = "freightcargoxpress-marker";
            el.setAttribute("aria-label", `${MARKER_LABELS[point.kind]}: ${point.label}`);
            el.style.cssText = [
              "width:20px",
              "height:20px",
              "border-radius:9999px",
              "border:3px solid #fff",
              `background:${MARKER_COLORS[point.kind]}`,
              "box-shadow:0 2px 8px rgba(11,14,20,.35)",
              point.kind === "current" ? "animation:freightcargoxpress-pulse 2.4s ease-out infinite" : "",
            ].join(";");

            new mapboxgl.Marker({ element: el })
              .setLngLat([point.lng, point.lat])
              .setPopup(
                new mapboxgl.Popup({ offset: 18, closeButton: false }).setHTML(
                  `<strong style="font-size:12px">${MARKER_LABELS[point.kind]}</strong><br/><span style="font-size:13px">${escapeHtml(point.label)}</span>`,
                ),
              )
              .addTo(map);
          }
        });

        map.on("error", () => setFailed(true));
      } catch {
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [token, points, connect, useGoogle]);

  if (useGoogle) {
    return (
      <GoogleShipmentMap
        points={points}
        className={className}
        heightClassName={heightClassName}
        connect={connect}
        cargo={cargo}
        onFailure={onGoogleFailure}
      />
    );
  }

  if ((!token || failed) && !openFailed && points.length > 0) {
    return (
      <OpenShipmentMap
        points={points}
        className={className}
        heightClassName={heightClassName}
        connect={connect}
        cargo={cargo}
        onFailure={onOpenFailure}
      />
    );
  }

  if (!token || failed || points.length === 0) {
    return (
      <SchematicMap
        points={points}
        className={className}
        heightClassName={heightClassName}
        connect={connect}
        cargo={cargo}
      />
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-ink-100", className)}>
      <style>{`@keyframes freightcargoxpress-pulse{0%{box-shadow:0 0 0 0 rgba(251,92,17,.55)}70%{box-shadow:0 0 0 14px rgba(251,92,17,0)}100%{box-shadow:0 0 0 0 rgba(251,92,17,0)}}`}</style>
      <div ref={containerRef} className={cn("w-full", heightClassName)} />
      <MapLegend className="pointer-events-none absolute bottom-3 left-3" points={points} />
    </div>
  );
}

function bounds(points: MapPoint[]): [[number, number], [number, number]] {
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

/* ------------------------------------------------------------------ */
/* Token-free fallback                                                 */
/* ------------------------------------------------------------------ */

function SchematicMap({
  points,
  className,
  heightClassName,
  connect,
  cargo,
}: Required<Pick<ShipmentMapProps, "points">> & {
  className?: string;
  heightClassName?: string;
  connect?: boolean;
  cargo?: CargoOnRoute | null;
}) {
  // Called before any early return so the hook order never changes.
  const liveProgress = useLiveCargoProgress(cargo);

  if (points.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-dashed border-ink-300 bg-ink-50 p-6 text-center text-sm text-ink-600",
          heightClassName,
          className,
        )}
      >
        No location coordinates are available for this shipment yet.
      </div>
    );
  }

  const W = 640;
  const H = 360;
  const pad = 64;
  // Marker labels sit above and below each point, so the vertical inset has to
  // clear them or the outermost city labels touch the card edge.
  const padY = 84;

  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const spanLng = Math.max(maxLng - minLng, 0.5);
  const spanLat = Math.max(maxLat - minLat, 0.5);

  const project = (p: MapPoint) => ({
    x: pad + ((p.lng - minLng) / spanLng) * (W - pad * 2),
    y: H - padY - ((p.lat - minLat) / spanLat) * (H - padY * 2),
  });

  // Too many pins to label without overlapping — show dots only.
  const dense = points.length > 8;
  // The cargo marker already stands on the current position.
  const pins = cargo ? points.filter((p) => p.kind !== "current") : points;
  const projected = points.map((p) => ({ ...p, ...project(p) }));
  const projectedPins = pins.map((p) => ({ ...p, ...project(p) }));
  const path = projected
    .map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`))
    .join(" ");

  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-ink-950", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Route plot: ${points.map((p) => p.label).join(" to ")}`}
        className={cn("w-full", heightClassName)}
      >
        <rect width={W} height={H} fill="#0b0e14" />
        <g stroke="#ffffff" strokeOpacity="0.07" strokeWidth="1">
          {Array.from({ length: 9 }, (_, i) => (
            <line key={`h${i}`} x1="0" y1={(i + 1) * (H / 10)} x2={W} y2={(i + 1) * (H / 10)} />
          ))}
          {Array.from({ length: 15 }, (_, i) => (
            <line key={`v${i}`} x1={(i + 1) * (W / 16)} y1="0" x2={(i + 1) * (W / 16)} y2={H} />
          ))}
        </g>

        {connect && points.length > 1 ? (
          <path
            d={path}
            fill="none"
            stroke="#598aff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="2 7"
          />
        ) : null}

        {cargo && projected.length > 1 ? (
          (() => {
            const at = pointAtProgress(
              projected.map((p) => ({ lat: p.y, lng: p.x })),
              liveProgress,
            );
            return (
              <g>
                <circle
                  cx={at.lng}
                  cy={at.lat}
                  r="21"
                  fill={cargoColorFor(cargo.status)}
                  fillOpacity="0.18"
                >
                  {cargo.moving ? (
                    <animate
                      attributeName="r"
                      values="16;27;16"
                      dur="2.4s"
                      repeatCount="indefinite"
                    />
                  ) : null}
                </circle>
                <circle
                  cx={at.lng}
                  cy={at.lat}
                  r="13"
                  fill={cargoColorFor(cargo.status)}
                  stroke="#fff"
                  strokeWidth="3"
                />
                {cargo.imageUrl ? (
                  <>
                    <defs>
                      <clipPath id="cargo-clip">
                        <circle cx={at.lng} cy={at.lat} r="12" />
                      </clipPath>
                    </defs>
                    <image
                      href={cargo.imageUrl}
                      x={at.lng - 12}
                      y={at.lat - 12}
                      width="24"
                      height="24"
                      preserveAspectRatio="xMidYMid slice"
                      clipPath="url(#cargo-clip)"
                    />
                  </>
                ) : null}
                <text
                  x={at.lng}
                  y={at.lat - 26}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="11"
                  fontWeight="700"
                >
                  {cargo.label}
                </text>
              </g>
            );
          })()
        ) : null}

        {projectedPins.map((p) => (
          <g key={`${p.kind}-${p.label}-${p.x}-${p.y}`}>
            {p.kind === "current" ? (
              <circle cx={p.x} cy={p.y} r="16" fill="#fb5c11" fillOpacity="0.2">
                <animate attributeName="r" values="10;22;10" dur="2.6s" repeatCount="indefinite" />
                <animate
                  attributeName="fill-opacity"
                  values="0.28;0;0.28"
                  dur="2.6s"
                  repeatCount="indefinite"
                />
              </circle>
            ) : null}
            <circle
              cx={p.x}
              cy={p.y}
              r={dense ? 4.5 : 7}
              fill={MARKER_COLORS[p.kind]}
              stroke="#fff"
              strokeWidth={dense ? 1.5 : 2.5}
            />
            {dense ? null : (
              <>
            <text
              x={p.x}
              y={p.y - 16}
              textAnchor="middle"
              fill="#ffffff"
              fontSize="13"
              fontWeight="700"
            >
              {p.label}
            </text>
            <text
              x={p.x}
              y={p.y + 26}
              textAnchor="middle"
              fill="#909cb0"
              fontSize="10.5"
              fontWeight="600"
            >
              {MARKER_LABELS[p.kind]}
            </text>
              </>
            )}
          </g>
        ))}
      </svg>

      <p className="absolute bottom-2.5 right-3 inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-[0.6875rem] font-semibold text-ink-300 backdrop-blur">
        <Info aria-hidden className="size-3" />
        Schematic view — the live map could not load
      </p>
    </div>
  );
}

function MapLegend({ points, className }: { points: MapPoint[]; className?: string }) {
  const kinds = Array.from(new Set(points.map((p) => p.kind)));

  return (
    <ul
      className={cn(
        "flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white/92 px-2.5 py-1.5 text-[0.6875rem] font-semibold text-ink-700 shadow-sm backdrop-blur",
        className,
      )}
    >
      {kinds.map((kind) => {
        const Icon = MARKER_ICONS[kind];
        return (
          <li key={kind} className="inline-flex items-center gap-1.5">
            <Icon aria-hidden className="size-3" style={{ color: MARKER_COLORS[kind] }} />
            {MARKER_LABELS[kind]}
          </li>
        );
      })}
    </ul>
  );
}
