# Altura Accounting

A fund deployment tracking application with 0.5% weekly compound interest calculation.

## Features

- Role-based access via Supabase Auth (admins + read-only company users)
- Admin panel to create **companies (clients)** and **users**, with each user assigned to a company
- Deposits are assigned to a company, **defaulting to Altura** (set as a database-level default)
- Admins manage all companies; regular users get a read-only view of their own company
- Automatic 0.5% weekly compound interest calculation
- Interest only accrues after the first complete Monday-Sunday week
- Dashboard with real-time portfolio value display
- Public API endpoint with CORS support for totals + deposits data

## Roles & Data Model

- **clients** — companies. Seeded with **Altura** at a fixed id (`00000000-0000-0000-0000-000000000001`).
- **profiles** — one per auth user: `role` (`admin` | `user`) + `client_id` (their company).
- **deposits / closures** — gain a `client_id` column that **defaults to Altura**.
- **RLS** — admins can read/write everything; regular users can only read rows for their assigned company.
- Public sign-up is disabled — admins create all accounts from the admin panel.

## Interest Calculation

The application calculates 0.5% compound interest per complete week:

- Interest starts after the first complete Monday-Sunday week following the deposit
- Example: If you deposit on Tuesday, Jan 13th:
  - First coming Monday: Jan 19th
  - Interest starts (2nd coming Monday): Jan 26th
- Formula: `Current Value = Principal × 1.005^weeks`

## Setup

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your project URL and anon key from Settings > API

### 2. Set up the Database

Import the SQL provided by the team into your Supabase project. In the Supabase
SQL Editor, run the files in `database/` **in sequence**:

1. `database/01_db_schema.sql` — extension, enum, functions, tables, indexes, and RLS.
2. `database/02_clients_rows.sql` — seed company/client rows.
3. `database/03_accounting_users_rows.sql` — seed accounting user rows.
4. `database/04_deposits_rows.sql` — seed deposit rows.
5. `database/05_deposit_interest_accruals_rows.sql` — seed interest-accrual trail rows.
6. `database/06_post_import.sql` — **run last**, after all data is imported; installs the deposit triggers and the weekly `pg_cron` job.

### 3. Configure Environment Variables

Create a `.env.local` file in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
PUBLIC_API_CORS_ORIGINS=*
```

`PUBLIC_API_CORS_ORIGINS` accepts either `*` or a comma-separated allowlist:
`https://your-site.com,https://dashboard.your-site.com`

`SUPABASE_SERVICE_ROLE_KEY` is required by the server API route and must never be exposed to the client.

### 4. Install Dependencies & Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

### 5. Create the First Admin

Public sign-up is disabled, so bootstrap the first admin with the seed script
(uses the service role key from `.env.local`):

```bash
node --env-file=.env.local scripts/seed-admin.mjs
```

This creates `stark@altura.trade` (role `admin`, company Altura) with a temporary
password printed to the console. Override the defaults if needed:

```bash
ADMIN_EMAIL=stark@altura.trade ADMIN_PASSWORD='YourStrongPass!' \
  node --env-file=.env.local scripts/seed-admin.mjs
```

Then log in and use the **Admin** panel (top-right of the dashboard) to:

- **Add companies** (clients)
- **Add users** — set each user's role and assign them to a company. Regular users
  get a read-only view of their company's deposits.

When adding a deposit, the company dropdown defaults to **Altura**.

## Public API

Single endpoint for totals, deposit rows, and related metrics:

`GET /api/deposits`

Example:

```bash
curl "http://localhost:3000/api/deposits"
```

Response includes:

- `scope`: `all_users`
- `totals`: `principal`, `currentValue`, `interest`
- `stats`: `depositCount`, `averageDeposit`, `firstDepositDate`, `latestDepositDate`
- `deposits`: each deposit with amount, interest, current value, weeks earned, and key date milestones

## Tech Stack

- **Frontend**: Next.js 16 (App Router)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Styling**: Tailwind CSS

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Login page (sign-in only)
│   ├── dashboard/page.tsx      # Main dashboard (role-aware)
│   ├── admin/page.tsx          # Admin panel: companies + users
│   ├── api/admin/users/        # Service-role user create/delete
│   └── globals.css             # Tailwind styles
├── components/
│   ├── AuthGuard.tsx           # Protected route wrapper
│   ├── DepositForm.tsx         # Add deposit (company dropdown)
│   ├── DepositTable.tsx        # Deposits table (read-only mode)
│   └── ClosedPositionsTable.tsx
└── lib/
    ├── supabase.ts             # Browser client + types + ALTURA_CLIENT_ID
    ├── supabase-admin.ts       # Service-role client + admin guard
    ├── useProfile.ts           # Hook: current user's role + company
    └── interest.ts             # Interest calculation utilities

supabase/
└── accounting-project/         # Full schema for the dedicated Accounting DB
    ├── 01_schema.sql           # tables, RLS, interest fns + accrual trail
    ├── 02_post_import.sql      # deposit triggers + weekly pg_cron job
    └── 03_interest_trail.sql   # standalone interest-trail apply (already-live DB)

scripts/
└── seed-admin.mjs              # Bootstrap the first admin user
```
