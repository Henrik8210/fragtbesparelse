# freightlytics.io

This is the same Node server as the app, reached through a Cloudflare Container. The Cursor app at https://fairlane.apps.grok.bot stays published. Do not unpublish it, and do not publish this folder again as another Cursor app.

Cloudflare can run the existing server in a container. Cloudflare does not host Postgres. The database is a normal Postgres connection string, passed in as `DATABASE_URL` when you deploy. Nothing in this file is a secret.

A container sleeps after six hours with no visits. The next visit starts it again. That first visit waits while the server boots.

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

The admin password must be 8 to 80 characters. Leave the second secret unset if you do not want one yet. Wrangler asks for the value on your machine. Do not commit it and do not paste it into chat.

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

## What could not be done from here

There is no Cloudflare login on this machine, so the zone was not read, the Worker was not deployed, and no DNS record was created. `DATABASE_URL` for the Cursor app was not copied. freightlytics.io needs its own database.
