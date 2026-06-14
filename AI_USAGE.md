# AI_USAGE.md: AI Tooling & Debugging Log

This document lists the AI tools used during development, key prompts, and three concrete instances where the AI generated incorrect code, how it was caught, and the manual changes implemented.

---

## 1. AI Tools Used
* **Primary AI Assistant**: Gemini 3.5 Flash (Medium).
* **Usage**: Pair programmer for scaffolding the Vite + Express structure, Prisma database design, testing, and Vanilla CSS styles.

---

## 2. Key Prompts Used
1. *Scaffolding*: "Initialize a Vite + React frontend in a client directory and an Express server in a server directory."
2. *Relational Schema*: "Create a Prisma schema for SQLite modeling Users, Groups, Memberships, Expenses, Splits, Settlements, and ImportAnomalies."
3. *CSV Analysis*: "Write a JavaScript parser that scans a CSV file and runs validation checks for negative amounts, duplicates, date issues, casing, and membership limits."

---

## 3. Concrete Cases of AI Errors & Corrections

### Case 1: Prisma SQLite Decimal Type Support
* **The Error**: The AI initially generated `Decimal` types for `amount` fields in the `Expense` and `Split` models of `schema.prisma` (e.g. `amount Decimal`).
* **How it was caught**: Running `npx prisma db push` threw a schema compilation error stating that SQLite does not support native decimal fields and recommended using `Float` or database-specific float representations.
* **What was changed**: We modified the database schema definitions in `schema.prisma` to use the SQLite-compatible `Float` type for all financial amount fields, rounding all final sums to two decimal places in the JS calculation service to prevent float representation drifts.

### Case 2: Double-Counting Splits in Net Balances
* **The Error**: The AI's balance calculation script did not distinguish between normal expenses and settlements, treating settlements as standard group expenses which skewed the final net balances. It also double-counted the user's split shares in their net balance.
* **How it was caught**: Running the automated test script `node server/test-import.js` showed that Rohan's and Aisha's balances did not match our manual test calculations. Rohan's direct settlement of 2000 INR was not reducing his debt.
* **What was changed**: We rewrote the balance calculator in `calculations.js` to split calculations into two distinct phases:
  1. Calculate expenses by summing `Paid - Owed` (using splits).
  2. Calculate settlements separately, updating balances as `+ Settlements Sent - Settlements Received`.
  This yielded the correct mathematical net balance.

### Case 3: Date Parsing Timezone Shifts
* **The Error**: The AI parsed date strings from the CSV (like `2025-02-01`) using `new Date(row.date)`.
* **How it was caught**: When querying the database, dates were stored as UTC timestamps representing the previous day's evening (e.g. `2025-01-31T18:30:00.000Z`) due to the local machine timezone offset (IST, GMT+5:30). This caused boundary errors in group membership checks; Meera's last-day expenses on March 31 were shifted to April in UTC, throwing false-positive out-of-bounds membership anomalies.
* **What was changed**: We updated the date parsing helper to force UTC ISO-8601 formatting: `new Date(`${row.date}T00:00:00Z`)`. This ensures dates are evaluated at the exact UTC date boundaries, keeping membership checks robust and consistent.
