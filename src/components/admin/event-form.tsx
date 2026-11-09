"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Radio } from "lucide-react";
import type { ShipmentStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { STATUS_LABELS } from "@/lib/utils/format";
import { STATUS_PREVIEW_EVENT, type StatusPreviewDetail } from "@/components/map/shipment-map";

/** Shows the selected status on the page's map before the scan is posted. */
function previewOnMap(detail: StatusPreviewDetail) {
  window.dispatchEvent(new CustomEvent(STATUS_PREVIEW_EVENT, { detail }));
}

const STATUSES = Object.keys(STATUS_LABELS) as ShipmentStatus[];

/** Sensible default wording per status so operators are not typing prose. */
const TEMPLATES: Record<ShipmentStatus, string> = {
  pending: "Shipment created. Awaiting pickup from the sender address.",
  picked_up: "Package picked up by a FreightCargoXpress courier.",
  in_transit: "Departed the facility on the next scheduled linehaul.",
  customs: "Presented to customs for import clearance.",
  out_for_delivery: "On the delivery vehicle for final delivery today.",
  delivered: "Delivered and signed for at the receiver address.",
  delayed: "Delivery rescheduled — the shipment was held in transit.",
  exception: "Exception raised on this shipment. Operations are investigating.",
};

interface Props {
  shipmentId: string;
  currentStatus: ShipmentStatus;
  currentLocation: string | null;
}

/**
 * Posting a scan is the operational heartbeat: it writes the tracking event and
 * (by default) advances the shipment status, location and map coordinates in
 * one request.
 */
export function TrackingEventForm({ shipmentId, currentStatus, currentLocation }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<ShipmentStatus>(currentStatus);
  const [description, setDescription] = useState(TEMPLATES[currentStatus]);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [advance, setAdvance] = useState(true);

  // Once the shipment's saved status catches up, the preview has done its job.
  const [savedStatus, setSavedStatus] = useState(currentStatus);
  if (savedStatus !== currentStatus) {
    setSavedStatus(currentStatus);
    setStatus(currentStatus);
    setDescription(TEMPLATES[currentStatus]);
  }
  useEffect(() => {
    previewOnMap({ id: shipmentId, status: null });
  }, [currentStatus, shipmentId]);

  const unsaved = advance && status !== currentStatus;

  // Local wall-clock time, formatted for a datetime-local input. Fixed at
  // mount so it still matches the input's default after a re-render.
  const [nowLocal] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;

    setSubmitting(true);
    setFormError(null);
    setErrors({});

    try {
      const response = await fetch("/api/tracking-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipment_id: shipmentId,
          status: raw.status,
          location: raw.location,
          latitude: raw.latitude ? Number(raw.latitude) : null,
          longitude: raw.longitude ? Number(raw.longitude) : null,
          description: raw.description,
          /*
           * The input only holds minutes. Left at its default it means "now",
           * so send the real instant: truncated to the minute it can land
           * before the scan written seconds earlier when the shipment was
           * created, and the history would then read that one as the latest.
           */
          event_date:
            raw.event_date === nowLocal
              ? new Date().toISOString()
              : new Date(raw.event_date).toISOString(),
          sync_shipment: raw.sync_shipment === "on",
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setErrors((payload.details as Record<string, string>) ?? {});
        setFormError(payload.error ?? "We could not post this scan");
        return;
      }

      toast.success("Tracking scan posted", `${STATUS_LABELS[raw.status as ShipmentStatus]} · ${raw.location}`);
      router.refresh();
    } catch {
      setFormError("Network error — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {formError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {formError}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Select
          name="status"
          label="Status"
          required
          value={status}
          onChange={(e) => {
            const next = e.target.value as ShipmentStatus;
            setStatus(next);
            setDescription(TEMPLATES[next]);
            if (advance) previewOnMap({ id: shipmentId, status: next });
          }}
          error={errors.status}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>

        <Input
          name="location"
          label="Location"
          required
          placeholder="Lyon, France"
          defaultValue={currentLocation ?? ""}
          hint="City, Country — we place the map marker from this."
          error={errors.location}
        />
      </div>

      {unsaved ? (
        <p
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900"
        >
          <span>
            <span className="font-semibold">Not saved yet.</span> The map is showing{" "}
            {STATUS_LABELS[status]} as a preview — post the scan to change the shipment from{" "}
            {STATUS_LABELS[currentStatus]}.
          </span>
          <Button type="submit" size="sm" loading={submitting}>
            Save as {STATUS_LABELS[status]}
          </Button>
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          name="event_date"
          type="datetime-local"
          label="Date and time"
          required
          defaultValue={nowLocal}
          error={errors.event_date}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input name="latitude" type="number" step="any" label="Latitude" hint="Optional" />
          <Input name="longitude" type="number" step="any" label="Longitude" hint="Optional" />
        </div>
      </div>

      <Textarea
        name="description"
        label="Description"
        required
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        hint="This text appears on the customer's tracking timeline."
        error={errors.description}
      />

      <label className="flex items-start gap-3 rounded-xl border border-ink-200 bg-ink-50 p-3.5">
        <input
          type="checkbox"
          name="sync_shipment"
          checked={advance}
          onChange={(e) => {
            setAdvance(e.target.checked);
            previewOnMap({ id: shipmentId, status: e.target.checked ? status : null });
          }}
          className="mt-0.5 size-4 rounded border-ink-400 text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        />
        <span className="text-sm text-ink-700">
          <span className="font-semibold text-ink-900">Advance the shipment</span> — update its
          status, current location and map position to match this scan.
        </span>
      </label>

      <Button
        type="submit"
        size="lg"
        loading={submitting}
        icon={<Radio aria-hidden className="size-4" />}
        className="sm:justify-self-start"
      >
        {submitting ? "Posting scan" : "Post tracking scan"}
      </Button>
    </form>
  );
}
