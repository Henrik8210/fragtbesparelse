# freightlytics.io

This is the same Node server as the app, reached through a Cloudflare Container. The Cursor app at https://fairlane.apps.grok.bot stays published. Do not unpublish it, and do not publish this folder again as another Cursor app.

Cloudflare can run the existing server in a container. Cloudflare does not host Postgres. The database is a normal Postgres connection string, passed in as `DATABASE_URL` when you deploy. Nothing in this file is a secret.

A container sleeps after six hours with no visits. The next visit starts it again. That first visit waits while the server boots. The port opens before migrations. The first database request applies them, then writes the admin hash, so a slow database does not keep the port closed.

`npx wrangler deploy` uploads a new image, but a container that is already running keeps its old image until the Worker stops it. The next visit reads `/health`. The running process must answer with the revision baked into that Worker. An older page, including one whose image name still matches, is stopped and the new image is started. That visit waits until the new process answers.

## What you do on your machine

Docker Desktop has to be running. `docker info` should return.

```bash
npx wrangler login
```

That opens a browser. Do not paste an API token into chat.

Create a Postgres database anywhere that gives you a `postgres://` connection string. Neon is enough. Use that string only in the secret below.

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put FRAGTBLIK_ADMIN_PASSWORD
```

The admin password must be 8 to 80 characters. Wrangler asks for the value on your machine. Leave the secret as it is once it is set. The login request carries that secret, and the server writes only a hash in `users.password_hash` for username admin before it compares the password from the form. A database error is not a wrong password. The username is admin. Do not commit the password and do not paste it into chat.

```bash
npx wrangler deploy
```

The first deploy builds the image and can take several minutes. Wait a few minutes more before the first request. `npx wrangler containers list` shows whether the container exists.

## Deploy from GitHub Actions

`.github/workflows/ci.yml` deploys on every push to `main` after the checks pass, but only once these two repository secrets exist. Until then the deploy job is skipped and nothing is uploaded. The Worker secrets `DATABASE_URL` and `FRAGTBLIK_ADMIN_PASSWORD` stay in Cloudflare; the workflow does not touch them.

1. Cloudflare dashboard → Manage account → Account API Tokens → Create Token → template "Edit Cloudflare Workers" → Use template. Then:
   - Add a permission: Account → Containers → Edit. The template does not include it, and without it the image push fails with 403.
   - Keep Account → Workers Scripts → Edit, Account → Account Settings → Read, and Zone → Workers Routes → Edit from the template. Workers Routes is what lets the deploy keep the `freightlytics.io` and `www.freightlytics.io` custom domains in `wrangler.jsonc`.
   - Account Resources: include only the account that owns `freightlytics.io`. Zone Resources: Specific zone → `freightlytics.io`.
   - Set an expiry if you want one, then Create Token and copy it once.
2. Copy the Account ID from the right-hand column of the account's Workers & Pages overview.
3. GitHub → this repository → Settings → Secrets and variables → Actions → New repository secret. Add `CLOUDFLARE_API_TOKEN` with the token and `CLOUDFLARE_ACCOUNT_ID` with the account id.
4. Optional: under Variables, set `HEALTH_URL` if the app is not reachable at `https://freightlytics.io/health` yet.

After a deploy the job polls `/health` for about 15 minutes (90 tries, 10 seconds apart) until it answers `ok` plus the revision in `deploy/revision.ts`. Cloudflare can keep the old container for several minutes, so a timeout does not mean the deploy failed: the new revision may still be rolling out. Open `/health` again a few minutes later before redeploying.

## Cloudflare clicks

You need to be logged into the Cloudflare account that owns the zone `freightlytics.io`.

1. Confirm the zone. Dashboard → your account → `freightlytics.io`. If the domain is missing, choose Add a domain and use the nameservers Cloudflare shows. Registration through Cloudflare usually already created this zone.
2. Remove any existing DNS record whose name is `freightlytics.io` or `www` before the first deploy. A custom domain cannot be added while a CNAME already sits on that name.
3. From this repo, run `npx wrangler deploy`. The config asks Cloudflare to attach `freightlytics.io` and `www.freightlytics.io`. Cloudflare creates the DNS records and the certificates. You do not type a CNAME target.
4. If deploy says the zone is not on this account, attach the names in the dashboard instead. Workers & Pages → Overview → `freightlytics` → Settings → Domains & Routes → Add → Custom Domain. Enter `freightlytics.io`. Repeat for `www.freightlytics.io`.

After that, DNS → Records should show two proxied records (orange cloud). Leave them proxied. Do not replace them with a record that points at `fairlane.apps.grok.bot`.

| Name | Type | Content | Proxy |
| --- | --- | --- | --- |
| `freightlytics.io` | the record Cloudflare just created | the content Cloudflare just wrote | Proxied |
| `www` | the record Cloudflare just created | the content Cloudflare just wrote | Proxied |

Those two rows are the records for this app. Cloudflare fills in type and content when the custom domain is added. Copying a guessed target would point the domain at the wrong place.

If you only want `www` to redirect to the apex, skip the `www` custom domain and add this record yourself, then add a redirect rule from `www.freightlytics.io` to `https://freightlytics.io`:

| Name | Type | Content | Proxy |
| --- | --- | --- | --- |
| `www` | AAAA | `100::` | Proxied |

`100::` is a placeholder. The orange cloud means Cloudflare answers it and applies the redirect. Requests do not go to that address.

## Fakturamail

Each organization receives at `{company id}@freightlytics.io`. Nordhavn Living is `nordhavn-living@freightlytics.io`. There is no second domain.

Run this in the Supabase SQL editor before the deploy. No RLS. The app does not create the tables.

```sql
create table if not exists public.invoice_mail (
  id text primary key,
  company_id text not null references public.companies (id),
  sender text not null,
  subject text not null,
  received_at timestamptz not null default now(),
  unique (id, company_id)
);

create table if not exists public.invoice_mail_files (
  id text primary key,
  mail_id text not null,
  company_id text not null references public.companies (id),
  filename text not null,
  mime text not null,
  byte_size integer not null,
  content bytea not null,
  foreign key (mail_id, company_id) references public.invoice_mail (id, company_id)
);

create index if not exists invoice_mail_company_received
  on public.invoice_mail (company_id, received_at desc);
```

After `npx wrangler deploy`, in the Cloudflare account that owns `freightlytics.io`:

1. Select the zone `freightlytics.io`.
2. Email → Email Routing → Enable Email Routing.
3. Confirm the MX and SPF records Cloudflare offers for `freightlytics.io`. That confirmation is the DNS change. Do not add another domain.
4. Routing rules → Catch-all address → Edit → Action: Send to a Worker → worker `freightlytics` → Save.
5. Leave custom addresses empty. The catch-all delivers every organization address to the worker.

Do not point the catch-all at a personal inbox. The worker stores the attachment on the organization in the address, and on no other.

No further SQL is required for a mail that was rejected. After `npx wrangler deploy`, open https://freightlytics.io and wait until the page loads, so the container is on health `ok ci`. Signed in as admin, open https://freightlytics.io/api/admin/db-status?company=nordhavn-living for the database host, the last connection error, and the invoice_mail count. The response has no password and no full URL. Cloudflare retries a delivery that failed. A sample company that is missing from `companies` is inserted for that address only. Indstillinger stays open on refresh at `#/indstillinger`.

## PDF-linjer med Workers AI

A PDF on Fakturaer (received by mail or added there with Tilføj faktura) or a PDF uploaded in Nyt fakturatjek is read into invoice lines. The container reads the PDF's text layer with pdfjs and builds a JSON-schema request. The Durable Object runs it on the `AI` binding (`"ai": { "binding": "AI" }` in `wrangler.jsonc`) with `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, then posts the model output back to the container on `/api/internal/invoice-extract` with the sync token. The container validates the lines, checks their sum against the invoice total, sets a confidence, and caches the result per company and file hash. A scanned PDF with no text layer is not read.

The binding needs no secret. Workers AI must be available on the Cloudflare account. Usage above the free 10,000 neurons a day needs the Workers Paid plan. One small invoice costs about $0.001 to $0.005. Each user can start at most 60 new reads an hour.

Optional AI Gateway: create a gateway in the dashboard (AI → AI Gateway), then add `"vars": { "AI_GATEWAY_ID": "<gateway name>" }` to `wrangler.jsonc`. The gateway name is not a secret.

The cache table is optional. Without it, results are cached in the running container until it restarts. Run this in the Supabase SQL editor to keep them:

```sql
create table if not exists public.invoice_extracts (
  company_id text not null references public.companies (id),
  content_sha256 text not null,
  version integer not null,
  model text not null,
  confidence text not null,
  extract jsonb not null,
  created_at timestamptz not null default now(),
  primary key (company_id, content_sha256)
);
```

The same SQL is in `server/invoice-extract.sql`. Running the server outside Cloudflare has no binding, so a PDF answers "Workers AI er ikke tilgængelig her". Setting `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN` (a Workers AI token) on that server uses the REST API instead.

A PDF added on Prisaftaler with Tilføj prisaftale goes through the same route with `kind=agreement`: the same model, binding, job bridge and hourly cap, with a rate-table prompt and schema in `src/pilot/agreementExtract.ts`. Every price, weight step and surcharge percent the model returns is looked up in the PDF text, and what is not printed is flagged on that row. The person reviews and edits the rows before the agreement is saved in the browser. Agreement extracts are cached in the same `invoice_extracts` table with `content_sha256` prefixed `agreement:` and their own version, so no new table or column is needed. A PDF that is only an image is refused before the model is called.

The validation only keeps a subtotal or VAT amount the PDF prints. Each line is matched to the PDF text line that carries its amount, and a reference, route, service, weight, or surcharge description the model left empty is taken from that line. `EXTRACT_VERSION` 3 reads an older cache row again once. Version 3 adds `unmapped` (printed fields the schema has no place for, plus any key the model returned outside the schema) and `layout` (normalized labels from the text layer) to each extract.

## Formatændringer

When a carrier's invoice layout drifts from the layouts learned from its earlier extracts, or the extractor signals are strong (three or more unmapped fields, a quarter of the amounts not printed verbatim, lines that do not sum to the total, or a third of the lines edited in Check faktura), admins get one bell notice of kind `format_change`. Company seats never see it. Layouts are learned per carrier across all companies from the `layout` in `invoice_extracts`, so no table of their own is needed. One notice per new layout, and one per layout and set of signals. To show what changed in the notice, run this once:

```sql
alter table public.notifications add column if not exists detail jsonb;
```

Without it the notice still appears and opens the document, without the reasons.

## Check faktura

Each invoice on Fakturaer has a Check faktura button. It opens the invoice lines in an editor. Checked saves them as they are. Gem ændringer saves the edited values. The edited lines then replace the extract or the CSV rows in the viewer and in Nyt fakturatjek. The original lines, who checked, when, and each change are kept. An unchecked invoice is used as read. The app does not create the table. Without it, checks are kept in the running container until it restarts, and Fakturaer says so. Run this in the Supabase SQL editor to keep them:

```sql
create table if not exists public.invoice_checks (
  company_id text not null references public.companies (id),
  file_id text not null references public.invoice_mail_files (id) on delete cascade,
  original jsonb not null,
  lines jsonb not null,
  changed boolean not null default false,
  checked_by text not null,
  checked_by_name text not null,
  checked_at timestamptz not null default now(),
  first_checked_at timestamptz not null default now(),
  history jsonb not null default '[]'::jsonb,
  primary key (company_id, file_id)
);
```

The same SQL is in `server/invoice-check.sql`.

## What could not be done from here

There is no Cloudflare login on this machine, so the zone was not read, the Worker was not deployed, and no DNS record was created. `DATABASE_URL` for the Cursor app was not copied. freightlytics.io needs its own database.
