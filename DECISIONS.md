# DECISIONS.md: Shared Expenses App Decision Log

This document details the key technical design decisions made during the development of the Shared Expenses application.

---

## 1. Project Architecture
* **Decision**: Split Mono-repo (React.js Frontend + Express.js Backend + Prisma + SQLite).
* **Options Considered**:
  1. *Next.js (App Router)*: Initially planned, but changed to fulfill the explicit user directive: "i want to make using reactjs insted of nextjs".
  2. *Single-page React App with Client-side Database (SQL.js)*: Fails relational DB requirements if local persistence across restarts/different browsers is needed.
  3. *Vite + React (Frontend) & Express + Prisma + SQLite (Backend)*: Chosen.
* **Rationale**: Relational databases must reside on a backend server to support multi-user operations. Vite provides a modern, fast React compilation workflow. Prisma provides relational schema type-safety and migrations on top of SQLite, ensuring zero database installation friction for local testing.

---

## 2. Interactive CSV Importer (Meera's Request)
* **Decision**: Staged Import with Frontend Approvals.
* **Options Considered**:
  1. *Fail on first anomaly*: Very poor user experience.
  2. *Silent Correction (Auto-guessing)*: Violates Meera's request: "I want to approve anything the app deletes or changes."
  3. *Staged Ingestion Dashboard*: Chosen.
* **Rationale**: When the CSV is uploaded, the backend scans it, detects all anomalies, logs them in a staging table (`ImportAnomaly`), and sends the staging state back to the UI. The user is presented with a detailed list of errors (e.g. duplicates, date errors, splits) and can click **Approve** (use proposed correction), **Ignore** (skip row), or **Modify** (inline edit) before finalizing ingestion.

---

## 3. Date-Aware Membership History (Sam's Request)
* **Decision**: Membership table with `joinedAt` and `leftAt` dates.
* **Options Considered**:
  1. *Static group list*: Simple, but causes new members to split old bills (violating Sam's request).
  2. *Timestamped Membership Windows*: Chosen.
* **Rationale**: We define membership as an entity with start and end dates. When importing or logging an expense on date $D$, the system checks the membership timeline. If a participant was not a member on date $D$, they are excluded from the split.

---

## 4. Multi-Currency Normalization (Priya's Request)
* **Decision**: Double-Entry Storage with Single Base Currency (`INR`) conversion.
* **Options Considered**:
  1. *Keep currencies separated*: Requires settling debts in USD, EUR, and INR separately, which complicates simplified balances.
  2. *Normalize to a single base currency (INR)*: Chosen.
* **Rationale**: We store the original amount and currency of the transaction in the DB for auditability (satisfying Rohan's ledger view) but perform all ledger calculations, group balances, and peer-to-peer settlements in a base currency of `INR` using fixed historical exchange rates (1 USD = 83 INR, 1 EUR = 90 INR).

---

## 5. Peer-to-Peer Debt Simplification (Aisha's Request)
* **Decision**: Greedy Balance-Matching Algorithm.
* **Options Considered**:
  1. *Direct splits*: Everyone pays each other directly, leading to dozens of confusing transactions.
  2. *Simplify debts*: Net balance minimization. Chosen.
* **Rationale**: Calculates the net balance of all group members (Paid - Owed). It splits them into debtors (balance < 0) and creditors (balance > 0). It then matches the biggest debtor with the biggest creditor iteratively, minimizing overall transaction overhead.

---

## 6. Granular Ledger Audit Trail (Rohan's Request)
* **Decision**: Chronological Itemized Ledger.
* **Options Considered**:
  1. *Display only net totals*: Fails Rohan's request: "No magic numbers."
  2. *Granular Ledger*: Chosen.
* **Rationale**: We construct an itemized ledger showing every expense the user paid or participated in, detailing the description, currency, exchange rate, paid share, owed share, net impact, and a running balance, letting the user trace their balance down to the single paisa.

---

## 7. Aesthetic Direction (No Rounded Corners)
* **Decision**: Boxy Brutalist Terminal Style.
* **Options Considered**:
  1. *Vibrant Glassmorphic theme*: Relies on rounded corners.
  2. *High-contrast boxy cyberpunk style*: Chosen.
* **Rationale**: The user explicitly requested "don't use rounded corners". We applied a flat, boxy layout with solid 2px borders, sharp solid drop-shadow offsets, neon text glows, and strictly `border-radius: 0px !important;` across all elements.
