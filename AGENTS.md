# Freightlytics for the next agent

Read this before changing the app. The product is a Vite + React + TypeScript single-page app. Sample freight figures live in source. A saved check stays in the browser. An organization an admin creates is stored in Postgres.

## Vision

Henrik and Jesper, 9 Nov 2026. The product answers three questions, in this order of work:

1. Are we paying what we agreed? Check invoices against the price agreement. Show each deviation in kroner and which lines to raise with the carrier. A logistics user reviews an objection before a bill is treated as accepted. That acceptance is a sample state. It does not pay anything.
2. Is the agreement competitive? The overview compares this account with the other fictional companies in the same trade, on similar routes. That comparison is sample data. A live market is later.
3. Which carriers fit our shipments? Each carrier on the account has a 0–100 sample fit for its payment model, plus how many of those similar companies prefer it. A one-line note per named carrier still describes the invoice shape. It is not a parser.

After a later tender, the chosen prices would become the next invoice-check baseline. That loop is not built.

Still out: tender sending, offer comparison, a live market feed, payments, bank calls, OCR, and real carrier parsers.

## What this slice does

The screen is the Danish parcel pilot in `src/pilot/PilotApp.tsx`: Overblik, Fakturakontrol, Historik, and Benchmark. It is a short workspace, not the older account essays. A check compares a CSV invoice with a price file in the browser. Saved reports stay in `localStorage`. Fakturakontrol has two sub-pages. Fakturaer (`#/fakturakontrol/fakturaer`, formerly Modtaget) shows the organization's fakturamail at the top with a copy control, lists received mail plus files added with Tilføj faktura, and filters on carrier from a funnel icon. An added file is stored through `/api/invoice-mail/upload` as an `invoice_mail` row with sender `Uploadet af {name}`. The dialog shows the upload and then the Workers AI read, with elapsed time, and a PDF is offered in Nyt fakturatjek exactly like mail. Nyt fakturatjek shows the same bar while a dropped PDF uploads and is read. The carrier column reads the sender, subject and file names, then the carrier printed in the PDF or CSV text (`src/pilot/carrierName.ts`). Prisaftaler lists active agreements with a green dot and historic ones with a grey dot (`src/pilot/agreements.ts`): an agreement is historic when its last day has passed, when a newer one with the same carrier has started, or when it was ended by hand. Agreements added with Tilføj prisaftale are CSV rate files, or a text PDF read by Workers AI (`src/pilot/agreementExtract.ts`). Choosing the file starts the read, with progress per part. Carrier (the issuing company, not the customer), dates and prices come from the file, and the name is "<carrier> <from>–<to>" (`src/pilot/agreementAuto.ts`). The agreement is saved directly when everything was read, and opens in `src/pilot/AgreementReview.tsx` only when something could not be read or is flagged. A CSV asks only for a carrier or date the file does not give. Each part of a PDF is checked against the prices printed in it; a short or failed part is read again as two halves, and pages still missing are named in the review (`src/pilot/agreementParts.ts`). Price tables, price lines and conditions are matched to the text layer, so a grid or item the model misread takes the printed values instead of being flagged, and each part's reply is cached by request hash per company (`agreement-part:` rows in `invoice_extracts`). A table priced by pallets or FTL is a grid, not parcel rates. The review blocks saving only on a field that is not a valid value and names its row and field (`src/pilot/rateDraft.ts`); yellow flags can be saved. They are rows in `price_agreements` (`server/price-agreements.sql`, `server/priceAgreements.ts`), read and written through `/api/price-agreements` per company; an admin sees every company. Prisaftaler lists only those rows (`companyAgreements`): a sample company's October rate file is not shown as an agreement. Slet asks for confirmation, deletes the row for that company, and deletes the company's `invoice_agreement_choices` rows that pointed at it, so those invoices match on their dates again. The same people who can add an agreement can delete one: an admin, or a seat on that company (`canManageAgreements`). Henrik creates that table. The app does not. Without it, agreements stay in the running container until it restarts. On load, agreements still in `localStorage` key `freightlytics-agreements` are imported once and the key is cleared when Postgres has them. A PDF agreement keeps the AI extract and the content as first read next to the edited content, like `invoice_checks`. A PDF agreement is format 2 (`src/pilot/agreementFormat.ts`): parcel rate rows plus price items, price grids, surcharges and conditions in `terms`. An invoice is checked against the agreement's parcel rate rows and, when the agreement has them, its price items, pallet grids, surcharges and fuel percentages (`src/pilot/termsAudit.ts`). Conditions stay on Prisaftaler. An invoice is matched to the agreement valid on its dates (`src/pilot/agreementDating.ts`). Each line uses its shipment date, or the invoice date. The candidates are the company's agreements with the invoice's carrier, historic ones included. An agreement is valid from `from` through `to`; an empty date is open, and an agreement ended by hand stops on that day. When several overlap, the latest start wins and the screen flags it. Lines are matched one by one, so an invoice that spans two periods is checked against both. A line with no valid agreement is not compared and shows "Ingen gyldig prisaftale", worded differently for a date before the first agreement and a gap between two agreements. A line dated after the end of the newest agreement holds the whole invoice: the viewer on Fakturaer and Nyt fakturatjek ask for the new agreement, with a Tilføj prisaftale button that has the carrier filled in. The invoice is matched again by itself once that agreement exists. A person can choose another agreement for the whole invoice. For a received or uploaded file, that choice is a row in `invoice_agreement_choices` (`server/invoice-agreement-choices.sql`, `server/agreementChoices.ts`, `/api/agreement-choices`). Henrik creates that table. The app does not. Without it, choices stay in the running container until it restarts. Nyt fakturatjek still takes another rate file, which then prices every line as before. The example on Overblik is fictional. Do not present a saved check as a live invoice or a carrier quote.

The upper right switches the six sample companies, plus any organization an admin has created. Opret organisation opens in a modal from the HG circle, and only an admin sees it. Log ud stays on that menu. The Pilot pill is not on that bar. Created organizations are rows in `companies` (`id`, `name`, `industry`, `place`), read and written through `/api/pilot-orgs` with the existing admin session. The app does not create that table. A person who is not an admin can switch the six sample companies and does not get create, rename, or delete. That is not Supabase Auth. A new organization has no October sample invoice, so the four screens stay and show an empty check. Each sample company in `src/pilot/orgs.ts` has an October 2026 invoice and rate file in the same columns as the check. Switching the company changes the figures on the screen. Benchmark shows how many of the other sample companies back each figure. The rows use the earlier carrier names: GLS, DHL, PostNord, Danske Fragtmænd, DSV, Bring, DAO, UPS, and Schenker. That is coverage, not a live market price. The name on the screen is Freightlytics. A visitor who is not signed in sees the full-width white Danish page. Log ind and Prøv vores demo open in modals on that page. That page has no language switch. Prøv vores demo writes a row in `notifications` for the admin to read after sign-in. No email is sent. Henrik creates that table. The app does not. If the table is missing, sign-in still opens and the demo form asks to try again. A received invoice mail also writes a `notifications` row with kind `invoice` (`server/notifications.ts`): the row id is the `invoice_mail` id, name is the carrier, company is the company id. The bell polls every 30 seconds. An admin reads every notice; a company seat reads only its own invoices. A failed notice does not fail the mail. A carrier format change writes an admin-only `notifications` row with kind `format_change` (`src/pilot/formatDrift.ts` detects, `server/formatAlerts.ts` stores): name is the carrier, company the company id, email the `invoice_mail` id, and the optional `detail` column (`server/format-alerts.sql`, Henrik runs it) says what changed. The detector takes a document kind; price agreements plug in through `observeDocument` with kind `agreement`. A company seat never reads that kind. Notifikationer (`#/notifikationer`, `src/pilot/notices.ts`) lists every notice, read or not, grouped by Copenhagen day. It opens from Se alle notifikationer in the bell. A card in the bell or on that page marks the notice read: an invoice switches to its organization and opens the mail on Fakturaer, and a demo request opens a reply mail. Indstillinger shows `{company id}@freightlytics.io` and a copy control for the signed-in company, and for the organization an admin has open. Inbound mail is received by the Cloudflare Email Worker on that domain. Attachments are rows in `invoice_mail` and `invoice_mail_files`, and the file bytes sit on that company id. Henrik creates those tables. The app does not. A missing table still shows the address and stores nothing. If a sample company id is not yet a row in `companies`, receiving mail inserts that row and stores the file on that id only. Any other recipient is rejected. The email handler returns to Cloudflare only after the mail row and a file row are confirmed on that company id in Postgres. A miss does not count as handled. A received row opens that company's stored PDF in the app. Each invoice on Fakturaer has a Check faktura button that opens its lines in an editor (`src/pilot/CheckEditor.tsx`, logic in `src/pilot/invoiceCheck.ts`). The checked lines replace the read values in the viewer and in Nyt fakturatjek. The original lines, who checked, and when are kept in `invoice_checks` (`server/invoice-check.sql`). Henrik creates that table. The app does not. Without it, checks stay in the running container until it restarts.

On the older customer overview (`AccountQuestions` in `src/components/AccountQuestions.tsx`), which is no longer the home screen:

- The three questions, in plain English, from that account's October 2026 lanes.
- Agreement means lanes whose cause is `contract` or `fuel`. The kroner gap there is "above the signed rates".
- Competitive still shows this account's sample fair price. The carrier list adds what the other fictional companies in the same trade pay on the same kind of route.
- Fit is `carrierFitIndex` in `src/data/fit.ts`. Score 0–100 mixes the payment model, the signed-rate gap, and that sample comparison. The line says how many similar companies prefer the carrier, and the kroner above what they pay. That kroner figure is an indication for a later renegotiation. The app does not send a tender.

The agreement overspend on the overview is a bar chart. A short note beside each bar that is over the signed rate names the kroner and the carrier to raise. Add an invoice on that chart and set the freight company. The bill total is drawn on that carrier's bar. A file is still a total plus that carrier. No OCR and no payment.

`InvoiceCheck` shows the agreement lines: invoiced, agreed, difference, "Raise with {carrier}", and a review of open objection or accepted. The review is `localStorage` key `fairlane-invoice-review`. An uploaded bill can be selected, but it was stored as a total only, so it has no line deviations. Nothing on the screen pays an invoice.

`src/data/carriers.ts` is the profile index. `src/data/questions.ts` derives the answers and the agreement lines from `portfolio.ts`. Do not add a parser behind those notes.

## What the product is

Fairlane is an account workspace. Each fictional company can see its own freight spend, a sample fair price, and the gap. Admins can open every company.

The latest sample month is October 2026 (`LATEST_MONTH` in `src/data/portfolio.ts`). The twelve months run from November 2025 through October 2026.

Keep the figures labeled as sample data. Do not present them as a live invoice, a contract, or a carrier quote.

## How to run

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5173
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run build` is `tsc -b && vite build`, then the migration script, which does nothing without `DATABASE_URL`. Oxlint warnings do not fail the lint script. `npm test` runs Vitest on the `*.test.ts` files next to the code they cover: the invoice check in `src/pilot/freight.ts`, CSV import in `src/pilot/csv.ts`, the sample orgs, bill parsing, the carrier index, session cookies and passwords in `server/`, invoice mail routing, PDF invoice extraction with a mocked model call, and the `/health` revision. Add a test beside pure logic you change. Check the UI in a browser.

GitHub Actions (`.github/workflows/ci.yml`) runs on every PR and push to main: typecheck, lint, test, and build, plus `wrangler deploy --dry-run`, which builds the Docker image and bundles the Worker without uploading. On a push to main it then runs `wrangler deploy`, only when the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set, and waits until `/health` answers the new revision. Without them the deploy job is skipped and says so. Bump `REVISION` in `deploy/revision.ts` when a deploy must restart the running container.

`freightlytics.io` is a separate deploy of this same server. The steps are in `DEPLOY.md`. Do not unpublish the Cursor app, and do not publish a second Cursor app to change the address. `DATABASE_URL` and `FRAGTBLIK_ADMIN_PASSWORD` stay out of git.

## Sign-in and who sees what

The screen opens on the signed-out page. Log ind opens in a modal. A visitor who is not signed in sees no kroner figures there. The shared username is admin. No password is written in source. When `FRAGTBLIK_ADMIN_PASSWORD` is set on the Worker, the Durable Object puts that trimmed secret on the login request, in the header and in the JSON. The server writes `users.password_hash` for username `admin` and then compares the password from the form field. A database error is not reported as a wrong password. If Postgres cannot be reached, that sign-in still uses the in-memory database. An older hash is not kept, and a different username is not used. A running container restarts when its image, its /health revision, or that secret's fingerprint changes. The value is not logged. The pilot login does not ask anyone to invent a password. If that env var is missing, sign-in fails. After startup, only the signed-in admin can change it from the app, and only by sending the current password. The server accepts the verified Cursor viewer with the owner's user id. Passwords are at least 8 characters, and repeated sign-in failures are limited. Sessions last 14 days, and changing a password ends that person's other sessions. A teammate, a company seat, or an anonymous request cannot create an admin or claim the admin account. The password is not written in source and is not returned by the API. Other people get a password only when an admin sets one on Users.

The session is an HTTP-only cookie checked against the `sessions` table. Do not put a password in source, in an API response, or in a prefilled field.

Routes:

| Path | Who |
| --- | --- |
| `/` | Welcome, or the admin list of all accounts, or a redirect to the signed-in company |
| `/customers/:id` | That company's overview |
| `/customers/:id/billing` | Statement for the month |
| `/customers/:id/billing/bills` | Add bills. `/customers/:id/bills` redirects here |
| `/customers/:id/users` | Sample seats plus people added on this browser |
| `/customers/:id/settings` | Account notes and the language switch |
| `/billing`, `/billing/bills`, `/users`, `/settings` | Same pages. A signed-in company is sent to its own path |

A signed-out visitor and a company opening another company's URL see no kroner figures. Gate this in `src/pages/AccountSpaces.tsx` (`Space`) and `src/pages/CustomerPage.tsx`.

Companies, in order: `nordhavn-living`, `vesterbro-cloth`, `kolding-table-co`, `horsens-gearworks`, `skive-plate-works`, `esbjerg-rig-supply`.

## Where the code lives

- `src/App.tsx` routes and providers (`LanguageProvider`, `SessionProvider`, `BillsProvider`, `PeopleProvider`).
- `src/data/portfolio.ts` fictional companies, months, lanes, causes, and `currentMonthTrack`. Do not write uploaded bills or added people into this file.
- `src/format.ts` Danish grouping and the `kr.` suffix. Whole kroner on screen.
- `src/session.tsx` signed-in user. `src/components/LoginPopup.tsx` is the corner popup: first-run admin password, then username and password. Log ind opens it and then submits it.
- `src/components/Sidebar.tsx` menu. `src/components/AccountMenu.tsx` upper-right sign-in. `src/components/Shell.tsx` frame.
- `src/pages/CustomerPage.tsx` overview, including the three questions and the invoice check. `src/pages/PortfolioPage.tsx` admin all-accounts view. `src/pages/AccountSpaces.tsx` billing, bills, users, settings.
- `src/data/carriers.ts` carrier profile index. `src/data/questions.ts` agreement lines and the three answers. `src/data/fit.ts` the 0–100 sample fit. `src/invoiceReview.tsx` sample review state. `src/components/AccountQuestions.tsx`, `src/components/AddInvoice.tsx`, and `src/components/InvoiceCheck.tsx`.
- `src/bills.tsx` plus `src/bills/parse.ts`, `read.ts`, `spend.ts`. UI in `src/components/BillDesk.tsx`.
- `src/people.tsx` and `src/components/UserDesk.tsx`.
- `src/index.css` is the only stylesheet. Navy sidebar `#0d2137`, white page.

## Language

Danish is the default. English is a setting on Settings and is stored on the signed-in user. Screen copy lives in `src/i18n/messages.ts`. Sample descriptions, lane services, and place names live in `src/i18n/content.ts` and stay English in the data files. Add both languages when a screen gains a sentence. Company names stay as written. Kroner keep Danish grouping in both languages.

The screen opens on the signed-out page. Log ind opens in a modal. A visitor who is not signed in sees no kroner figures there. The shared username is admin. Routes that read or change stored records still require a session. No password is written in source, returned by an API, or filled in on a sign-in screen. When `FRAGTBLIK_ADMIN_PASSWORD` is set on the Worker, the Durable Object puts that trimmed secret on the login request, in the header and in the JSON. The server writes `users.password_hash` for username `admin` and then compares the password from the form field. A database error is not reported as a wrong password. If Postgres cannot be reached, that sign-in still uses the in-memory database. An older hash is not kept, and a different username is not used. A running container restarts when its image, its /health revision, or that secret's fingerprint changes. The value is not logged. The pilot login does not ask anyone to invent a password. If that env var is missing, sign-in fails. After startup, changing it from the app requires the signed-in admin and the current password. The server accepts the verified Cursor viewer with the owner's user id. Passwords are at least 8 characters, and repeated sign-in failures are limited. Sessions last 14 days, and changing a password ends that person's other sessions. A teammate, a company seat, or an anonymous request cannot create an admin or claim the admin account. Other people get a password only when an admin sets one on Users. Companies, users, bills, invoice reviews, saved reports, and tender packs are in Postgres when `DATABASE_URL` is set, and in memory with PGlite when it is not. The sample companies, users, one bill, one saved report, and one tender comment load on an empty database. Do not print `DATABASE_URL`. ChatGPT sign-in and Supabase are not used.

## Bills

Bills are nested under Billing in the sidebar. The `+` opens a dialog anchored to that button with two choices: type the amount, or upload a file.

Accepted files: text PDF, CSV, and plain text, up to 8 MB. Parsing stays in the browser. A stated total (`i alt`, `total`, `at betale`, and the other words in `parse.ts`) wins. Otherwise money lines are summed and VAT lines are skipped. Danish `1.234,56` and English `1,234.56` both parse. A photo or a scanned page with no text layer is not read. The person types that amount.

Storage is `localStorage` key `fairlane-bills`, per customer id. Only the label, amount, freight company, source, and time are stored, not the file. A bill without a freight company is an older record and stays off the agreement chart.

`withBillSpend` adds the total to the latest month's freight spend. That total shows on:

- the billing statement
- the overview month-end spend, the paid figure, and the latest month card
- the admin all-accounts paid total

The sample savings gap does not grow by the bill amount. Savings stays `paid - benchmark` from `portfolio.ts`. Say so in the copy when a bill is included.

## People

`localStorage` key `fairlane-people`.

A company can add a person on its own account with role Owner, Billing, or Operations. An admin can add a person on a chosen customer account, or an admin. Added admins appear in the sign-in list and open every account. Sample seats on the Users page are not removable and cannot sign in.

## Layout that is already decided

Keep these unless the task changes them:

- Sidebar flush to the left edge, square corners, no page banner above it.
- The header in the sidebar is the word Fairlane only. No F square, and the customer name is not under the logo.
- The page title lines up with that word and with the account control on the upper right.
- Menu order: Overview, Billing with Bills underneath, Users. A cog at the bottom opens Settings.
- The sidebar collapses. The choice is `localStorage` key `fairlane-sidebar` (`collapsed` or `open`). Narrow screens start collapsed.
- Navy and white. Spend line uses `--ink`. The budget line is `#5d7c99` so the two lines differ.

## What not to add on your own

Do not add a database, a server, or an auth library for data that only needs to stay in this browser. `localStorage` and `sessionStorage` are the store.

Do not send bill files to a third party. The one exception Henrik approved is a PDF invoice read by Cloudflare Workers AI, described in `DEPLOY.md` under PDF-linjer. The code is in `src/pilot/invoiceExtract.ts`, `server/invoiceExtract.ts`, and the Durable Object. Its lines are a model extract with a sum check and a confidence. They are not a carrier parser. Do not `eval` file contents. Render names as text so React escapes them.

Do not invent companies, lanes, or kroner figures inside `portfolio.ts` to make a screen look fuller. The six companies are the whole sample set.
