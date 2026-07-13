const express = require('express');
const prisma = require('../config/prisma');
const { requireAuth, requireSmartData } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth, requireSmartData);

const statuses = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'TESTING', 'WAITING_APPROVAL', 'COMPLETED', 'CLOSED'];

async function getSmartDataUsers() {
  return prisma.user.findMany({
    where: { tenantId: null, status: 'ACTIVE' },
    include: { role: true },
    orderBy: [{ department: 'asc' }, { name: 'asc' }]
  });
}

router.get('/', async (req, res) => {
  const where = {};
  if (req.query.assignedToId) where.assignedToId = req.query.assignedToId;
  if (req.query.department) where.department = req.query.department;

  const [tasks, users] = await Promise.all([
    prisma.internalTask.findMany({
      where,
      include: { createdBy: true, assignedTo: true },
      orderBy: { createdAt: 'desc' }
    }),
    getSmartDataUsers()
  ]);

  const departments = [...new Set(users.map(u => u.department).filter(Boolean))];
  res.render('superadmin/internal_tasks', {
    title: 'Smart Data Internal Tasks',
    tasks,
    users,
    departments,
    statuses,
    selectedDepartment: req.query.department || '',
    selectedAssignedTo: req.query.assignedToId || ''
  });
});

router.post('/create', async (req, res) => {
  await prisma.internalTask.create({
    data: {
      title: req.body.title,
      description: req.body.description || null,
      department: req.body.department || null,
      priority: req.body.priority || 'MEDIUM',
      status: req.body.status || 'NEW',
      startDate: req.body.startDate ? new Date(req.body.startDate) : null,
      dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
      attachmentUrl: req.body.attachmentUrl || null,
      checklist: req.body.checklist
        ? req.body.checklist.split('\n').map(item => ({ item: item.trim(), done: false })).filter(x => x.item)
        : [],
      createdById: req.user.id,
      assignedToId: req.body.assignedToId || null
    }
  });
  res.redirect('/superadmin/internal-tasks');
});

router.post('/:id/status', async (req, res) => {
  const data = { status: req.body.status };
  if (req.body.status === 'COMPLETED' || req.body.status === 'CLOSED') data.completedAt = new Date();
  await prisma.internalTask.update({ where: { id: req.params.id }, data });
  res.redirect('/superadmin/internal-tasks');
});

router.post('/:id/assign', async (req, res) => {
  await prisma.internalTask.update({
    where: { id: req.params.id },
    data: { assignedToId: req.body.assignedToId || null, status: req.body.assignedToId ? 'ASSIGNED' : 'NEW' }
  });
  res.redirect('/superadmin/internal-tasks');
});

router.post('/:id/delete', async (req, res) => {
  await prisma.internalTask.delete({ where: { id: req.params.id } });
  res.redirect('/superadmin/internal-tasks');
});

module.exports = router;
