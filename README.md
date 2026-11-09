# Fairlane

Fairlane shows what an ecommerce or manufacturing company pays for freight, what a fair benchmark for the same shipments would be, and the addressable savings in that gap.

The product is meant to answer three questions: are we paying what we agreed, is the agreement competitive, and which carriers fit the shipments. This version answers them from sample figures on each account. It also checks one sample invoice against a sample agreement. Tender packs, offer comparison, payments, OCR, and real carrier parsers are later.

The companies and their invoices are fictional. There is no password, no backend, and no live carrier connection. Nothing in the app is a real customer, a real invoice, or a real quote. Screens say when a figure is sample data.

A person signs in from the upper right as one company or as a Fairlane admin. A company sees only its own account. An admin can open every account. Bills and people added in the app stay in that browser.

Amounts are Danish kroner, written with Danish grouping, for example 1.000.000 kr.

For the map of the code, the routes, and the rules for changing spend, see [AGENTS.md](AGENTS.md).

## Install and run

Requires Node.js 20.19 or newer, or Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Vite prints a local URL, usually http://localhost:5173.

```bash
npm run build
npm run preview
npm run lint
```

## Cloud Agent

`environment.json` at the repository root tells a Cloud Agent environment to run `npm install` after checkout.
