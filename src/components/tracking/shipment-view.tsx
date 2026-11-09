import { ExternalLink, FileText, History, MapPinned } from "lucide-react";
import type { ShipmentWithEvents } from "@/types";
import { Card } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { InvoiceDocument } from "@/components/invoice/invoice-document";
import { StatusHeader } from "./status-header";
import { TrackingTimeline } from "./timeline";
import { LiveRefresh } from "./live-refresh";
import { ShipmentDetails } from "./shipment-details";
import { ShipmentMap, type MapPoint } from "@/components/map/shipment-map";
import { resolvePlace } from "@/lib/geo/resolve-place";
import {
  CARGO_LABELS,
  travelledProgressFromScans,
  type ScanLeg,
  isMoving,
  progressFor,
  routeLengthKm,
  speedKmhFor,
  timeProgress,
} from "@/lib/utils/progress";
import type { CargoOnRoute } from "@/components/map/map-shared";

/** Builds origin → current → destination markers, skipping anything unplaceable. */
export async function mapPointsFor(shipment: ShipmentWithEvents): Promise<MapPoint[]> {
  const points: MapPoint[] = [];

  const origin = await resolvePlace(shipment.origin_city, shipment.origin_country);
  if (origin) {
    points.push({
      kind: "origin",
      label: `${shipment.origin_city}, ${shipment.origin_country}`,
      ...origin,
    });
  }

  const currentCity = shipment.current_location?.split(",")[0]?.trim();
  const currentCountry = shipment.current_location?.split(",")[1]?.trim();
  const current =
    shipment.latitude != null && shipment.longitude != null
      ? { lat: shipment.latitude, lng: shipment.longitude }
      : await resolvePlace(currentCity, currentCountry);
  if (current && shipment.current_location) {
    points.push({ kind: "current", label: shipment.current_location, ...current });
  }

  const destination = await resolvePlace(
    shipment.destination_city,
    shipment.destination_country,
  );
  if (destination) {
    points.push({
      kind: "destination",
      label: `${shipment.destination_city}, ${shipment.destination_country}`,
      ...destination,
    });
  }

  return points;
}

/**
 * What travels the route, and how far along it currently sits.
 *
 * When the shipment has a real current location the package is placed exactly
 * on it, so the map agrees with the latest scan. Only when there is no such
 * scan does it fall back to a position derived from the status.
 */
export function cargoFor(shipment: ShipmentWithEvents, points: MapPoint[]): CargoOnRoute {
  const currentIndex = points.findIndex((p) => p.kind === "current");
  const byScan =
    currentIndex > 0 && points.length > 1 ? currentIndex / (points.length - 1) : null;

  const routeKm = routeLengthKm(points);
  const cargoType = shipment.cargo_type;
  /*
   * Oldest first: the distance covered is accrued across the stretches between
   * status changes, so the order they happened in is the whole point. The
   * repository hands them back newest first for the timeline.
   */
  const scans: ScanLeg[] = [...(shipment.tracking_events ?? [])]
    .map((event) => ({ status: event.status, at: event.event_date }))
    .reverse();

  return {
    /*
     * Preference order: how far it has actually travelled at its real speed,
     * then the date span, then the last scan, then the status. The map
     * re-derives this as the page stays open, so it is only a starting point.
     */
    progress:
      (shipment.status === "delivered"
        ? 1
        : travelledProgressFromScans(scans, routeKm, cargoType, shipment.status)) ??
      timeProgress(shipment.ship_date, shipment.estimated_delivery) ??
      byScan ??
      progressFor(shipment.status),
    shipDate: shipment.ship_date,
    deliveryDate: shipment.estimated_delivery,
    speedKmh: speedKmhFor(cargoType),
    routeKm,
    status: shipment.status,
    scans,
    moving: isMoving(shipment.status),
    cargoType: shipment.cargo_type,
    imageUrl: shipment.cargo_image_url,
    label: shipment.goods_description ?? CARGO_LABELS[shipment.cargo_type],
  };
}

export async function ShipmentView({ shipment }: { shipment: ShipmentWithEvents }) {
  const points = await mapPointsFor(shipment);
  const cargo = cargoFor(shipment, points);

  return (
    <div className="space-y-5">
      <LiveRefresh />
      <StatusHeader shipment={shipment} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card padded={false} className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-5 py-4">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.1em] text-ink-600">
              <MapPinned aria-hidden className="size-4 text-brand-700" />
              Current Shipment Location
            </h3>
            {shipment.current_location ? (
              <p className="truncate text-sm font-semibold text-ink-900">
                {shipment.current_location}
              </p>
            ) : null}
          </div>
          <ShipmentMap points={points} cargo={cargo} className="rounded-none" />
        </Card>

        <Card id="history" className="scroll-mt-28">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.1em] text-ink-600">
            <History aria-hidden className="size-4 text-brand-700" />
            Tracking History
          </h3>
          <div className="mt-6 max-h-[32rem] overflow-y-auto pr-1">
            <TrackingTimeline events={shipment.tracking_events} />
          </div>
        </Card>
      </div>

      <ShipmentDetails shipment={shipment} />

      {/*
        The invoice is rendered in place rather than behind a link — the
        receiver should not have to take a second action to see the record.
        The standalone route is kept for a clean print or PDF.
      */}
      <section aria-labelledby="invoice-heading" className="scroll-mt-28" id="invoice">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2
            id="invoice-heading"
            className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.1em] text-ink-600"
          >
            <FileText aria-hidden className="size-4 text-brand-700" />
            Invoice {shipment.order_number}
          </h2>

          <ButtonLink
            href={`/invoice/${encodeURIComponent(shipment.tracking_number)}`}
            variant="outline"
            size="sm"
            iconRight={<ExternalLink aria-hidden className="size-4" />}
          >
            Open to print or save as PDF
          </ButtonLink>
        </div>

        <InvoiceDocument shipment={shipment} />
      </section>
    </div>
  );
}
