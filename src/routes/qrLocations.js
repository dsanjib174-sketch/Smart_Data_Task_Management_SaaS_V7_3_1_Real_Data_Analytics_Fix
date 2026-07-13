const express = require('express');
const QRCode = require('qrcode');
const prisma = require('../config/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function isSmartData(user) {
  return user.role?.scope === 'SMART_DATA';
}

router.get('/', async (req, res, next) => {
  try {
    const smartDataUser = isSmartData(req.user);
    const selectedScope = smartDataUser && req.query.scope === 'SMART_DATA' ? 'SMART_DATA' : 'CLIENT';
    const selectedTenantId = smartDataUser
      ? (selectedScope === 'CLIENT' ? (req.query.tenantId || '') : '')
      : req.user.tenantId;

    const locationWhere = smartDataUser
      ? (selectedScope === 'SMART_DATA'
          ? { scope: 'SMART_DATA', tenantId: null }
          : selectedTenantId
            ? { scope: 'CLIENT', tenantId: selectedTenantId }
            : { id: '__NONE__' })
      : { scope: 'CLIENT', tenantId: req.user.tenantId };

    const [tenants, locations] = await Promise.all([
      smartDataUser ? prisma.tenant.findMany({ orderBy: { companyName: 'asc' } }) : [],
      prisma.location.findMany({
        where: locationWhere,
        include: { tenant: true },
        orderBy: [{ floorName: 'asc' }, { locationName: 'asc' }]
      })
    ]);

    res.render('qr/locations', {
      title: 'QR Floor & Location',
      locations,
      tenants,
      selectedTenantId,
      selectedScope,
      smartDataUser
    });
  } catch (error) {
    next(error);
  }
});

router.post('/create', async (req, res, next) => {
  try {
    const smartDataUser = isSmartData(req.user);
    const scope = smartDataUser && req.body.scope === 'SMART_DATA' ? 'SMART_DATA' : 'CLIENT';
    const tenantId = scope === 'CLIENT'
      ? (smartDataUser ? req.body.tenantId : req.user.tenantId)
      : null;

    if (scope === 'CLIENT' && !tenantId) {
      return res.status(400).send('Please select a client before creating a client QR.');
    }

    const floorName = String(req.body.floorName || '').trim();
    const locationName = String(req.body.locationName || '').trim();
    const department = String(req.body.department || '').trim() || null;

    if (!floorName || !locationName) {
      return res.status(400).send('Floor and location are required.');
    }

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

    const location = await prisma.location.create({
      data: {
        scope,
        tenantId,
        floorName,
        locationName,
        department
      }
    });

    const publicUrl = new URL('/complaints/new', baseUrl);
    publicUrl.searchParams.set('locationId', location.id);
    publicUrl.searchParams.set('scope', scope);

    const complaintUrl = publicUrl.toString();
    const qrCode = await QRCode.toDataURL(complaintUrl);

    await prisma.location.update({
      where: { id: location.id },
      data: { complaintUrl, qrCode }
    });

    const redirectQuery = new URLSearchParams({ scope });
    if (tenantId) redirectQuery.set('tenantId', tenantId);
    res.redirect(`/qr-locations?${redirectQuery.toString()}`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
