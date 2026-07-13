const express = require('express');
const prisma = require('../config/prisma');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth);

function isSmartDataUser(req) {
  return req.user.role?.scope === 'SMART_DATA';
}

function maintenanceWhere(req) {
  if (isSmartDataUser(req)) return {};
  return { tenantId: req.user.tenantId };
}

function validateScheduleAccess(req, schedule) {
  if (isSmartDataUser(req)) return true;
  return schedule.tenantId === req.user.tenantId;
}

router.get('/', async (req, res) => {
  const isSmartData = isSmartDataUser(req);
  const tenants = isSmartData
    ? await prisma.tenant.findMany({ orderBy: { companyName: 'asc' } })
    : [];

  const users = await prisma.user.findMany({
    where: isSmartData ? { role: { scope: 'SMART_DATA' } } : { tenantId: req.user.tenantId },
    include: { role: true, tenant: true },
    orderBy: { name: 'asc' }
  });

  const schedules = await prisma.preventiveMaintenance.findMany({
    where: maintenanceWhere(req),
    include: { tenant: true, assignedTo: true },
    orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'desc' }]
  });

  const reminders = await prisma.emailReminder.findMany({
    where: isSmartData ? {} : { tenantId: req.user.tenantId },
    orderBy: { scheduledAt: 'asc' },
    take: 50
  });

  const escalations = await prisma.escalationRule.findMany({
    where: isSmartData ? {} : { tenantId: req.user.tenantId },
    orderBy: [{ module: 'asc' }, { level: 'asc' }]
  });

  res.render('maintenance/index', {
    title: 'Preventive Maintenance',
    tenants,
    users,
    schedules,
    reminders,
    escalations,
    currentUser: req.user,
    isSmartData
  });
});

router.post('/create', async (req, res) => {
  const isSmartData = isSmartDataUser(req);
  const scheduleType = isSmartData ? (req.body.scheduleType || 'SMART_DATA') : 'CLIENT';
  const tenantId = scheduleType === 'CLIENT'
    ? (isSmartData ? (req.body.tenantId || null) : req.user.tenantId)
    : null;

  if (scheduleType === 'CLIENT' && !tenantId) {
    return res.status(400).send('Client is required for client PM schedule.');
  }

  await prisma.preventiveMaintenance.create({
    data: {
      scheduleType,
      tenantId,
      title: req.body.title,
      category: req.body.category || null,
      description: req.body.description || null,
      serviceArea: req.body.serviceArea || null,
      scheduledDate: new Date(req.body.scheduledDate),
      assignedToId: req.body.assignedToId || null,
      vendorName: req.body.vendorName || null,
      frequency: req.body.frequency || null,
      reminderDays: Number(req.body.reminderDays || 7),
      escalation: req.body.escalation === 'true' || req.body.escalation === 'on',
      status: 'SCHEDULED'
    }
  });
  res.redirect('/maintenance');
});

router.post('/:id/complete', async (req, res) => {
  const schedule = await prisma.preventiveMaintenance.findUnique({ where: { id: req.params.id } });
  if (!schedule || !validateScheduleAccess(req, schedule)) return res.status(403).send('Access denied');

  await prisma.preventiveMaintenance.update({
    where: { id: req.params.id },
    data: { status: 'COMPLETED', completedDate: new Date(), remarks: req.body.remarks || null }
  });
  res.redirect('/maintenance');
});

router.post('/reminders/create', async (req, res) => {
  let tenantId = null;
  if (!isSmartDataUser(req)) tenantId = req.user.tenantId;
  if (isSmartDataUser(req) && req.body.tenantId) tenantId = req.body.tenantId;

  await prisma.emailReminder.create({
    data: {
      tenantId,
      maintenanceId: req.body.maintenanceId || null,
      reminderType: req.body.reminderType || 'MAINTENANCE',
      recipientEmail: req.body.recipientEmail,
      subject: req.body.subject,
      body: req.body.body || '',
      scheduledAt: new Date(req.body.scheduledAt)
    }
  });
  res.redirect('/maintenance');
});

router.post('/escalations/create', async (req, res) => {
  let tenantId = null;
  if (!isSmartDataUser(req)) tenantId = req.user.tenantId;
  if (isSmartDataUser(req) && req.body.tenantId) tenantId = req.body.tenantId;

  await prisma.escalationRule.create({
    data: {
      tenantId,
      module: req.body.module || 'MAINTENANCE',
      level: Number(req.body.level || 1),
      delayHours: Number(req.body.delayHours || 24),
      notifyEmail: req.body.notifyEmail,
      isActive: true
    }
  });
  res.redirect('/maintenance');
});

module.exports = router;
