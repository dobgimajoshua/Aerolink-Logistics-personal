import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink, History, MapPinned, Radio, Settings2 } from "lucide-react";
import { Badge, Card, type BadgeTone } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { TrackingEventForm } from "@/components/admin/event-form";
import { DeleteShipment } from "@/components/admin/delete-shipment";
import { ShipmentForm } from "@/components/admin/shipment-form";
import { TrackingTimeline } from "@/components/tracking/timeline";
import { ShipmentMap } from "@/components/map/shipment-map";
import { cargoFor, mapPointsFor } from "@/components/tracking/shipment-view";
import { getShipment } from "@/lib/data/repository";
import {
  SERVICE_LABELS,
  STATUS_LABELS,
  STATUS_TONE,
  formatDate,
  formatDateTime,
  formatWeight,
} from "@/lib/utils/format";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const shipment = await getShipment(id);
  return { title: shipment ? shipment.tracking_number : "Shipment" };
}

export default async function AdminShipmentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const shipment = await getShipment(id);
  if (!shipment) notFound();

  const points = await mapPointsFor(shipment);
  const cargo = cargoFor(shipment, points);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/shipments"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-brand-700"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Back to shipments
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-mono text-2xl font-extrabold text-ink-900 sm:text-3xl">
              {shipment.tracking_number}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Badge tone={(STATUS_TONE[shipment.status] as BadgeTone) ?? "neutral"} dot>
                {STATUS_LABELS[shipment.status]}
              </Badge>
              <p className="text-sm text-ink-600">
                {shipment.origin_city}, {shipment.origin_country} → {shipment.destination_city},{" "}
                {shipment.destination_country}
              </p>
            </div>
          </div>

          <ButtonLink
            href={`/tracking?number=${encodeURIComponent(shipment.tracking_number)}`}
            variant="outline"
            size="md"
            iconRight={<ExternalLink aria-hidden className="size-4" />}
          >
            View as customer
          </ButtonLink>
        </div>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Current location", value: shipment.current_location ?? "Not yet collected" },
          { label: "Estimated delivery", value: formatDate(shipment.estimated_delivery) },
          { label: "Service", value: SERVICE_LABELS[shipment.shipping_service] },
          {
            label: "Consignment",
            value: `${formatWeight(shipment.weight)} · ${shipment.packages} pcs`,
          },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
            <dt className="text-xs font-bold uppercase tracking-[0.08em] text-ink-500">
              {item.label}
            </dt>
            <dd className="mt-1.5 text-[0.9375rem] font-semibold text-ink-900">{item.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card>
          <h2 className="flex items-center gap-2 text-base font-bold text-ink-900">
            <Radio aria-hidden className="size-4.5 text-brand-700" />
            Post a tracking scan
          </h2>
          <p className="mt-1.5 text-sm text-ink-600">
            Records the event and moves the customer&apos;s timeline, map marker and status
            together.
          </p>
          <div className="mt-5">
            <TrackingEventForm
              shipmentId={shipment.id}
              currentStatus={shipment.status}
              currentLocation={shipment.current_location}
            />
          </div>
        </Card>

        <div className="space-y-5">
          <Card padded={false} className="overflow-hidden">
            <div className="border-b border-ink-200 px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-bold text-ink-900">
                <MapPinned aria-hidden className="size-4.5 text-brand-700" />
                Route map
              </h2>
            </div>
            <ShipmentMap
              points={points}
              cargo={cargo}
              previewId={shipment.id}
              className="rounded-none"
              heightClassName="h-64 sm:h-72"
            />
          </Card>

          <Card>
            <h2 className="flex items-center gap-2 text-base font-bold text-ink-900">
              <History aria-hidden className="size-4.5 text-brand-700" />
              Scan history
              <span className="ml-auto text-sm font-semibold text-ink-500">
                {shipment.tracking_events.length}
              </span>
            </h2>
            <div className="mt-5 max-h-96 overflow-y-auto pr-1">
              <TrackingTimeline events={shipment.tracking_events} />
            </div>
          </Card>
        </div>
      </div>

      <section>
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-ink-900">
          <Settings2 aria-hidden className="size-5 text-brand-700" />
          Edit shipment details
        </h2>
        <p className="mt-1.5 text-sm text-ink-600">
          Correct the record without posting a scan. Last updated{" "}
          {formatDateTime(shipment.updated_at)}.
        </p>
        <div className="mt-5">
          <ShipmentForm shipment={shipment} />
        </div>
      </section>

      <Card tone="warning">
        <h2 className="text-base font-bold text-red-900">Danger zone</h2>
        <p className="mt-1.5 max-w-2xl text-sm text-red-800">
          Deleting removes the shipment and every tracking scan attached to it. Customers holding
          this tracking number will get a &ldquo;shipment not found&rdquo; result.
        </p>
        <div className="mt-5">
          <DeleteShipment
            shipmentId={shipment.id}
            trackingNumber={shipment.tracking_number}
          />
        </div>
      </Card>
    </div>
  );
}
