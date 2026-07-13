V7.3.2 Internal + Client QR Patch

Replace these exact files in your GitHub project:
1. prisma/schema.prisma
2. src/routes/qrLocations.js
3. src/routes/complaints.js
4. views/qr/locations.ejs
5. views/qr/complaint_form.ejs

What changes:
- Super Admin/Smart Data users can create Smart Data Internal QR codes.
- Client QR creation remains available.
- Internal QR submissions create InternalTask records.
- Client QR submissions create Complaint records.
- Public users do not need to log in.
- Tenant isolation is preserved.

After replacing the files, deploy with:
npm install && npx prisma generate && npx prisma db push --accept-data-loss && npm run seed

After the schema is updated successfully, use migrations for production instead of --accept-data-loss.
