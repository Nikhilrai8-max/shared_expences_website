# SCOPE.md: Relational Database Schema & Anomaly Log

This document lists the relational database schema used in the application and provides a granular log of the data anomalies discovered in `shared_expenses_extended.csv` along with their resolution policies.

---

## Part 1: Relational Database Schema

We use **SQLite** as our relational database management system, configured through **Prisma ORM**. Below is the entity relationship definition:

### Database Models

1. **User**
   - Represents a flatmate or trip participant.
   - Schema:
     - `id`: Int (Primary Key, Autoincrement)
     - `name`: String (Unique) - e.g. "Aisha", "Rohan"
     - `email`: String (Optional)

2. **Group**
   - Represents a shared expenses group.
   - Schema:
     - `id`: Int (Primary Key, Autoincrement)
     - `name`: String (Unique) - e.g. "Flat", "Trip"
     - `description`: String (Optional)

3. **Membership**
   - Tracks group memberships over time, supporting flatmates joining/leaving.
   - Schema:
     - `id`: Int (Primary Key, Autoincrement)
     - `groupId`: Int (Foreign Key to `Group.id`, Cascade)
     - `userId`: Int (Foreign Key to `User.id`, Cascade)
     - `joinedAt`: DateTime - Joining date
     - `leftAt`: DateTime (Nullable) - Leaving date (null if active)
     - *Constraint*: Unique index on `(groupId, userId)`

4. **Expense**
   - Represents a standard shared expense.
   - Schema:
     - `id`: Int (Primary Key, Autoincrement)
     - `csvId`: Int (Nullable) - Stores original ID from CSV for auditing
     - `groupId`: Int (Foreign Key to `Group.id`, Cascade)
     - `description`: String
     - `amount`: Float - Store total cost
     - `currency`: String - Original currency (INR, USD, EUR)
     - `date`: DateTime - Transaction timestamp
     - `paidById`: Int (Foreign Key to `User.id`, Cascade)
     - `splitType`: String - EQUAL, PERCENTAGE, EXACT
     - `isSettlement`: Boolean (Default: false)
     - `status`: String (Default: APPROVED)

5. **Split**
   - Relational junction table detailing how each expense is split among participants.
   - Schema:
     - `id`: Int (Primary Key, Autoincrement)
     - `expenseId`: Int (Foreign Key to `Expense.id`, Cascade)
     - `userId`: Int (Foreign Key to `User.id`, Cascade)
     - `amount`: Float - The user's share in original currency
     - `percentage`: Float (Nullable) - Percentage share (if applicable)
     - *Constraint*: Unique index on `(expenseId, userId)`

6. **Settlement**
   - Tracks direct peer-to-peer payments.
   - Schema:
     - `id`: Int (Primary Key, Autoincrement)
     - `groupId`: Int (Foreign Key to `Group.id`, Cascade)
     - `fromUserId`: Int (Foreign Key to `User.id`, Cascade) - Sender
     - `toUserId`: Int (Foreign Key to `User.id`, Cascade) - Recipient
     - `amount`: Float - Settlement amount
     - `currency`: String
     - `date`: DateTime
     - `isApproved`: Boolean (Default: true)

7. **ImportAnomaly**
   - Persistent audit log of all spreadsheet import errors and their resolutions.
   - Schema:
     - `id`: Int (Primary Key, Autoincrement)
     - `csvRow`: Int - Row number in the CSV
     - `csvId`: String (Nullable)
     - `date`: String (Nullable)
     - `description`: String (Nullable)
     - `amount`: String (Nullable)
     - `currency`: String (Nullable)
     - `paidBy`: String (Nullable)
     - `splitType`: String (Nullable)
     - `participants`: String (Nullable)
     - `shares`: String (Nullable)
     - `groupName`: String (Nullable)
     - `issueType`: String - Category of the anomaly
     - `message`: String - Detailed detection explanation
     - `resolvedStatus`: String - PENDING, APPROVED, IGNORED
     - `proposedFix`: String (Nullable) - JSON text storing the resolved data

---

## Part 2: Granular Anomaly Log

Below is the complete log of the anomalies found in `shared_expenses_extended.csv` and how our importer handles them:

| Row | Anomaly Category | Details in CSV | Resolution Policy & Action Taken |
| :--- | :--- | :--- | :--- |
| **82** | `DUPLICATE_ROW` | Exact duplicate of row 81 (Grocery Shopping, 3200 INR by Rohan). | **Delete/Skip**: The importer proposes deleting the duplicate row. If approved, it is omitted from final ingestion. |
| **83** | `INVALID_DATE` | Date `2025-13-01` has month 13. | **Auto-Adjust**: Auto-correct month 13 to month 01 (`2025-01-01`) or allow manual override. |
| **84** | `INVALID_DATE` | Date `2025-02-30` (Feb has only 28/29 days). | **Clamp to Month-End**: Clamps date to the last day of February (`2025-02-28`). |
| **85** | `NEGATIVE_AMOUNT` | Amount is `-500` for Refund Electricity. | **Invert splits (Refund)**: Multiplied amount by -1 (making it `500` positive) and inverted the splits (payer becomes recipient, and participants owe negative, meaning they get credited). |
| **86** | `MISSING_PAYER` | Payer field is blank (`Movie Night`). | **Map Default/Prompt**: Defaults to a chosen member (e.g. Aisha) or requires manual input. |
| **87** | `UNKNOWN_PAYER` | Payer is `UnknownUser` (not a flatmate). | **Re-map User**: Prompts the user to map `UnknownUser` to Rohan or another active member. |
| **88** | `FOREIGN_CURRENCY` | Currency is `USD` (`Trip Hotel, 250 USD`). | **Currency Conversion**: Convert using exchange rate `1 USD = 83 INR`. |
| **89** | `FOREIGN_CURRENCY` & `PERCENTAGE` split | `USD` currency, split type `PERCENTAGE` with shares `40\|30\|20\|10`. | **Currency Conversion + Percent split**: Converts currency, calculates percentage shares, and saves to database. |
| **90** | `FOREIGN_CURRENCY` & `EXACT` split | `USD` currency, split type `EXACT` with shares `30\|30\|40\|20`. | **Currency Conversion + Exact split**: Converts currency and maps splits. |
| **91** | `FOREIGN_CURRENCY` | Currency is `EUR` (`European Hotel, 100 EUR`). | **Exchange Rate mapping**: Converts using `1 EUR = 90 INR`. |
| **92** | `UNKNOWN_CURRENCY` | Currency is `XYZ`. | **Fallback/Prompt**: Defaults rate to 1.0 (treating as INR) and alerts the user to confirm. |
| **93** | `SETTLEMENT_LOGGED_AS_EXPENSE` | Rohan paid 2000 INR to Aisha, logged as expense `Settlement To Aisha`. | **Re-classify as Settlement**: Instead of creating an Expense record, it creates a `Settlement` record in the database. |
| **94** | `SETTLEMENT_LOGGED_AS_EXPENSE` | Aisha paid 1500 INR to Priya, logged as expense `Transfer To Priya`. | **Re-classify as Settlement**: Creates a `Settlement` record in the database. |
| **95** | `PERCENTAGE_UNDER_100` | Percentage shares `40\|30\|20` sum to 90%. | **Scale to 100%**: Scales the shares to sum to 100% (re-calculates percentages). |
| **96** | `PERCENTAGE_OVER_100` | Percentage shares `50\|50\|50` sum to 150%. | **Scale to 100%**: Normalizes shares to equal 33.33% each. |
| **97** | `EXACT_SPLIT_SUM_MISMATCH` | Exact split shares sum to 600, total amount is 1000. | **Scale shares**: Re-proportions shares to sum to total amount. |
| **98** | `EMPTY_PARTICIPANTS` | Participants column is empty. | **Auto-Split**: Splits equally among all group members active on that date. |
| **99** | `SINGLE_PARTICIPANT_SELF` | Aisha splits 500 INR with Aisha only. | **Skip**: Flagged as a personal expense. Proposes skipping row. |
| **101** | `MISSING_DESCRIPTION` | ID 100 has an empty description. | **Auto-Fill**: Inserts default description `Expense Row 101`. |
| **102** | `DUPLICATE_ID` | Row 102 has ID 100, which was used by row 101. | **Auto Re-Index**: Database ignores CSV IDs as primary keys (uses autoincrement DB IDs) and logs the duplicate. |
| **105** | `NAME_FORMAT_NORMALIZATION` | Trailing space in payer `"Aisha "`. | **Normalize Name**: Trims space and saves as `"Aisha"`. |
| **106** | `NAME_FORMAT_NORMALIZATION` | Case variation in payer `"rohan"`. | **Normalize Casing**: Capitalizes name to `"Rohan"`. |
| **107** | `INVALID_SPLIT_TYPE` | Split type is `CUSTOM`. | **Default to EQUAL**: Re-maps split type to `EQUAL`. |
| **108** | `FUTURE_DATE` | Date `2030-01-01` is in the future. | **Reset Date**: Reset to current date. |
| **109** | `PARTICIPANT_OUT_OF_BOUNDS` | Sam is in an expense dated `2025-03-20` (joined mid-April). | **Exclude Out-of-bounds**: Sam is removed from participants; cost is split only among active members on that date (Aisha, Rohan). |
| **110** | `PARTICIPANT_OUT_OF_BOUNDS` | Meera is in an expense dated `2025-04-30` (left end of March). | **Exclude Out-of-bounds**: Meera is removed from participants; cost is split only among active members on that date. |
| **111** | `ZERO_AMOUNT` | Amount is 0. | **Skip**: Skips row or logs as zero-cost. |
