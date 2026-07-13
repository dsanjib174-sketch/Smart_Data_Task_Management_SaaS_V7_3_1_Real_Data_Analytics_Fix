const express = require('express');
const prisma = require('../config/prisma');
const { hashPassword } = require('../utils/auth');
const { requireAuth, requireSmartData } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth, requireSmartData);

function invoiceNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const ts = `${d.getTime()}`.slice(-6);
  return `SD/${y}${m}/${ts}`;
}

async function createSubscriptionInvoice(tenantId, planId) {
  if (!tenantId || !planId) return null;
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) return null;
  const amount = Number(plan.price || 0);
  const gstRate = 18;
  const gstAmount = Math.round(amount * gstRate) / 100;
  const totalAmount = amount + gstAmount;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 7);
  return prisma.subscriptionInvoice.create({
    data: {
      tenantId,
      planId,
      invoiceNo: invoiceNumber(),
      amount,
      gstRate,
      gstAmount,
      totalAmount,
      dueDate
    }
  });
}

router.get('/', async (req, res) => {
  const [clients, users, tasks, complaints, invoices] = await Promise.all([
    prisma.tenant.count(),
    prisma.user.count(),
    prisma.task.count(),
    prisma.complaint.count(),
    prisma.subscriptionInvoice.count()
  ]);
  res.render('superadmin/dashboard', { title: 'Super Admin Dashboard', stats: { clients, users, tasks, complaints, invoices } });
});

router.get('/company', async (req, res) => {
  const company = await prisma.companySetting.upsert({
    where: { id: 'SMART_DATA' },
    update: {},
    create: { id: 'SMART_DATA', companyName: 'Smart Data', country: 'India' }
  });
  res.render('superadmin/company', { title: 'Smart Data Company Profile', company });
});

router.post('/company', async (req, res) => {
  const data = {
    companyName: req.body.companyName,
    legalName: req.body.legalName || null,
    gstNumber: req.body.gstNumber || null,
    panNumber: req.body.panNumber || null,
    address: req.body.address || null,
    city: req.body.city || null,
    state: req.body.state || null,
    pincode: req.body.pincode || null,
    country: req.body.country || 'India',
    email: req.body.email || null,
    phone: req.body.phone || null,
    website: req.body.website || null,
    bankName: req.body.bankName || null,
    accountName: req.body.accountName || null,
    accountNo: req.body.accountNo || null,
    ifscCode: req.body.ifscCode || null,
    upiId: req.body.upiId || null,
    logoUrl: req.body.logoUrl || null
  };
  await prisma.companySetting.upsert({ where: { id: 'SMART_DATA' }, update: data, create: { id: 'SMART_DATA', ...data } });
  res.redirect('/superadmin/company');
});

router.get('/clients', async (req, res) => {
  const [clients, plans] = await Promise.all([
    prisma.tenant.findMany({ include: { plan: true, invoices: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { createdAt: 'desc' } }),
    prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { price: 'asc' } })
  ]);
  res.render('superadmin/clients', { title: 'Client Management', clients, plans });
});

router.post('/clients/create', async (req, res) => {
  const { companyName, contactName, email, phone, planId, status, gstNumber, panNumber, billingAddress, city, state, pincode } = req.body;
  const client = await prisma.tenant.create({
    data: {
      companyName,
      contactName: contactName || null,
      email,
      phone: phone || null,
      gstNumber: gstNumber || null,
      panNumber: panNumber || null,
      billingAddress: billingAddress || null,
      city: city || null,
      state: state || null,
      pincode: pincode || null,
      planId: planId || null,
      status: status || 'TRIAL'
    }
  });
  if (planId) await createSubscriptionInvoice(client.id, planId);
  res.redirect('/superadmin/clients');
});

router.post('/clients/:id/generate-invoice', async (req, res) => {
  const client = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (client?.planId) await createSubscriptionInvoice(client.id, client.planId);
  res.redirect('/superadmin/invoices');
});

router.get('/plans', async (req, res) => {
  const plans = await prisma.subscriptionPlan.findMany({ orderBy: { price: 'asc' } });
  res.render('superadmin/plans', { title: 'Subscription Plans', plans });
});

router.get('/invoices', async (req, res) => {
  const invoices = await prisma.subscriptionInvoice.findMany({ include: { tenant: true, plan: true }, orderBy: { createdAt: 'desc' } });
  const company = await prisma.companySetting.findUnique({ where: { id: 'SMART_DATA' } });
  res.render('superadmin/invoices', { title: 'Subscription Invoices', invoices, company });
});

router.get('/invoices/:id', async (req, res) => {
  const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: req.params.id }, include: { tenant: true, plan: true } });
  const company = await prisma.companySetting.findUnique({ where: { id: 'SMART_DATA' } });
  if (!invoice) return res.status(404).send('Invoice not found');
  res.render('superadmin/invoice-view', { title: `Invoice ${invoice.invoiceNo}`, invoice, company });
});

router.get('/users', async (req, res) => {
  const [users, roles, tenants] = await Promise.all([
    prisma.user.findMany({ include: { role: true, tenant: true }, orderBy: { createdAt: 'desc' } }),
    prisma.role.findMany({ orderBy: [{ scope: 'asc' }, { name: 'asc' }] }),
    prisma.tenant.findMany({ orderBy: { companyName: 'asc' } })
  ]);
  res.render('superadmin/users', { title: 'User Management', users, roles, tenants });
});

router.post('/users/create', async (req, res) => {
  const { name, email, phone, designation, department, password, roleId, tenantId, status } = req.body;
  const hashedPassword = await hashPassword(password || 'User@12345');
  await prisma.user.create({
    data: { name, email, phone, designation, department, password: hashedPassword, roleId: roleId || null, tenantId: tenantId || null, status: status || 'ACTIVE' }
  });
  res.redirect('/superadmin/users');
});

router.post('/users/:id/status', async (req, res) => {
  await prisma.user.update({ where: { id: req.params.id }, data: { status: req.body.status } });
  res.redirect('/superadmin/users');
});

module.exports = router;
