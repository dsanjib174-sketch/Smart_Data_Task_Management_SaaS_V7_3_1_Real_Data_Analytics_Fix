const express = require('express');
const prisma = require('../config/prisma');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

function isSmartData(user) { return user.role?.scope === 'SMART_DATA'; }
function roleName(user) { return user.role?.name || ''; }

async function reporteeIds(tenantId, managerId) {
  const rows = await prisma.user.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true, reportingManagerId: true } });
  const ids = new Set([managerId]);
  let changed = true;
  while (changed) {
    changed = false;
    rows.forEach(r => { if (r.reportingManagerId && ids.has(r.reportingManagerId) && !ids.has(r.id)) { ids.add(r.id); changed = true; } });
  }
  return [...ids];
}

router.get('/', async (req, res) => {
  const allAccess = isSmartData(req.user);
  const selectedTenantId = allAccess ? (req.query.tenantId || '') : req.user.tenantId;
  let where;
  let visibleIds = [];
  if (allAccess) where = selectedTenantId ? { tenantId: selectedTenantId } : {};
  else if (roleName(req.user) === 'CLIENT_ADMIN') where = { tenantId: req.user.tenantId };
  else if (roleName(req.user) === 'MANAGER') {
    visibleIds = await reporteeIds(req.user.tenantId, req.user.id);
    where = { tenantId: req.user.tenantId, OR: [{ assignedToId: { in: visibleIds } }, { createdById: req.user.id }] };
  } else where = { tenantId: req.user.tenantId, OR: [{ assignedToId: req.user.id }, { createdById: req.user.id }] };

  let userWhere = selectedTenantId ? { tenantId: selectedTenantId, status: 'ACTIVE' } : { id: '__NONE__' };
  if (!allAccess && roleName(req.user) === 'MANAGER') userWhere = { tenantId: req.user.tenantId, id: { in: visibleIds }, status: 'ACTIVE' };
  if (!allAccess && roleName(req.user) === 'EMPLOYEE') userWhere = { id: req.user.id };

  const [tasks, tenants, users, locations] = await Promise.all([
    prisma.task.findMany({ where, include: { tenant: true, assignedTo: true, createdBy: true, location: true }, orderBy: { createdAt: 'desc' } }),
    allAccess ? prisma.tenant.findMany({ orderBy: { companyName: 'asc' } }) : [],
    prisma.user.findMany({ where: userWhere, orderBy: { name: 'asc' } }),
    selectedTenantId ? prisma.location.findMany({ where: { tenantId: selectedTenantId }, orderBy: [{ floorName: 'asc' }, { locationName: 'asc' }] }) : []
  ]);
  res.render('tasks/index', { title: 'Task Kanban', tasks, tenants, users, locations, selectedTenantId, allAccess, canCreate: allAccess || ['CLIENT_ADMIN','MANAGER','EMPLOYEE'].includes(roleName(req.user)) });
});

router.post('/create', async (req, res) => {
  const allAccess = isSmartData(req.user);
  const tenantId = allAccess ? req.body.tenantId : req.user.tenantId;
  if (!tenantId) return res.status(400).send('Please select client before creating task.');
  let assignedToId = req.body.assignedToId || req.user.id;
  if (!allAccess) {
    const target = await prisma.user.findFirst({ where: { id: assignedToId, tenantId } });
    if (!target) return res.status(403).send('Invalid assignee.');
    if (roleName(req.user) === 'EMPLOYEE' && assignedToId !== req.user.id) return res.status(403).send('Employees can assign tasks only to themselves.');
    if (roleName(req.user) === 'MANAGER') {
      const ids = await reporteeIds(tenantId, req.user.id);
      if (!ids.includes(assignedToId)) return res.status(403).send('Manager can assign only to own reportees.');
    }
  }
  await prisma.task.create({ data: {
    tenantId, title: req.body.title, description: req.body.description || null, priority: req.body.priority || 'MEDIUM',
    status: req.body.status || 'OPEN', dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
    locationId: req.body.locationId || null, assignedToId, createdById: req.user.id
  }});
  res.redirect(`/tasks${allAccess && tenantId ? `?tenantId=${tenantId}` : ''}`);
});

router.post('/:id/status', async (req, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).send('Task not found');
  if (!isSmartData(req.user) && task.tenantId !== req.user.tenantId) return res.status(403).send('Access denied');
  if (!isSmartData(req.user) && !['CLIENT_ADMIN','MANAGER'].includes(roleName(req.user)) && task.assignedToId !== req.user.id) return res.status(403).send('Access denied');
  await prisma.task.update({ where: { id: task.id }, data: { status: req.body.status } });
  res.redirect(`/tasks${isSmartData(req.user) ? `?tenantId=${task.tenantId}` : ''}`);
});

module.exports = router;
