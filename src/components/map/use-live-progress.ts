"use client";

import { useEffect, useState } from "react";
import { timeProgress, travelledProgressFromScans } from "@/lib/utils/progress";
import type { CargoOnRoute } from "./map-shared";

/**
 * How far along the route the package sits right now, 0 to 1, kept live.
 *
 * The position is the honest one and nothing else: the distance covered across
 * the stretches the shipment was actually moving, at the mode's real speed —
 * 60 km/h on the road. It is re-read from the clock on a timer, so the package
 * advances at exactly the rate the thing itself advances.
 *
 * There is deliberately no glide up to that position. Animating the journey
 * already travelled crossed a couple of hundred kilometres in a few seconds,
 * which is not a speed any lorry makes and reads as obviously false. A package
 * that appears to barely move is the correct depiction of a package that is
 * barely moving: over a minute it covers a kilometre, and over an hour it
 * covers sixty, which is visible on the map exactly as it is on the road.
 *
 * A held shipment stops at the distance it had already covered and never snaps
 * back to the origin — including one put back to pending, which stands where it
 * had reached rather than returning to the sender's door it left hours ago.
 */
export function useLiveCargoProgress(cargo: CargoOnRoute | null | undefined): number {
  /*
   * Depend on the journey's own values rather than the object, so a parent
   * re-render that hands over an equal-but-new `cargo` does not disturb it.
   */
  const status = cargo?.status;
  const cargoType = cargo?.cargoType;
  const shipDate = cargo?.shipDate ?? null;
  const deliveryDate = cargo?.deliveryDate ?? null;
  const scans = cargo?.scans;
  const routeKm = cargo?.routeKm ?? 0;
  const moving = cargo?.moving ?? false;
  const fallback = cargo?.progress ?? 0;

  const [progress, setProgress] = useState(fallback);

  useEffect(() => {
    if (!status || !cargoType) return;

    const positionNow = () =>
      (status === "delivered"
        ? 1
        : travelledProgressFromScans(scans ?? [], routeKm, cargoType, status)) ??
      timeProgress(shipDate, deliveryDate) ??
      fallback;

    /*
     * Take up the true position immediately, with no run-up to it — scheduled
     * rather than set inline so the first paint still matches what the server
     * rendered and hydration has nothing to disagree about.
     */
    const frame = requestAnimationFrame(() => setProgress(positionNow()));

    // A held shipment is not covering ground, so there is nothing to re-read.
    const tick = moving
      ? window.setInterval(() => setProgress(positionNow()), 1_000)
      : undefined;

    return () => {
      cancelAnimationFrame(frame);
      if (tick !== undefined) window.clearInterval(tick);
    };
  }, [status, cargoType, shipDate, deliveryDate, scans, routeKm, moving, fallback]);

  return cargo ? progress : 0;
}
