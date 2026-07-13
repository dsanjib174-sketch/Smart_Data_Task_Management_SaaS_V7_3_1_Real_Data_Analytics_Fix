Production migration process:

1. Run locally after schema changes:
   npx prisma migrate dev --name v7_1_operations_security

2. Commit the generated migration folder.

3. In production build use:
   npm install && npx prisma generate && npx prisma migrate deploy && npm run seed

The Render testing command may use `prisma db push --accept-data-loss`, but production should not.
