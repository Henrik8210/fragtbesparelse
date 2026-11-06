# Fairlane

Fairlane shows what an ecommerce or manufacturing company pays for freight, what a fair benchmark for the same shipments would be, and the addressable savings in that gap.

This first version is a browser app with fictional companies and synthetic invoices. There is no login, no backend, and no live carrier connection. Nothing in the app is a real customer, a real invoice, or a real quote. Every screen says the figures are sample data.

Amounts are Danish kroner, written with Danish grouping, for example 1.000.000 kr.

## Install and run

Requires Node.js 20.19 or newer, or Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Vite prints a local URL, usually http://localhost:5173.

## Production build

```bash
npm run build
npm run preview
```

## Cloud Agent

`environment.json` at the repository root tells a Cloud Agent environment to run `npm install` after checkout.
