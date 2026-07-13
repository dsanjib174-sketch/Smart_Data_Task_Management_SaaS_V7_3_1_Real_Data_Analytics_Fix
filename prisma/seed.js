require('dotenv').config();
const prisma = require('../src/config/prisma');
const { hashPassword } = require('../src/utils/auth');

async function main() {
  const roles = [
    { name: 'SUPER_ADMIN', scope: 'SMART_DATA', permissions: ['ALL'] },
    { name: 'SMART_DATA_ADMIN', scope: 'SMART_DATA', permissions: ['CLIENTS','SUPPORT','BILLING','USERS','INTERNAL_TASKS'] },
    { name: 'SUPPORT', scope: 'SMART_DATA', permissions: ['SUPPORT','TASKS','INTERNAL_TASKS'] },
    { name: 'DEVELOPER', scope: 'SMART_DATA', permissions: ['DEVELOPMENT','SUPPORT','INTERNAL_TASKS'] },
    { name: 'ACCOUNTS', scope: 'SMART_DATA', permissions: ['BILLING','INVOICES','INTERNAL_TASKS'] },
    { name: 'SALES', scope: 'SMART_DATA', permissions: ['CLIENTS','SUBSCRIPTIONS','INTERNAL_TASKS'] },
    { name: 'QA', scope: 'SMART_DATA', permissions: ['TESTING','INTERNAL_TASKS'] },
    { name: 'CLIENT_ADMIN', scope: 'CLIENT', permissions: ['DASHBOARD','TASKS','USERS','QR','REPORTS','ANALYTICS','PM'] },
    { name: 'MANAGER', scope: 'CLIENT', permissions: ['DASHBOARD','TASKS','REPORTS','ANALYTICS'] },
    { name: 'EMPLOYEE', scope: 'CLIENT', permissions: ['DASHBOARD','TASKS','COMPLAINTS'] },
    { name: 'VIEWER', scope: 'CLIENT', permissions: ['DASHBOARD','VIEW'] }
  ];

  for (const r of roles) {
    await prisma.role.upsert({ where: { name_scope: { name: r.name, scope: r.scope } }, update: { permissions: r.permissions }, create: r });
  }

  const plans = [
    { name: 'Trial', price: 0, durationDays: 7, maxUsers: 6, maxTasks: 100, isActive: true },
    { name: 'Basic', price: 999, durationDays: 30, maxUsers: 10, maxTasks: 1000, isActive: true },
    { name: 'Standard', price: 2499, durationDays: 30, maxUsers: 50, maxTasks: 10000, isActive: true },
    { name: 'Enterprise', price: 9999, durationDays: 30, maxUsers: 500, maxTasks: 100000, isActive: true }
  ];

  for (const p of plans) {
    await prisma.subscriptionPlan.upsert({ where: { name: p.name }, update: p, create: p });
  }

  await prisma.companySetting.upsert({
    where: { id: 'SMART_DATA' },
    update: {},
    create: {
      id: 'SMART_DATA',
      companyName: process.env.SMARTDATA_COMPANY_NAME || 'Smart Data',
      legalName: process.env.SMARTDATA_LEGAL_NAME || 'Smart Data Task Management',
      email: process.env.SMARTDATA_EMAIL || 'admin@smartdata.local',
      phone: process.env.SMARTDATA_PHONE || '',
      country: 'India'
    }
  });

  await prisma.passwordPolicy.upsert({
    where: { id: 'DEFAULT' },
    update: {},
    create: {
      id: 'DEFAULT',
      minLength: Number(process.env.PASSWORD_MIN_LENGTH || 8),
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSpecial: false,
      expiryDays: 90,
      maxFailedAttempts: 5
    }
  });

  const superAdminRole = await prisma.role.findUnique({ where: { name_scope: { name: 'SUPER_ADMIN', scope: 'SMART_DATA' } } });
  const email = process.env.SUPERADMIN_EMAIL || 'admin@smartdata.local';
  const password = process.env.SUPERADMIN_PASSWORD || 'Admin12345';
  const hashedPassword = await hashPassword(password);

  await prisma.user.upsert({
    where: { email },
    update: { name: process.env.SUPERADMIN_NAME || 'Smart Data Super Admin', password: hashedPassword, roleId: superAdminRole.id, status: 'ACTIVE' },
    create: { name: process.env.SUPERADMIN_NAME || 'Smart Data Super Admin', email, password: hashedPassword, roleId: superAdminRole.id, status: 'ACTIVE' }
  });

  console.log(`Seed completed. Login: ${email} / ${password}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => prisma.$disconnect());
