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

No further SQL is required for a mail that was rejected. After `npx wrangler deploy`, open https://freightlytics.io and wait until the page loads, so the container is on health `ok invoice-mail-row`. Then send the invoice again. A sample company that is missing from `companies` is inserted for that address only.

## What could not be done from here

There is no Cloudflare login on this machine, so the zone was not read, the Worker was not deployed, and no DNS record was created. `DATABASE_URL` for the Cursor app was not copied. freightlytics.io needs its own database.
