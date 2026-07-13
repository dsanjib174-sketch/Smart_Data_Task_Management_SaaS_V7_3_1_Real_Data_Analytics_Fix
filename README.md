# Smart Data Task Management SaaS V7.3.1

## Real Data Analytics Fix Edition

Features:
- Individual tenant dashboard
- Client Admin employee user creation
- Email or User ID login
- Trial/free plan supports 6 active users
- Plan-wise user limits
- Reporting Manager and Escalation Manager hierarchy
- Client Admin sees all company data
- Manager sees direct and indirect reportees
- Employee sees own created/assigned tasks
- Tenant-specific SLA, KPI and escalation analytics
- CSV/Excel export and presentation/PDF print view
- Role-specific client navigation
- Strict tenant filtering

## Render Build Command
```bash
npm install && npx prisma generate && npx prisma db push --accept-data-loss && npm run seed
```

## Start Command
```bash
npm start
```

For production with real data, replace `db push --accept-data-loss` with versioned Prisma migrations.


## Analytics corrections in V7.3.1
- Removed all demo PM health, root-cause, sales funnel, device-type, login, cost and duration values.
- Charts now use live PostgreSQL/Prisma records only.
- Cancelled tasks are excluded from SLA, KPI, productivity, aging, priority and department calculations.
- Cancelled tasks remain visible only in Task Status reporting.
- Empty datasets display “No data available” instead of invented numbers.
- PM Health is calculated from actual PreventiveMaintenance records.
- Sales Funnel is calculated from tenants and paid invoices.
- CSAT remains 0 until a real rating field/module is added.
