const express = require('express');
const prisma = require('../config/prisma');
const { hashPassword } = require('../utils/auth');
const { requireAuth, requireClient } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth, requireClient);

function roleName(user) {
  return user.role?.name || '';
}

function canManageUsers(user) {
  return ['CLIENT_ADMIN'].includes(roleName(user));
}

async function getReporteeIds(tenantId, managerId) {
  const users = await prisma.user.findMany({
    where: { tenantId, status: 'ACTIVE' },
    select: { id: true, reportingManagerId: true }
  });
  const result = new Set([managerId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const u of users) {
      if (u.reportingManagerId && result.has(u.reportingManagerId) && !result.has(u.id)) {
        result.add(u.id);
        changed = true;
      }
    }
  }
  return [...result];
}

async function visibleUserIds(user) {
  if (roleName(user) === 'CLIENT_ADMIN') {
    const rows = await prisma.user.findMany({ where: { tenantId: user.tenantId }, select: { id: true } });
    return rows.map(r => r.id);
  }
  if (roleName(user) === 'MANAGER') return getReporteeIds(user.tenantId, user.id);
  return [user.id];
}

router.get('/', async (req, res) => {
  const tenantId = req.user.tenantId;
  const ids = await visibleUserIds(req.user);
  const taskVisibility = roleName(req.user) === 'CLIENT_ADMIN'
    ? { tenantId }
    : { tenantId, OR: [{ assignedToId: { in: ids } }, { createdById: req.user.id }] };
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const [totalTasks, openTasks, inProgress, completed, overdue, todayTasks, complaints, openComplaints, users, locations, pmUpcoming] = await Promise.all([
    prisma.task.count({ where: taskVisibility }),
    prisma.task.count({ where: { ...taskVisibility, status: { in: ['OPEN','ASSIGNED'] } } }),
    prisma.task.count({ where: { ...taskVisibility, status: 'IN_PROGRESS' } }),
    prisma.task.count({ where: { ...taskVisibility, status: { in: ['COMPLETED','CLOSED'] } } }),
    prisma.task.count({ where: { ...taskVisibility, dueDate: { lt: now }, status: { notIn: ['COMPLETED','CLOSED','CANCELLED'] } } }),
    prisma.task.count({ where: { ...taskVisibility, dueDate: { gte: startToday, lt: endToday } } }),
    prisma.complaint.count({ where: { tenantId } }),
    prisma.complaint.count({ where: { tenantId, status: { notIn: ['RESOLVED','CLOSED'] } } }),
    prisma.user.count({ where: { tenantId, status: 'ACTIVE' } }),
    prisma.location.count({ where: { tenantId } }),
    prisma.preventiveMaintenance.count({ where: { tenantId, scheduledDate: { gte: now }, status: { not: 'CANCELLED' } } })
  ]);
  const slaCompliance = totalTasks ? Math.round(((totalTasks - overdue) / totalTasks) * 100) : 100;
  const recentTasks = await prisma.task.findMany({
    where: taskVisibility,
    include: { assignedTo: true, location: true },
    orderBy: { updatedAt: 'desc' },
    take: 10
  });
  res.render('client/dashboard', {
    title: `${req.user.tenant.companyName} Dashboard`,
    stats: { totalTasks, openTasks, inProgress, completed, overdue, todayTasks, complaints, openComplaints, users, locations, pmUpcoming, slaCompliance },
    recentTasks
  });
});

router.get('/users', async (req, res) => {
  if (!canManageUsers(req.user)) return res.status(403).send('Only Client Admin can manage users.');
  const tenantId = req.user.tenantId;
  const [users, roles, tenant] = await Promise.all([
    prisma.user.findMany({ where: { tenantId }, include: { role: true, reportingManager: true, escalationManager: true }, orderBy: { createdAt: 'desc' } }),
    prisma.role.findMany({ where: { scope: 'CLIENT' }, orderBy: { name: 'asc' } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } })
  ]);
  const maxUsers = tenant?.plan?.maxUsers || 6;
  res.render('client/users', { title: 'Employee User Management', users, roles, tenant, maxUsers, error: req.query.error || '', success: req.query.success || '' });
});

router.post('/users/create', async (req, res) => {
  if (!canManageUsers(req.user)) return res.status(403).send('Only Client Admin can manage users.');
  const tenantId = req.user.tenantId;
  const [tenant, currentCount] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } }),
    prisma.user.count({ where: { tenantId, status: 'ACTIVE' } })
  ]);
  const maxUsers = tenant?.plan?.maxUsers || 6;
  if (currentCount >= maxUsers) return res.redirect(`/client/users?error=${encodeURIComponent(`User limit reached. Your plan allows ${maxUsers} active users.`)}`);
  const role = await prisma.role.findUnique({ where: { id: req.body.roleId } });
  if (!role || role.scope !== 'CLIENT') return res.redirect('/client/users?error=Invalid client role');
  const managerIds = [req.body.reportingManagerId, req.body.escalationManagerId].filter(Boolean);
  if (managerIds.length) {
    const validManagers = await prisma.user.count({ where: { id: { in: managerIds }, tenantId } });
    if (validManagers !== new Set(managerIds).size) return res.redirect('/client/users?error=Invalid reporting or escalation manager');
  }
  try {
    await prisma.user.create({ data: {
      tenantId,
      name: req.body.name,
      username: req.body.username || null,
      employeeCode: req.body.employeeCode || null,
      email: req.body.email,
      password: await hashPassword(req.body.password || 'User@12345'),
      phone: req.body.phone || null,
      designation: req.body.designation || null,
      department: req.body.department || null,
      roleId: req.body.roleId,
      reportingManagerId: req.body.reportingManagerId || null,
      escalationManagerId: req.body.escalationManagerId || null,
      status: req.body.status || 'ACTIVE'
    }});
    res.redirect('/client/users?success=User created successfully');
  } catch (e) {
    console.error(e);
    res.redirect(`/client/users?error=${encodeURIComponent('Email or User ID already exists.')}`);
  }
});

router.post('/users/:id/update', async (req, res) => {
  if (!canManageUsers(req.user)) return res.status(403).send('Only Client Admin can manage users.');
  const target = await prisma.user.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!target) return res.status(404).send('User not found');
  const data = {
    roleId: req.body.roleId || target.roleId,
    department: req.body.department || null,
    designation: req.body.designation || null,
    reportingManagerId: req.body.reportingManagerId || null,
    escalationManagerId: req.body.escalationManagerId || null,
    status: req.body.status || target.status
  };
  if (req.body.password) data.password = await hashPassword(req.body.password);
  await prisma.user.update({ where: { id: target.id }, data });
  res.redirect('/client/users?success=User updated successfully');
});

router.get('/analytics', async (req, res) => {
  const tenantId = req.user.tenantId;
  const ids = await visibleUserIds(req.user);
  const allCompany = roleName(req.user) === 'CLIENT_ADMIN';
  const where = allCompany ? { tenantId } : { tenantId, OR: [{ assignedToId: { in: ids } }, { createdById: req.user.id }] };
  const tasks = await prisma.task.findMany({ where, include: { assignedTo: true, location: true }, orderBy: { createdAt: 'desc' } });
  const complaints = await prisma.complaint.findMany({ where: { tenantId }, include: { location: true }, orderBy: { createdAt: 'desc' } });
  const users = await prisma.user.findMany({ where: { tenantId, ...(allCompany ? {} : { id: { in: ids } }) }, include: { role: true }, orderBy: { name: 'asc' } });
  const now = new Date();
  const overdue = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now && !['COMPLETED','CLOSED','CANCELLED'].includes(t.status)).length;
  const completed = tasks.filter(t => ['COMPLETED','CLOSED'].includes(t.status)).length;
  const slaCompliance = tasks.length ? Math.round(((tasks.length - overdue) / tasks.length) * 100) : 100;
  const by = (rows, fn) => rows.reduce((a, r) => { const k=fn(r)||'Not Available'; a[k]=(a[k]||0)+1; return a; }, {});
  const employee = users.map(u => {
    const assigned = tasks.filter(t => t.assignedToId === u.id);
    const done = assigned.filter(t => ['COMPLETED','CLOSED'].includes(t.status)).length;
    const late = assigned.filter(t => t.dueDate && new Date(t.dueDate) < now && !['COMPLETED','CLOSED','CANCELLED'].includes(t.status)).length;
    return { name: u.name, department: u.department || '-', assigned: assigned.length, completed: done, pending: assigned.length-done, overdue: late, productivity: assigned.length ? Math.round(done/assigned.length*100) : 0 };
  });
  const data = {
    kpis: { totalTasks: tasks.length, completed, pending: tasks.length-completed, overdue, slaCompliance, openComplaints: complaints.filter(c=>!['RESOLVED','CLOSED'].includes(c.status)).length, employees: users.length },
    taskStatus: by(tasks, t=>t.status), taskPriority: by(tasks,t=>t.priority), taskDepartment: by(tasks,t=>t.assignedTo?.department||t.location?.department),
    complaintFloor: by(complaints,c=>c.location?.floorName), complaintLocation: by(complaints,c=>c.location?.locationName), employee,
    tasks
  };
  res.render('client/analytics', { title: 'SLA, KPI & Escalation Analytics', data, allCompany });
});

router.get('/analytics/report.csv', async (req, res) => {
  const tenantId = req.user.tenantId;
  const ids = await visibleUserIds(req.user);
  const allCompany = roleName(req.user) === 'CLIENT_ADMIN';
  const where = allCompany ? { tenantId } : { tenantId, OR: [{ assignedToId: { in: ids } }, { createdById: req.user.id }] };
  const tasks = await prisma.task.findMany({ where, include: { assignedTo: true, location: true } });
  const rows = [['Task','Status','Priority','Assigned To','Department','Due Date']];
  tasks.forEach(t => rows.push([t.title,t.status,t.priority,t.assignedTo?.name||'',t.assignedTo?.department||t.location?.department||'',t.dueDate?new Date(t.dueDate).toISOString().slice(0,10):'']));
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="client-sla-kpi-report.csv"');
  res.send(csv);
});

router.get('/analytics/print', async (req, res) => {
  const tenantId=req.user.tenantId;
  const ids=await visibleUserIds(req.user);
  const allCompany=roleName(req.user)==='CLIENT_ADMIN';
  const where=allCompany?{tenantId}:{tenantId,OR:[{assignedToId:{in:ids}},{createdById:req.user.id}]};
  const tasks=await prisma.task.findMany({where,include:{assignedTo:true,location:true},orderBy:{createdAt:'desc'}});
  const now=new Date();
  const overdue=tasks.filter(t=>t.dueDate&&new Date(t.dueDate)<now&&!['COMPLETED','CLOSED','CANCELLED'].includes(t.status)).length;
  const completed=tasks.filter(t=>['COMPLETED','CLOSED'].includes(t.status)).length;
  const slaCompliance=tasks.length?Math.round(((tasks.length-overdue)/tasks.length)*100):100;
  res.render('client/analytics-print',{title:'Client SLA & KPI Report',tenant:req.user.tenant,tasks,kpis:{total:tasks.length,completed,pending:tasks.length-completed,overdue,slaCompliance}});
});

module.exports = router;
