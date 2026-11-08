# FreightCargoXpress

An international shipment tracking platform: a public marketing and tracking site, a real
data/API layer, and a secure operations dashboard for creating shipments and posting
tracking scans.

FreightCargoXpress is an original fictional brand. No third-party courier's logo, branding, copy or
imagery is used anywhere in this project.

---

## Stack

| Concern     | Choice                                            |
| ----------- | ------------------------------------------------- |
| Framework   | Next.js 16 (App Router, Server Components)        |
| Language    | TypeScript, `strict`                              |
| Styling     | Tailwind CSS v4 (CSS-first `@theme` design tokens) |
| Motion      | Framer Motion                                     |
| Data + auth | Supabase (Postgres, Auth, Row Level Security)     |
| Maps        | Google Maps JS API, with Mapbox and schematic fallbacks |
| Icons       | Lucide React                                      |
| Charts      | Recharts                                          |
| Validation  | Zod                                               |
| Hosting     | Vercel                                            |

---

## Getting started

```bash
npm install
cp .env.example .env.local     # optional — see "Data backends" below
npm run dev
```

Open <http://localhost:3000>.

Tracking numbers take the form `FCX-YYYY-NNNNNN`.

Admin sign-in is at `/admin/login`.

While no Supabase project is configured, the app runs on the local store and
accepts two throwaway accounts — `admin@freightcargoxpress.local` and
`customer@freightcargoxpress.local`. Their passwords are **not** committed: set them in
`.env.local` via `LOCAL_ADMIN_PASSWORD` and `LOCAL_CUSTOMER_PASSWORD`, or leave
them unset and local sign-in is disabled entirely.

Once `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set,
these accounts are ignored completely and every credential is verified by
Supabase Auth. Never rely on them in a deployed environment.

---

## Data backends

The app has one data layer — `src/lib/data/repository.ts` — with two implementations
behind it:

- **Supabase** whenever `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are
  set. Every read and write goes to Postgres, and sign-ins are verified by Supabase Auth.
- **A local store** otherwise, so the whole product — including the admin write flows —
  is exercisable immediately after `npm install`. It lives in the server process and resets
  on restart. It is a development convenience, not a production backend.

The admin dashboard shows which one is active in the sidebar and on the Settings page.
Nothing else in the codebase branches on it.

### Connecting Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/schema.sql` in the SQL editor — tables, indexes, triggers and RLS policies.
3. Run `supabase/seed.sql` for the service-point network. It also inserts sample
   shipments and scan history — skip it, or delete those rows afterwards, on a
   live deployment, because public tracking will serve them to real visitors.
4. Copy the project URL, anon key and service-role key into `.env.local`.
5. Register an account at `/register`, then promote it:

   ```sql
   update public.users set role = 'admin' where email = 'you@example.com';
   ```

   Admin rights are only ever granted in the database — never through signup.

### Maps

`ShipmentMap` picks the best provider available and degrades cleanly if one fails at runtime:

1. **Google Maps** — when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set. Advanced markers for
   origin / current location / destination, a dashed geodesic route between them, click-to-open
   info windows, and cooperative gesture handling so a full-width map never hijacks page scroll
   on a phone.
2. **Mapbox GL** — when `NEXT_PUBLIC_MAPBOX_TOKEN` is set and Google is not.
3. **MapLibre GL with OpenStreetMap tiles** — the default when no key is set. Tiles come from
   [OpenFreeMap](https://openfreemap.org), which needs no key or account, so the live map works
   on a fresh deployment.
4. **A schematic plot** of the same coordinates, if even that cannot load (e.g. no WebGL).

Advanced markers require a Map ID. `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` is used when set; otherwise
Google's built-in sample Map ID is used, which is fine for development but should be replaced
with your own cloud-styled Map ID for production.

> **Securing a Maps key.** The Maps JavaScript API runs in the browser, so the key is served
> with the page by design — it cannot be kept secret. Secure it by restriction instead:
> in the Google Cloud console set **Application restrictions → Websites** to your domains,
> set **API restrictions** to just the Maps JavaScript API, and put a **budget + alert** on the
> project. An unrestricted key can be lifted from any page and billed to you.

---

## Security model

- **Every protected surface is gated on the server.** `src/app/admin/(dashboard)/layout.tsx`
  resolves the session and role before rendering, and each admin API route repeats the check
  independently via `requireAdmin()`. Hiding a link is never treated as protection.
- **The service-role key never reaches the browser.** It is read only from server modules
  (`src/lib/supabase/server.ts`, marked `server-only`) and is not `NEXT_PUBLIC_`.
- **Row Level Security is on for every table.** Through the anon key a customer can read only
  the shipments their email address appears on; writes require an admin row in `public.users`;
  support requests are insert-only for the public and read-only for admins. Public tracking is
  answered by the server using the service-role key, which strips contact emails first — so
  there is no policy allowing anonymous reads of shipment contact details.
- **Role lives in the database**, not in client-editable user metadata.
- **The public tracking API strips contact emails** from its responses.
- **Input is validated server-side with Zod** on every route, returning per-field errors.

---

## Project structure

```
src/
  app/
    (site)/            public pages — home, tracking, services, locations,
                       shipping, about, contact, legal
    admin/
      login/           unauthenticated admin sign-in
      (dashboard)/     server-gated dashboard, shipments, customers,
                       locations, events, support, settings
    api/               tracking, shipments, tracking-events, locations,
                       support, auth
    login/ register/ forgot-password/
    error.tsx  not-found.tsx  loading.tsx  sitemap.ts  robots.ts
  components/
    layout/  home/  tracking/  locations/  shipping/  contact/
    map/               provider selection, Google map, schematic fallback
    admin/  auth/  ui/
  lib/
    maps/              Google Maps loader (single-flight, auth-failure aware)
    supabase/          browser, server and service-role clients
    data/              repository (the single data layer), seed, local store
    auth/              session resolution and role checks
    validations/       Zod schemas shared by forms and API routes
    constants/         brand, services, gazetteer, imagery
    utils/             formatting and class helpers
  types/               shared domain types
  proxy.ts             refreshes the Supabase session cookie per request
                       (Next 16's renamed `middleware`)
supabase/
  schema.sql           tables, enums, indexes, triggers, RLS policies
  seed.sql             sample network data
```

---

## References and invoicing

Each shipment carries two independent references:

| Reference       | Shape              | Purpose                                        |
| --------------- | ------------------ | ---------------------------------------------- |
| Tracking number | `FCX-YYYY-NNNNNN`  | Public scan history; the credential for tracking |
| Order number    | `ORD-YYYY-NNNNNNN` | Commercial reference printed on the invoice     |

Both are generated on create when left blank, and their prefixes and lengths
differ so the two can never be mistaken for one another.

Entering a tracking number produces an invoice at `/invoice/<tracking-number>`,
linked from the tracking result. It renders server-side from the full record —
both parties in full, the goods description, and freight, insurance and tax
summed into a total — and is styled to print or save as a PDF.

> **Privacy note.** Tracking is deliberately open: anyone holding the tracking
> number can view it, which is how couriers normally work. The invoice, though,
> shows both parties' full names, addresses, phone numbers and email addresses,
> so anyone with the tracking number sees them too. If that is broader than you
> want, gate the invoice route behind `getSessionUser()` — the same one-line
> check the admin pages use — or match the receiver's postcode before rendering.

---

## Content model

The marketing pages describe coverage by **capability**, not by a published country list:
service areas and transit times change, and a stale list is worse than none. `/locations` is a
search-driven service-point finder rather than a browsable directory, and the exact lane is
quoted at booking. The gazetteer in `src/lib/constants/geo.ts` still backs map markers,
admin forms and geocoding — it is just never rendered as a public "countries we deliver to"
list.

---

## How tracking works end to end

1. An administrator creates a shipment (`POST /api/shipments`). A tracking number is issued
   in the `FCX-YYYY-NNNNNN` format if one is not supplied, and the first scan is written
   immediately so the customer timeline is never empty.
2. As the shipment moves, the administrator posts a scan (`POST /api/tracking-events`). That
   single request writes the event and — unless the operator opts out — advances the
   shipment's status, current location and map coordinates to match.
3. Coordinates are resolved from the location text against the built-in gazetteer when they
   are not entered by hand, so map markers appear without manual geocoding.
4. The customer opens `/tracking?number=…`. The page is server-rendered from the same data
   layer, showing status, route, estimated delivery, the map and the full scan history.

Tracking numbers are normalised before lookup, so `alx2026983456`, `ALX 2026 983456` and
`FCX-2026-983456` all resolve to the same shipment.

---

## Accessibility and motion

- Semantic landmarks, a skip link, labelled form controls with inline error text wired
  through `aria-describedby`, and `aria-current` on active navigation.
- Visible focus rings on every interactive element; the modal traps focus and restores it
  on close.
- Every entry animation collapses to a static render under `prefers-reduced-motion`, both
  through Framer Motion's `useReducedMotion` and a global CSS guard.
- Layouts are verified for horizontal overflow at 320, 375, 390, 430, 768, 1024, 1280, 1440
  and 1920 px.

---

## Scripts

```bash
npm run dev         # development server
npm run build       # production build
npm run start       # serve the production build
npm run lint        # ESLint, zero warnings allowed
npm run type-check  # tsc --noEmit
```

---

## Deploying to Vercel

1. Push the repository and import it at [vercel.com/new](https://vercel.com/new).
2. Add the environment variables from `.env.example` in Project Settings → Environment
   Variables. `AUTH_SECRET` and the Supabase keys are required in production.
3. Set `NEXT_PUBLIC_SITE_URL` to the deployed URL so metadata, Open Graph, the sitemap and
   `robots.txt` are canonical.

---

## Credits

Photography from [Unsplash](https://unsplash.com) under the Unsplash License (free for
commercial use, no attribution required). The FreightCargoXpress mark, wordmark, palette, typography
and all written copy are original to this project.
