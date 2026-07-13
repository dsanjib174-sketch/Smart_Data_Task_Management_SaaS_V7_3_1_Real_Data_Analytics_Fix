const express = require('express');
const QRCode = require('qrcode');
const prisma = require('../config/prisma');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

function canManageAll(user) {
  return user.role?.scope === 'SMART_DATA';
}

router.get('/', async (req, res) => {
  const allTenants = canManageAll(req.user);
  const selectedTenantId = allTenants ? (req.query.tenantId || '') : req.user.tenantId;
  const [tenants, locations] = await Promise.all([
    allTenants ? prisma.tenant.findMany({ orderBy: { companyName: 'asc' } }) : [],
    selectedTenantId ? prisma.location.findMany({ where: { tenantId: selectedTenantId }, include: { tenant: true }, orderBy: [{ floorName: 'asc' }, { locationName: 'asc' }] }) : []
  ]);
  res.render('qr/locations', { title: 'QR Floor & Location', locations, tenants, selectedTenantId, allTenants });
});

router.post('/create', async (req, res) => {
  const tenantId = canManageAll(req.user) ? req.body.tenantId : req.user.tenantId;
  if (!tenantId) return res.status(400).send('Please select client before creating QR location.');
  const { floorName, locationName, department } = req.body;
  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const complaintUrl = `${baseUrl}/complaints/new?tenantId=${tenantId}&floor=${encodeURIComponent(floorName)}&location=${encodeURIComponent(locationName)}`;
  const qrCode = await QRCode.toDataURL(complaintUrl);
  await prisma.location.create({ data: { tenantId, floorName, locationName, department: department || null, complaintUrl, qrCode } });
  res.redirect(`/qr-locations${canManageAll(req.user) ? `?tenantId=${tenantId}` : ''}`);
});

module.exports = router;
