# Shared Expenses Tracker (Brutalist boxy Edition)

A professional React + Node/Express shared expenses web application built for a group of 6 flatmates (Aisha, Rohan, Priya, Meera, Sam, Dev) to ingest their messy historical spreadsheet, resolve anomalies interactively, track balance ledgers, and minimize peer-to-peer debts.

Designed with a bright, modern aesthetic and clean rounded components.

---

## 🛠️ Stack & Architecture

- **Frontend**: React (Vite-based Single Page App) styled with Vanilla CSS.
- **Backend**: Node.js & Express API server.
- **Database**: PostgreSQL managed via Prisma ORM (stable deployment-ready).
- **Math Engine**:
  - Net balance tracking with multi-currency conversion to base `INR` (using rates: 1 USD = 83 INR, 1 EUR = 90 INR).
  - Date-aware membership validation preventing timeline violations.
  - Splitwise-style greedy debt minimization algorithm.
  - Granular itemized ledger audit trail.

---

## 🚀 Quick Start Instructions

Follow these steps to run the application locally on Windows. Make sure you have **Node.js (v18+)** and **npm** installed.

### 1. Install Dependencies
Run the installation script from the root directory to install both frontend and backend packages:
```bash
npm run install:all
```

### 2. Initialize Database & Seed
Set up PostgreSQL locally or via a hosted provider, then set `DATABASE_URL` before initializing.

For local development with Postgres, create a `.env` file inside `server/` and add:
```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/spreetail"
JWT_SECRET="a-strong-secret"
```

Then run:
```bash
cd server
npm run db:migrate
npm run db:seed
```

### 3. Run the Servers Concurrently
Start the Express API server (port 5000) and Vite React client (port 5173):
- **Terminal 1 (Start Backend)**:
  ```bash
  npm run start:server
  ```
- **Terminal 2 (Start Frontend)**:
  ```bash
  npm run start:client
  ```

Once both are running, open your browser and navigate to:
👉 **[http://localhost:5173](http://localhost:5173)**

---

## 🧪 Verification & Automated Testing

You can verify the database transactions, currency conversions, and debt minimizer calculations programmatically on the real spreadsheet by running the automated test script:

```bash
node server/test-import.js
```

This script will:
1. Parse `shared_expenses_extended.csv` from the root workspace.
2. Run validation checks to detect all 20 anomalies.
3. Simulate user-approved ingestion.
4. Log database transactions.
5. Calculate and print group balances and simplified debt checklists in terminal tables.

---

## 📂 Core Project Layout

- `/client` - React frontend application.
  - `/client/src/App.jsx` - Primary React component containing dashboard views, ledger tables, and importer controls.
  - `/client/src/index.css` - Global Vanilla CSS design system (strictly `border-radius: 0px`).
- `/server` - Express backend API server.
  - `/server/index.js` - API routing and controller endpoints.
  - `/server/prisma/schema.prisma` - SQLite database schema definition.
  - `/server/services/importer.js` - CSV parsing and 18+ anomaly checking logic.
  - `/server/services/calculations.js` - Multi-currency net balances, debt minimizer, and ledger audit builder.
  - `/server/test-import.js` - Programmatic verification suite.
- `shared_expenses_extended.csv` - The original export containing deliberate data problems.
- `SCOPE.md` - Entity Relationship database schema and 20-anomaly log.
- `DECISIONS.md` - Technical choices, options considered, and design rationales.
- `AI_USAGE.md` - AI tool log and detailed debugging case studies.
