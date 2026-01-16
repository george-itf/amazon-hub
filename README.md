# Amazon Hub Brain

This repository contains a proof‑of‑concept implementation of the **Amazon Hub Brain** system described in the Invicta Tools & Fixings binder.  It is intended to serve as a starting point for a bespoke Shopify application that runs your Amazon operations.  The goal of this project is to provide a deterministic back office that:

* Resolves listing identities via ASIN/SKU/title fingerprints and short‑circuits known listings via a memory layer.
* Parses unknown listings into bill‑of‑materials (BOM) bundles or flags them for manual review.
* Persists components and bundles in a PostgreSQL database (via Supabase) and enforces exclusion constraints to prevent duplicate identities.
* Pulls open, unfulfilled orders from Shopify and translates them into component requirements for picking.
* Generates picklists grouped by component and location and produces profit metrics without influencing picking logic.
* Protects all endpoints behind Google‑based authentication and role enforcement.

This code base is split into two top‑level folders:

* `server/` – a Node.js/Express backend that exposes REST endpoints, integrates with Supabase, verifies Google tokens, interacts with the Shopify Admin API, and contains the core brain logic (memory resolution, parsing, review queue, picklist generation, etc.).  The server issues JWTs after successful login and enforces role‑based access on protected routes.
* `client/` – a React frontend built with Shopify Polaris that consumes the backend APIs and implements the UI described in the binder.  Pages include Dashboard, Orders, Picklists, Components, Bundles, Listings, Review, Replenishment and Profit.  A left‑hand navigation keeps the UX consistent with Shopify admin and the colour palette reflects Invicta’s brand (dark greys, strong contrast and red accents).

> **Important:** This repository is **not a drop‑in replacement** for the complete system described in the binder.  Rather, it demonstrates how to structure such a system and implements key patterns (authentication, database access, memory resolution, picklist generation).  You will need to finish the remaining parts (parsing logic, REVIEW feedback loop, profit calculations, SP‑API integration, mobile picking, etc.) and deploy to your own Supabase project and Shopify store.

## Getting started

1. Ensure Node.js ≥18.16 is installed.  Clone this repository and install dependencies:

   ```bash
   cd amazon_hub_brain
   npm install
   cd server && npm install && cd ..
   cd client && npm install && cd ..
   ```

2. Copy `.env.example` to `.env` in the root of the repository and fill in your secrets (Supabase URL/service key, Google OAuth client ID/secret, JWT secret, Shopify domain and token).  These variables are loaded by the server at runtime.

3. Apply the database migrations contained in `server/db/migrations.sql` to your Supabase project using the SQL editor.  The migration creates the `components`, `boms`, `listing_memory`, `review_queue`, `orders` and `order_lines` tables and sets up exclusion constraints on identity fields.

4. Launch the backend on port `3001`:

   ```bash
   cd server
   npm start
   ```

5. Launch the frontend on port `3000`:

   ```bash
   cd client
   npm start
   ```

6. Navigate to `http://localhost:3000` in your browser.  Log in via Google and begin exploring the Hub.  Initially the tables will be empty; you can create components, bundles and listings via the UI and the data will be persisted to Supabase.

## Key folders and files

### Server

* `index.js` – The entry point for the Express server.  Configures middleware (CORS, JWT authentication) and mounts routes.
* `routes/` – Route handlers for authentication (`auth.js`), components (`components.js`), bundles (`boms.js`), listings (`listings.js`), orders (`orders.js`), picklists (`picklists.js`) and the review queue (`review.js`).  Each file defines the HTTP endpoints and delegates business logic to service modules.
* `services/` – Encapsulated functions for interacting with Supabase (`supabase.js`), verifying Google tokens (`googleAuth.js`), fetching Shopify orders (`shopify.js`) and executing the brain logic (`brain.js`).  These services are imported by the route handlers.
* `utils/` – Utility functions for identity normalisation (`identityNormalization.js`), memory resolution (`memoryResolution.js`) and picklist generation (`picklist.js`).  These helpers keep the core logic testable and reusable.
* `db/migrations.sql` – SQL script to create all database tables and constraints.  Run this once against your Supabase project via the SQL editor.
* `.env.example` – Template for environment variables required by the server.  Copy to `.env` and populate for local development.

### Client

* `src/App.js` – React component that sets up routing and authentication context.  Defines the layout with a persistent left‑hand navigation and route outlets for each page.
* `src/index.js` – Entry point for the React application.  Wraps the app in Polaris `AppProvider` and a custom `AuthProvider`.
* `src/components/` – Shared UI components, such as `Nav.js` for the side navigation.
* `src/pages/` – Individual pages corresponding to major workflows: `Dashboard.js`, `OrdersPage.js`, `PicklistsPage.js`, `ComponentsPage.js`, `BundlesPage.js`, `ListingsPage.js`, `ReviewPage.js`, `ReplenishmentPage.js` and `ProfitPage.js`.  Each page fetches data from the backend and renders tables or forms using Polaris components.
* `src/utils/api.js` – Helper functions for making authenticated API calls to the backend (attaches JWT from local storage).
* `src/context/AuthContext.js` – React context that stores the current user and JWT.  Handles login via Google by hitting the `/auth/google` endpoint on the backend.
* `src/styles.css` – Global CSS overrides to align Polaris with Invicta’s branding (colour palette, typography, spacing).

## Next steps

This project lays the groundwork for the Amazon Hub Brain described in the binder.  To complete the system you should:

1. Implement the listing parser and AI‑driven BOM generator.  Unknown listings should be parsed to infer the required components or flagged for human review via the `/review` endpoints.
2. Build the REVIEW screen in the frontend to allow staff to resolve unknown listings and commit memory rules for future orders.
3. Add lead time, reorder point and supplier fields to the components table and implement the Replenishment planner.
4. Integrate with the Amazon Selling Partner API (SP‑API) to push stock quantities back to Amazon and reconcile fees for accurate profit reporting.
5. Harden authentication and authorisation: enforce staff roles, add CSRF protection, set secure cookie flags and support refresh tokens.
6. Write tests for the brain logic and endpoints to ensure determinism and reliability.

You now have a running starting point for the Amazon Hub Brain.  Extend it to meet your exact operational needs.  Good luck!