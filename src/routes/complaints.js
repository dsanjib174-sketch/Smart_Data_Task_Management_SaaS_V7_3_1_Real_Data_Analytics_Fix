const express = require('express');
const prisma = require('../config/prisma');

const router = express.Router();

router.get('/new', async (req, res, next) => {
  try {
    const locationId = String(req.query.locationId || '');
    const location = locationId
      ? await prisma.location.findUnique({ where: { id: locationId }, include: { tenant: true } })
      : null;

    if (!location || location.status !== 'ACTIVE') {
      return res.status(404).send('This QR location is invalid or inactive.');
    }

    res.render('qr/complaint_form', {
      title: location.scope === 'SMART_DATA' ? 'Submit Internal Task' : 'Submit Complaint',
      location,
      success: null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/new', async (req, res, next) => {
  try {
    const locationId = String(req.body.locationId || '');
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      include: { tenant: true }
    });

    if (!location || location.status !== 'ACTIVE') {
      return res.status(404).send('This QR location is invalid or inactive.');
    }

    const subject = String(req.body.subject || '').trim();
    const description = String(req.body.description || '').trim() || null;
    const reporterName = String(req.body.reporterName || '').trim() || null;
    const reporterPhone = String(req.body.reporterPhone || '').trim() || null;
    const priority = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(req.body.priority)
      ? req.body.priority
      : 'MEDIUM';

    if (!subject) return res.status(400).send('Subject is required.');

    if (location.scope === 'SMART_DATA') {
      const details = [
        description,
        `QR Location: ${location.floorName} / ${location.locationName}`,
        reporterName ? `Reported by: ${reporterName}` : null,
        reporterPhone ? `Phone: ${reporterPhone}` : null
      ].filter(Boolean).join('\n');

      await prisma.internalTask.create({
        data: {
          title: subject,
          description: details,
          department: location.department,
          priority,
          status: 'NEW'
        }
      });
    } else {
      if (!location.tenantId) return res.status(400).send('Client QR is not linked to a client.');

      await prisma.complaint.create({
        data: {
          tenantId: location.tenantId,
          locationId: location.id,
          subject,
          description,
          reporterName,
          reporterPhone,
          priority
        }
      });
    }

    res.render('qr/complaint_form', {
      title: location.scope === 'SMART_DATA' ? 'Submit Internal Task' : 'Submit Complaint',
      location,
      success: location.scope === 'SMART_DATA'
        ? 'Task submitted successfully to Smart Data.'
        : 'Complaint submitted successfully.'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
