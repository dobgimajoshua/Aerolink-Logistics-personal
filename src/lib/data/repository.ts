import "server-only";

import type {
  AppUser,
  DashboardStats,
  ServiceLocation,
  Shipment,
  ShipmentStatus,
  ShipmentWithEvents,
  SupportRequest,
  SupportStatus,
  TrackingEvent,
} from "@/types";
import { normalizeTrackingNumber } from "@/lib/utils/format";
import { getAdminSupabase } from "@/lib/supabase/server";
import { nextId, store } from "./local-store";

export interface ShipmentQuery {
  status?: ShipmentStatus | "all";
  search?: string;
  limit?: number;
  offset?: number;
}

export type NewShipment = Omit<Shipment, "id" | "created_at" | "updated_at">;
export type ShipmentPatch = Partial<NewShipment>;
export type NewTrackingEvent = Omit<TrackingEvent, "id" | "created_at">;
export type NewSupportRequest = Omit<SupportRequest, "id" | "created_at" | "status"> & {
  status?: SupportStatus;
};

/** Which backend is answering — surfaced in the admin UI so it is never a mystery. */
export function backendName(): "supabase" | "local" {
  return getAdminSupabase() ? "supabase" : "local";
}

/* ------------------------------------------------------------------ */
/* Tracking                                                            */
/* ------------------------------------------------------------------ */

export async function getShipmentByTracking(
  trackingNumber: string,
): Promise<ShipmentWithEvents | null> {
  const needle = normalizeTrackingNumber(trackingNumber);
  if (!needle) return null;

  const db = getAdminSupabase();
  if (db) {
    /*
     * Compare on a normalised form so `alx2026983456` matches `FCX-2026-983456`.
     * The needle has its separators stripped, so it has to be matched against
     * the column that is stripped the same way — filtering it against the raw
     * `tracking_number` never matches, because that still holds the dashes.
     */
    const { data, error } = await db
      .from("shipments")
      .select("*, tracking_events(*)")
      .ilike("tracking_normalized", `%${needle.replace(/^ALX/, "")}%`)
      .limit(25);
    if (error) throw new Error(error.message);
    const match = (data ?? []).find(
      (row) => normalizeTrackingNumber(row.tracking_number as string) === needle,
    );
    if (!match) return null;
    return sortEvents(match as unknown as ShipmentWithEvents);
  }

  const { shipments, events } = store();
  const shipment = shipments.find(
    (s) => normalizeTrackingNumber(s.tracking_number) === needle,
  );
  if (!shipment) return null;
  return sortEvents({
    ...shipment,
    tracking_events: events.filter((e) => e.shipment_id === shipment.id),
  });
}

function sortEvents(shipment: ShipmentWithEvents): ShipmentWithEvents {
  return {
    ...shipment,
    // Newest first. Scans stamped at the same instant fall back to the order
    // they were recorded in, so the latest change is never the one buried.
    tracking_events: [...(shipment.tracking_events ?? [])].sort(
      (a, b) =>
        new Date(b.event_date).getTime() - new Date(a.event_date).getTime() ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Shipments                                                           */
/* ------------------------------------------------------------------ */

export async function listShipments(
  query: ShipmentQuery = {},
): Promise<{ rows: Shipment[]; total: number }> {
  const { status = "all", search = "", limit = 25, offset = 0 } = query;
  const db = getAdminSupabase();

  if (db) {
    let q = db.from("shipments").select("*", { count: "exact" });
    if (status !== "all") q = q.eq("status", status);
    if (search.trim()) {
      const term = `%${search.trim()}%`;
      q = q.or(
        [
          `tracking_number.ilike.${term}`,
          `receiver_name.ilike.${term}`,
          `sender_name.ilike.${term}`,
          `destination_city.ilike.${term}`,
          `origin_city.ilike.${term}`,
        ].join(","),
      );
    }
    const { data, error, count } = await q
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as Shipment[], total: count ?? 0 };
  }

  const term = search.trim().toLowerCase();
  const filtered = store()
    .shipments.filter((s) => (status === "all" ? true : s.status === status))
    .filter((s) => {
      if (!term) return true;
      return [
        s.tracking_number,
        s.receiver_name,
        s.sender_name,
        s.destination_city,
        s.origin_city,
        s.destination_country,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return { rows: filtered.slice(offset, offset + limit), total: filtered.length };
}

export async function getShipment(id: string): Promise<ShipmentWithEvents | null> {
  const db = getAdminSupabase();
  if (db) {
    const { data, error } = await db
      .from("shipments")
      .select("*, tracking_events(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? sortEvents(data as unknown as ShipmentWithEvents) : null;
  }

  const { shipments, events } = store();
  const shipment = shipments.find((s) => s.id === id);
  if (!shipment) return null;
  return sortEvents({
    ...shipment,
    tracking_events: events.filter((e) => e.shipment_id === id),
  });
}

export async function createShipment(input: NewShipment): Promise<Shipment> {
  const now = new Date().toISOString();
  const db = getAdminSupabase();

  if (db) {
    const { data, error } = await db
      .from("shipments")
      .insert({ ...input, created_at: now, updated_at: now })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Shipment;
  }

  const shipment: Shipment = { ...input, id: nextId("shp"), created_at: now, updated_at: now };
  store().shipments.unshift(shipment);
  return shipment;
}

export async function updateShipment(id: string, patch: ShipmentPatch): Promise<Shipment | null> {
  const now = new Date().toISOString();
  const db = getAdminSupabase();

  if (db) {
    const { data, error } = await db
      .from("shipments")
      .update({ ...patch, updated_at: now })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Shipment) ?? null;
  }

  const { shipments } = store();
  const index = shipments.findIndex((s) => s.id === id);
  if (index === -1) return null;
  shipments[index] = { ...shipments[index], ...patch, updated_at: now };
  return shipments[index];
}

export async function deleteShipment(id: string): Promise<boolean> {
  const db = getAdminSupabase();
  if (db) {
    const { error } = await db.from("shipments").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return true;
  }

  const s = store();
  const index = s.shipments.findIndex((x) => x.id === id);
  if (index === -1) return false;
  s.shipments.splice(index, 1);
  s.events = s.events.filter((e) => e.shipment_id !== id);
  return true;
}

export async function isTrackingNumberTaken(trackingNumber: string): Promise<boolean> {
  const db = getAdminSupabase();
  if (db) {
    const { data, error } = await db
      .from("shipments")
      .select("id")
      .eq("tracking_number", trackingNumber)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(data);
  }
  return store().shipments.some((s) => s.tracking_number === trackingNumber);
}

/* ------------------------------------------------------------------ */
/* Tracking events                                                     */
/* ------------------------------------------------------------------ */

export async function addTrackingEvent(input: NewTrackingEvent): Promise<TrackingEvent> {
  const now = new Date().toISOString();
  const db = getAdminSupabase();

  if (db) {
    const { data, error } = await db
      .from("tracking_events")
      .insert({ ...input, created_at: now })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as TrackingEvent;
  }

  const event: TrackingEvent = { ...input, id: nextId("evt"), created_at: now };
  store().events.push(event);
  return event;
}

export async function listRecentEvents(limit = 12): Promise<
  (TrackingEvent & { tracking_number: string })[]
> {
  const db = getAdminSupabase();
  if (db) {
    const { data, error } = await db
      .from("tracking_events")
      .select("*, shipments(tracking_number)")
      .order("event_date", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => {
      const { shipments, ...event } = row as TrackingEvent & {
        shipments: { tracking_number: string } | null;
      };
      return { ...event, tracking_number: shipments?.tracking_number ?? "—" };
    });
  }

  const { events, shipments } = store();
  return [...events]
    .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())
    .slice(0, limit)
    .map((e) => ({
      ...e,
      tracking_number:
        shipments.find((s) => s.id === e.shipment_id)?.tracking_number ?? "—",
    }));
}

/* ------------------------------------------------------------------ */
/* Locations                                                           */
/* ------------------------------------------------------------------ */

export async function listLocations(params: {
  country?: string;
  city?: string;
  search?: string;
} = {}): Promise<ServiceLocation[]> {
  const db = getAdminSupabase();
  let rows: ServiceLocation[];

  if (db) {
    const { data, error } = await db.from("locations").select("*").order("country");
    if (error) throw new Error(error.message);
    rows = (data ?? []) as ServiceLocation[];
  } else {
    rows = store().locations;
  }

  const term = params.search?.trim().toLowerCase() ?? "";
  return rows.filter((l) => {
    if (params.country && params.country !== "all" && l.country !== params.country) return false;
    if (params.city && params.city !== "all" && l.city !== params.city) return false;
    if (!term) return true;
    return [l.country, l.city, l.town ?? "", l.address].join(" ").toLowerCase().includes(term);
  });
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export async function listCustomers(): Promise<AppUser[]> {
  const db = getAdminSupabase();
  if (db) {
    const { data, error } = await db
      .from("users")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as AppUser[];
  }
  return [...store().users].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/* ------------------------------------------------------------------ */
/* Support                                                             */
/* ------------------------------------------------------------------ */

export async function createSupportRequest(
  input: NewSupportRequest,
): Promise<SupportRequest> {
  const now = new Date().toISOString();
  const payload = { ...input, status: input.status ?? ("open" as SupportStatus) };
  const db = getAdminSupabase();

  if (db) {
    const { data, error } = await db
      .from("support_requests")
      .insert({ ...payload, created_at: now })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as SupportRequest;
  }

  const request: SupportRequest = { ...payload, id: nextId("sup"), created_at: now };
  store().support.unshift(request);
  return request;
}

export async function listSupportRequests(status?: SupportStatus | "all"): Promise<
  SupportRequest[]
> {
  const db = getAdminSupabase();
  let rows: SupportRequest[];

  if (db) {
    const { data, error } = await db
      .from("support_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    rows = (data ?? []) as SupportRequest[];
  } else {
    rows = [...store().support].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }

  return status && status !== "all" ? rows.filter((r) => r.status === status) : rows;
}

export async function updateSupportStatus(
  id: string,
  status: SupportStatus,
): Promise<SupportRequest | null> {
  const db = getAdminSupabase();
  if (db) {
    const { data, error } = await db
      .from("support_requests")
      .update({ status })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as SupportRequest) ?? null;
  }

  const request = store().support.find((r) => r.id === id);
  if (!request) return null;
  request.status = status;
  return request;
}

/* ------------------------------------------------------------------ */
/* Dashboard statistics                                                */
/* ------------------------------------------------------------------ */

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

export async function getStats(): Promise<DashboardStats> {
  const [{ rows: shipments }, customers, support] = await Promise.all([
    listShipments({ limit: 1000 }),
    listCustomers(),
    listSupportRequests(),
  ]);

  const count = (status: ShipmentStatus) => shipments.filter((s) => s.status === status).length;

  const months: DashboardStats["by_month"] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const label = MONTH_FMT.format(d);
    const inMonth = (value: string) => {
      const x = new Date(value);
      return `${x.getUTCFullYear()}-${x.getUTCMonth()}` === key;
    };
    months.push({
      month: label,
      created: shipments.filter((s) => inMonth(s.created_at)).length,
      delivered: shipments.filter((s) => s.status === "delivered" && inMonth(s.updated_at)).length,
    });
  }

  const statuses: ShipmentStatus[] = [
    "pending",
    "picked_up",
    "in_transit",
    "customs",
    "out_for_delivery",
    "delivered",
    "delayed",
    "exception",
  ];

  return {
    total: shipments.length,
    in_transit: count("in_transit") + count("picked_up") + count("customs"),
    delivered: count("delivered"),
    pending: count("pending"),
    delayed: count("delayed") + count("exception"),
    customers: customers.filter((u) => u.role === "customer").length,
    open_support: support.filter((r) => r.status === "open" || r.status === "in_progress").length,
    by_month: months,
    by_status: statuses
      .map((status) => ({ status, count: count(status) }))
      .filter((s) => s.count > 0),
  };
}
