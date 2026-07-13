const express = require('express');
const prisma = require('../config/prisma');
const router = express.Router();
router.get('/new', async (req, res) => {
  res.render('qr/complaint_form', { title: 'Submit Complaint', query: req.query, success: null });
});
router.post('/new', async (req, res) => {
  const { tenantId, subject, description, reporterName, reporterPhone, priority } = req.body;
  let location = null;
  if (tenantId && req.body.floorName && req.body.locationName) {
    location = await prisma.location.findFirst({ where: { tenantId, floorName: req.body.floorName, locationName: req.body.locationName } });
  }
  await prisma.complaint.create({ data: { tenantId, locationId: location?.id, subject, description, reporterName, reporterPhone, priority: priority || 'MEDIUM' } });
  res.render('qr/complaint_form', { title: 'Submit Complaint', query: req.query, success: 'Complaint submitted successfully.' });
});
module.exports = router;
