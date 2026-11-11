# Fragtblik for the next agent

Read this before changing the app. The product is a Vite + React + TypeScript single-page app. Sample freight figures live in source. Anything a person adds stays in the browser.

## Vision

Henrik and Jesper, 9 Nov 2026. The product answers three questions, in this order of work:

1. Are we paying what we agreed? Check invoices against the price agreement. Show each deviation in kroner and which lines to raise with the carrier. A logistics user reviews an objection before a bill is treated as accepted. That acceptance is a sample state. It does not pay anything.
2. Is the agreement competitive? The overview compares this account with the other fictional companies in the same trade, on similar routes. That comparison is sample data. A live market is later.
3. Which carriers fit our shipments? Each carrier on the account has a 0–100 sample fit for its payment model, plus how many of those similar companies prefer it. A one-line note per named carrier still describes the invoice shape. It is not a parser.

After a later tender, the chosen prices would become the next invoice-check baseline. That loop is not built.

Still out: tender sending, offer comparison, a live market feed, payments, bank calls, OCR, and real carrier parsers.

## What this slice does

On the customer overview (`AccountQuestions` in `src/components/AccountQuestions.tsx`):

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
npm run build
npm run lint
```

`npm run build` is `tsc -b && vite build`. Oxlint warnings do not fail the lint script. There is no test runner; check parsers with a small Node script and check the UI in a browser.

## Sign-in and who sees what

Sign-in is the app's own username and password. No password is written in source. On an empty database only the app owner can choose the admin password, and the server checks the verified Cursor viewer. A teammate or a company seat cannot claim it. Once that password exists, only the signed-in admin can change it, and only by sending the current password. The sign-in popup lets the app owner create a new user and sign in as that user. The server accepts the verified Cursor viewer with the owner's user id or email. A teammate, a company seat, or an anonymous request cannot create an admin or claim the admin account. The password is not written in source and is not returned by the API. Other people get a password only when an admin sets one on Users.

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

Sign-in is the app's own login. No password is written in source, returned by an API, or filled in on the sign-in screen. The first visit lets the app owner choose the admin password, and only a hash is stored. A teammate cannot claim that empty password. After that, changing it requires the signed-in admin and the current password. The sign-in popup lets the app owner create a new user and sign in as that user. The server accepts the verified Cursor viewer with the owner's user id or email. A teammate, a company seat, or an anonymous request cannot create an admin or claim the admin account. Other people get a password only when an admin sets one on Users. Companies, users, bills, invoice reviews, saved reports, and tender packs are in Postgres when `DATABASE_URL` is set, and in memory with PGlite when it is not. The sample companies, users, one bill, one saved report, and one tender comment load on an empty database. Do not print `DATABASE_URL`. ChatGPT sign-in and Supabase are not used.

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

Do not send bill files to a third party. Do not `eval` file contents. Render names as text so React escapes them.

Do not invent companies, lanes, or kroner figures inside `portfolio.ts` to make a screen look fuller. The six companies are the whole sample set.
