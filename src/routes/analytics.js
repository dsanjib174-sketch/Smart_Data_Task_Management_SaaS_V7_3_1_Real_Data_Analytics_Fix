const express = require('express');
const prisma = require('../config/prisma');
const { requireAuth, requireSmartData } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth, requireSmartData);

function parseDate(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function rangeFromQuery(req) {
  const now = new Date();
  const startDefault = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const endDefault = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return {
    start: parseDate(req.query.startDate, startDefault),
    end: parseDate(req.query.endDate, endDefault),
    clientId: req.query.clientId || '',
    planId: req.query.planId || '',
    status: req.query.status || '',
    priority: req.query.priority || '',
    floor: req.query.floor || '',
    city: req.query.city || '',
    state: req.query.state || '',
    salesExecutive: req.query.salesExecutive || ''
  };
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function quarterKey(d) {
  return `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`;
}

function buildMonthLabels(start, end) {
  const labels = [];
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= end) {
    labels.push(monthKey(d));
    d.setMonth(d.getMonth() + 1);
  }
  return labels;
}

function countBy(rows, picker) {
  return rows.reduce((acc, row) => {
    const key = picker(row) || 'Not Available';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function sumBy(rows, picker, valuePicker) {
  return rows.reduce((acc, row) => {
    const key = picker(row) || 'Not Available';
    acc[key] = (acc[key] || 0) + Number(valuePicker(row) || 0);
    return acc;
  }, {});
}

function agingBucket(date) {
  if (!date) return 'No Due Date';
  const diffDays = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Not Due';
  if (diffDays <= 3) return '1-3 Days';
  if (diffDays <= 7) return '4-7 Days';
  if (diffDays <= 15) return '8-15 Days';
  if (diffDays <= 30) return '16-30 Days';
  return '30+ Days';
}

async function loadAnalytics(req) {
  const filters = rangeFromQuery(req);
  const dateWhere = { gte: filters.start, lte: filters.end };
  const tenantWhere = {};
  if (filters.clientId) tenantWhere.id = filters.clientId;
  if (filters.planId) tenantWhere.planId = filters.planId;
  if (filters.city) tenantWhere.city = { equals: filters.city, mode: 'insensitive' };
  if (filters.state) tenantWhere.state = { equals: filters.state, mode: 'insensitive' };

  const taskWhere = { createdAt: dateWhere };
  if (filters.clientId) taskWhere.tenantId = filters.clientId;
  if (filters.status) taskWhere.status = filters.status;
  if (filters.priority) taskWhere.priority = filters.priority;

  const complaintWhere = { createdAt: dateWhere };
  if (filters.clientId) complaintWhere.tenantId = filters.clientId;
  if (filters.priority) complaintWhere.priority = filters.priority;

  const invoiceWhere = { invoiceDate: dateWhere };
  if (filters.clientId) invoiceWhere.tenantId = filters.clientId;

  const [tenants, plans, users, tasks, complaints, invoices, locations, internalTasks, maintenanceSchedules, loginHistory, auditLogs] = await Promise.all([
    prisma.tenant.findMany({ where: tenantWhere, include: { plan: true, users: true, tasks: true, complaints: true, invoices: true }, orderBy: { createdAt: 'asc' } }),
    prisma.subscriptionPlan.findMany({ orderBy: { price: 'asc' } }),
    prisma.user.findMany({ include: { role: true, tenant: true, assignedTasks: true, internalAssignedTasks: true }, orderBy: { createdAt: 'desc' } }),
    prisma.task.findMany({ where: taskWhere, include: { tenant: true, assignedTo: true, location: true }, orderBy: { createdAt: 'asc' } }),
    prisma.complaint.findMany({ where: complaintWhere, include: { tenant: true, location: true }, orderBy: { createdAt: 'asc' } }),
    prisma.subscriptionInvoice.findMany({ where: invoiceWhere, include: { tenant: true, plan: true }, orderBy: { invoiceDate: 'asc' } }),
    prisma.location.findMany({ include: { tenant: true, complaints: true, tasks: true }, orderBy: [{ floorName: 'asc' }, { locationName: 'asc' }] }),
    prisma.internalTask.findMany({ include: { assignedTo: true, createdBy: true }, orderBy: { createdAt: 'asc' } }),
    prisma.preventiveMaintenance.findMany({ where: filters.clientId ? { tenantId: filters.clientId } : {}, include: { tenant: true, assignedTo: true }, orderBy: { scheduledDate: 'asc' } }),
    prisma.loginHistory.findMany({ where: { createdAt: dateWhere }, orderBy: { createdAt: 'asc' } }),
    prisma.auditLog.findMany({ where: { createdAt: dateWhere }, orderBy: { createdAt: 'asc' } })
  ]);

  const monthLabels = buildMonthLabels(filters.start, filters.end);
  const revenueByMonth = Object.fromEntries(monthLabels.map(m => [m, 0]));
  invoices.forEach(inv => { revenueByMonth[monthKey(new Date(inv.invoiceDate))] = (revenueByMonth[monthKey(new Date(inv.invoiceDate))] || 0) + Number(inv.totalAmount || inv.amount || 0); });
  const revenueByQuarter = sumBy(invoices, i => quarterKey(new Date(i.invoiceDate)), i => i.totalAmount || i.amount);
  const revenueByYear = sumBy(invoices, i => String(new Date(i.invoiceDate).getFullYear()), i => i.totalAmount || i.amount);
  const revenueByPlan = sumBy(invoices, i => i.plan?.name || 'No Plan', i => i.totalAmount || i.amount);

  const paidStatuses = new Set(['PAID']);
  const subscriptionRevenue = invoices.reduce((s, i) => s + Number(i.totalAmount || i.amount || 0), 0);
  const gstCollected = invoices.reduce((s, i) => s + Number(i.gstAmount || 0), 0);
  const outstanding = invoices.filter(i => !paidStatuses.has(i.status)).reduce((s, i) => s + Number(i.totalAmount || i.amount || 0), 0);

  const activeClients = tenants.filter(t => t.status === 'ACTIVE').length;
  const trialClients = tenants.filter(t => t.status === 'TRIAL').length;
  const expiredClients = tenants.filter(t => t.status === 'EXPIRED').length;
  const activeUsers = users.filter(u => u.status === 'ACTIVE').length;
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
  const operationalTasks = tasks.filter(t => t.status !== 'CANCELLED');
  const todaysTasks = operationalTasks.filter(t => new Date(t.createdAt) >= startToday && new Date(t.createdAt) <= endToday).length;
  const overdueTasks = tasks.filter(t => t.dueDate && new Date(t.dueDate) < today && !['COMPLETED','CLOSED','CANCELLED'].includes(t.status)).length;
  const openComplaints = complaints.filter(c => !['RESOLVED','CLOSED'].includes(c.status)).length;
  const completedTasks = operationalTasks.filter(t => ['COMPLETED','CLOSED'].includes(t.status)).length;
  const slaBaseTasks = operationalTasks;
  const slaCompliance = slaBaseTasks.length ? Math.round(((slaBaseTasks.length - overdueTasks) / slaBaseTasks.length) * 100) : 0;
  // CSAT must come from an actual customer-rating field. Until such ratings exist, show 0 instead of demo data.
  const csat = 0;

  const newClientsByMonth = Object.fromEntries(monthLabels.map(m => [m, 0]));
  tenants.forEach(t => { const k = monthKey(new Date(t.createdAt)); if (newClientsByMonth[k] !== undefined) newClientsByMonth[k] += 1; });
  const lostClientsByMonth = Object.fromEntries(monthLabels.map(m => [m, 0]));
  tenants.filter(t => ['EXPIRED','SUSPENDED'].includes(t.status)).forEach(t => { const k = monthKey(new Date(t.updatedAt)); if (lostClientsByMonth[k] !== undefined) lostClientsByMonth[k] += 1; });

  const trialToPaid = tenants.length ? Math.round((activeClients / Math.max(activeClients + trialClients, 1)) * 100) : 0;
  const paidInvoices = invoices.filter(i => i.status === 'PAID');
  const paidByTenant = countBy(paidInvoices, i => i.tenantId);
  const renewedTenantCount = Object.values(paidByTenant).filter(count => count > 1).length;
  const paidTenantCount = Object.keys(paidByTenant).length;
  const renewalRate = paidTenantCount ? Math.round((renewedTenantCount / paidTenantCount) * 100) : 0;
  const topClients = Object.entries(sumBy(invoices, i => i.tenant?.companyName || 'Unknown', i => i.totalAmount || i.amount)).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const funnel = {
    Leads: tenants.length,
    Trials: trialClients,
    Paid: paidTenantCount,
    Renewed: renewedTenantCount
  };

  const taskByStatus = countBy(tasks, t => t.status);
  const taskByPriority = countBy(operationalTasks, t => t.priority);
  const taskByDepartment = countBy(operationalTasks, t => t.assignedTo?.department || t.location?.department || 'Not Assigned');
  const taskByEmployee = countBy(operationalTasks, t => t.assignedTo?.name || 'Unassigned');
  const taskAging = countBy(operationalTasks, t => agingBucket(t.dueDate || t.createdAt));
  const taskCompletionTrend = Object.fromEntries(monthLabels.map(m => [m, 0]));
  tasks.filter(t => ['COMPLETED','CLOSED'].includes(t.status)).forEach(t => { const k = monthKey(new Date(t.updatedAt)); if (taskCompletionTrend[k] !== undefined) taskCompletionTrend[k] += 1; });

  const complaintsByFloor = countBy(complaints, c => c.location?.floorName || 'Not Available');
  const complaintsByLocation = countBy(complaints, c => c.location?.locationName || 'Not Available');
  const complaintsByDepartment = countBy(complaints, c => c.location?.department || 'Not Available');
  const complaintsByStatus = countBy(complaints, c => c.status);
  const complaintsByPriority = countBy(complaints, c => c.priority);
  const floorHeatmap = Object.entries(complaintsByFloor).map(([floor, count]) => ({ floor, count }));

  const employeePerformance = users.map(u => {
    const assigned = operationalTasks.filter(t => t.assignedToId === u.id);
    const completed = assigned.filter(t => ['COMPLETED','CLOSED'].includes(t.status)).length;
    const overdue = assigned.filter(t => t.dueDate && new Date(t.dueDate) < today && !['COMPLETED','CLOSED','CANCELLED'].includes(t.status)).length;
    const productivity = assigned.length ? Math.round((completed / assigned.length) * 100) : 0;
    return { name: u.name, department: u.department || u.role?.name || 'NA', assigned: assigned.length, completed, pending: assigned.length - completed, overdue, productivity };
  }).sort((a,b)=>b.productivity-a.productivity || b.completed-a.completed).slice(0,20);

  const clientAnalytics = {
    activeInactive: countBy(tenants, t => t.status),
    city: countBy(tenants, t => t.city || 'Not Available'),
    state: countBy(tenants, t => t.state || 'Not Available'),
    industry: { 'Facility Management': Math.max(tenants.length, 1), 'Admin Operations': Math.max(Math.round(tenants.length/2), 1), 'Corporate Services': Math.max(Math.round(tenants.length/3), 1) },
    avgUsers: tenants.length ? (users.filter(u => u.tenantId).length / tenants.length).toFixed(1) : 0,
    avgTasks: tenants.length ? (tasks.length / tenants.length).toFixed(1) : 0,
    avgComplaints: tenants.length ? (complaints.length / tenants.length).toFixed(1) : 0,
    loginFrequency: countBy(loginHistory.filter(x => String(x.status).toUpperCase() === 'SUCCESS'), x => monthKey(new Date(x.createdAt))),
    featureUsage: { Tasks: tasks.length, Complaints: complaints.length, QR: locations.length, Invoices: invoices.length, InternalTasks: internalTasks.length }
  };

  const qrAnalytics = {
    // Current schema records submitted complaints but does not separately record every QR scan.
    scanCount: complaints.length,
    complaintsPerQr: countBy(complaints.filter(c => c.locationId), c => `${c.location?.floorName || ''} ${c.location?.locationName || 'Unknown'}`.trim()),
    repeatComplaints: Object.entries(countBy(complaints.filter(c => c.locationId), c => c.locationId)).filter(([,v]) => v > 1).length,
    mostProblematicLocations: Object.entries(countBy(complaints.filter(c => c.locationId), c => c.location?.locationName || 'Unknown')).sort((a,b)=>b[1]-a[1]).slice(0,10),
    avgScanTime: 'Not tracked',
    deviceType: {}
  };

  const warningLimit = new Date(today);
  warningLimit.setDate(warningLimit.getDate() + 7);
  const maintenanceHealth = { Good: 0, Warning: 0, Critical: 0 };
  maintenanceSchedules.forEach(pm => {
    if (pm.status === 'CANCELLED') return;
    if (pm.status === 'COMPLETED') maintenanceHealth.Good += 1;
    else if (pm.status === 'OVERDUE' || new Date(pm.scheduledDate) < today) maintenanceHealth.Critical += 1;
    else if (pm.status === 'DUE' || new Date(pm.scheduledDate) <= warningLimit) maintenanceHealth.Warning += 1;
    else maintenanceHealth.Good += 1;
  });
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const followingMonthStart = new Date(today.getFullYear(), today.getMonth() + 2, 1);
  const pmAnalytics = {
    pmCalendar: {
      ThisMonth: maintenanceSchedules.filter(pm => new Date(pm.scheduledDate) >= thisMonthStart && new Date(pm.scheduledDate) < nextMonthStart).length,
      NextMonth: maintenanceSchedules.filter(pm => new Date(pm.scheduledDate) >= nextMonthStart && new Date(pm.scheduledDate) < followingMonthStart).length,
      Overdue: maintenanceHealth.Critical
    },
    upcomingServices: maintenanceSchedules.filter(pm => !['COMPLETED','CANCELLED','OVERDUE'].includes(pm.status) && new Date(pm.scheduledDate) >= today).length,
    missedServices: maintenanceHealth.Critical,
    scheduleHealth: maintenanceHealth,
    maintenanceCost: {}
  };

  const successfulLogins = loginHistory.filter(x => String(x.status).toUpperCase() === 'SUCCESS');
  const loginActivity = countBy(successfulLogins, x => monthKey(new Date(x.createdAt)));
  const passwordResets = auditLogs.filter(x => /password/i.test(x.action || '') && /reset|change/i.test(x.action || ''));
  const hrAnalytics = {
    employeeCount: users.length,
    departmentWise: countBy(users, u => u.department || u.role?.name || 'Not Available'),
    userRoles: countBy(users, u => u.role?.name || 'No Role'),
    loginActivity,
    activeSessions: 0,
    passwordResetHistory: countBy(passwordResets, x => monthKey(new Date(x.createdAt))),
    userCreationTrend: Object.fromEntries(monthLabels.map(m => [m, users.filter(u => monthKey(new Date(u.createdAt)) === m).length]))
  };

  const completedTaskRows = operationalTasks.filter(t => ['COMPLETED','CLOSED'].includes(t.status));
  const avgTaskHours = completedTaskRows.length
    ? completedTaskRows.reduce((sum, t) => sum + Math.max(0, new Date(t.updatedAt) - new Date(t.createdAt)), 0) / completedTaskRows.length / 3600000
    : 0;
  const resolvedComplaintRows = complaints.filter(c => ['RESOLVED','CLOSED'].includes(c.status));
  const avgComplaintHours = resolvedComplaintRows.length
    ? resolvedComplaintRows.reduce((sum, c) => sum + Math.max(0, new Date(c.updatedAt) - new Date(c.createdAt)), 0) / resolvedComplaintRows.length / 3600000
    : 0;

  const financial = {
    subscriptionRevenue,
    monthlyIncome: revenueByMonth,
    gstCollected,
    outstanding,
    paidVsPending: countBy(invoices, i => i.status),
    clientWiseRevenue: Object.fromEntries(topClients),
    profitTrend: Object.fromEntries(monthLabels.map(m => [m, 0])),
    cashFlow: Object.fromEntries(monthLabels.map(m => [m, 0]))
  };

  return {
    filters,
    lists: { tenants, plans, cities: [...new Set(tenants.map(t => t.city).filter(Boolean))], states: [...new Set(tenants.map(t => t.state).filter(Boolean))], users },
    kpis: {
      totalClients: tenants.length,
      activeClients,
      trialClients,
      expiredClients,
      mrr: Math.round(subscriptionRevenue / Math.max(monthLabels.length, 1)),
      arr: Math.round((subscriptionRevenue / Math.max(monthLabels.length, 1)) * 12),
      totalEmployees: users.length,
      activeUsers,
      todaysTasks,
      overdueTasks,
      openComplaints,
      slaCompliance,
      csat
    },
    sales: { revenueByMonth, revenueByQuarter, revenueByYear, newClientsByMonth, lostClientsByMonth, trialToPaid, renewalRate, revenueByPlan, topClients, funnel },
    clients: clientAnalytics,
    tasks: { taskByStatus, taskByPriority, taskByDepartment, taskByEmployee, taskAging, taskCompletionTrend, avgResolutionTime: avgTaskHours ? `${avgTaskHours.toFixed(1)} hrs` : 'No completed tasks', avgCompletionTime: avgTaskHours ? `${(avgTaskHours / 24).toFixed(1)} days` : 'No completed tasks' },
    complaints: { complaintsByFloor, complaintsByLocation, complaintsByDepartment, complaintsByStatus, complaintsByPriority, floorHeatmap, resolutionTime: avgComplaintHours ? `${avgComplaintHours.toFixed(1)} hrs` : 'No resolved complaints', slaPerformance: slaCompliance, rootCause: {}, escalationTrend: {} },
    employeePerformance,
    financial,
    qr: qrAnalytics,
    pm: pmAnalytics,
    hr: hrAnalytics
  };
}

router.get('/', async (req, res) => {
  const data = await loadAnalytics(req);
  res.render('analytics/index', { title: 'Enterprise Analytics Center', data });
});

router.get('/report.csv', async (req, res) => {
  const data = await loadAnalytics(req);
  const rows = [
    ['Section','Metric','Value'],
    ...Object.entries(data.kpis).map(([k,v]) => ['Executive KPI', k, v]),
    ...Object.entries(data.sales.revenueByMonth).map(([k,v]) => ['Revenue by Month', k, v]),
    ...Object.entries(data.tasks.taskByStatus).map(([k,v]) => ['Task Status', k, v]),
    ...Object.entries(data.complaints.complaintsByLocation).map(([k,v]) => ['Complaints by Location', k, v]),
    ...data.employeePerformance.map(e => ['Employee Productivity', e.name, `${e.productivity}%`])
  ];
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="smart-data-enterprise-analytics.csv"');
  res.send(csv);
});

router.get('/print', async (req, res) => {
  const data = await loadAnalytics(req);
  res.render('analytics/print', { title: 'Enterprise Analytics Report', data });
});

module.exports = router;
