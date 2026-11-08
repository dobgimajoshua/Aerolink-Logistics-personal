import { CheckCircle2, Database, KeyRound, Map, XCircle } from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { backendName } from "@/lib/data/repository";
import { getSessionUser } from "@/lib/auth/session";
import { hasServiceRole, isSupabaseConfigured } from "@/lib/supabase/env";
import { SITE } from "@/lib/constants/site";
import { ALL_MARKETS } from "@/lib/constants/geo";
import { SERVICES } from "@/lib/constants/services";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

function StatusRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <li className="flex items-start gap-3 border-t border-ink-200 py-3.5 first:border-0 first:pt-0">
      {ok ? (
        <CheckCircle2 aria-hidden className="mt-0.5 size-4.5 shrink-0 text-emerald-600" />
      ) : (
        <XCircle aria-hidden className="mt-0.5 size-4.5 shrink-0 text-ink-400" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="text-sm font-bold text-ink-900">{label}</p>
          <Badge tone={ok ? "success" : "neutral"} className="shrink-0 sm:ml-auto">
            {ok ? "Connected" : "Not configured"}
          </Badge>
        </div>
        <p className="mt-1 text-sm break-words text-ink-600">{detail}</p>
      </div>
    </li>
  );
}

export default async function AdminSettingsPage() {
  const user = await getSessionUser();
  const supabase = isSupabaseConfigured();
  const serviceRole = hasServiceRole();
  const google = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
  const mapbox = Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN);
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900 sm:text-3xl">Settings</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-ink-600">
          Environment and configuration for this deployment. Secrets are never displayed — only
          whether they are present.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 text-base font-bold text-ink-900">
            <Database aria-hidden className="size-4.5 text-brand-700" />
            Integrations
          </h2>
          <ul className="mt-4">
            <StatusRow
              label="Supabase database and auth"
              ok={supabase}
              detail={
                supabase
                  ? "Reads, writes and sign-ins go to your Supabase project."
                  : "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to switch off the local store."
              }
            />
            <StatusRow
              label="Supabase service role"
              ok={serviceRole}
              detail={
                serviceRole
                  ? "Server-side admin queries bypass RLS. This key is never sent to the browser."
                  : "Set SUPABASE_SERVICE_ROLE_KEY so admin queries can read across all rows."
              }
            />
            <StatusRow
              label="Google Maps"
              ok={google}
              detail={
                google
                  ? `Live Google maps with advanced markers, using ${
                      mapId ? `Map ID ${mapId}` : "Google's built-in sample Map ID (development only)"
                    }.`
                  : "Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to render live Google maps."
              }
            />
            <StatusRow
              label="Mapbox GL"
              ok={mapbox}
              detail={
                mapbox
                  ? google
                    ? "Configured, but Google Maps takes priority."
                    : "Shipment maps render as interactive Mapbox maps."
                  : "Optional. Without any map key, live maps use free OpenStreetMap tiles."
              }
            />
          </ul>
          <p className="mt-4 rounded-xl bg-ink-50 p-4 text-xs leading-relaxed text-ink-600">
            Map keys are browser-visible by design. Restrict them by HTTP referrer and by API in
            the provider console, and set a billing budget — that, not secrecy, is what stops
            someone else spending your quota.
          </p>
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 text-base font-bold text-ink-900">
            <KeyRound aria-hidden className="size-4.5 text-brand-700" />
            Session
          </h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.08em] text-ink-500">
                Signed in as
              </dt>
              <dd className="mt-1 text-sm font-semibold text-ink-900">{user?.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.08em] text-ink-500">Email</dt>
              <dd className="mt-1 break-all text-sm font-semibold text-ink-900">{user?.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.08em] text-ink-500">Role</dt>
              <dd className="mt-1">
                <Badge tone="brand">Administrator</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.08em] text-ink-500">
                Active data source
              </dt>
              <dd className="mt-1 text-sm font-semibold text-ink-900">
                {backendName() === "supabase" ? "Supabase" : "Local store"}
              </dd>
            </div>
          </dl>

          <p className="mt-5 rounded-xl bg-ink-50 p-4 text-xs leading-relaxed text-ink-600">
            Authorization is enforced on the server for every admin page and every admin API route.
            Hiding a link in the interface is never treated as protection.
          </p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 text-base font-bold text-ink-900">
            <Map aria-hidden className="size-4.5 text-brand-700" />
            Network configuration
          </h2>
          <dl className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold text-ink-500">Markets</dt>
              <dd className="mt-1 font-display text-2xl font-extrabold text-brand-800">
                {ALL_MARKETS.length}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-ink-500">Cities</dt>
              <dd className="mt-1 font-display text-2xl font-extrabold text-brand-800">
                {ALL_MARKETS.reduce((sum, m) => sum + m.cities.length, 0)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-ink-500">Services</dt>
              <dd className="mt-1 font-display text-2xl font-extrabold text-brand-800">
                {SERVICES.length}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-ink-600">
            Markets, cities and services are defined in{" "}
            <code className="break-all rounded bg-ink-100 px-1 py-0.5 font-mono text-[0.6875rem]">
              src/lib/constants
            </code>{" "}
            so pricing pages, forms, maps and the locations directory always agree.
          </p>
        </Card>

        <Card>
          <h2 className="text-base font-bold text-ink-900">Public contact details</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Support email</dt>
              <dd className="break-all font-semibold text-ink-900">{SITE.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Main line</dt>
              <dd className="font-semibold text-ink-900">{SITE.phone}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Toll free</dt>
              <dd className="font-semibold text-ink-900">{SITE.supportPhone}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Opening hours</dt>
              <dd className="text-right font-semibold text-ink-900">{SITE.hours}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-ink-600">
            Edit these in{" "}
            <code className="break-all rounded bg-ink-100 px-1 py-0.5 font-mono text-[0.6875rem]">
              src/lib/constants/site.ts
            </code>{" "}
            — the header, footer and contact page all read from there.
          </p>
        </Card>
      </div>
    </div>
  );
}
