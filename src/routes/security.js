const express = require('express');
const prisma = require('../config/prisma');
const { requireAuth, requireSmartData } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth, requireSmartData);

router.get('/', async (req, res) => {
  const [loginHistory, auditLogs, passwordPolicy, refreshTokens] = await Promise.all([
    prisma.loginHistory.findMany({ include: { user: true, tenant: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.passwordPolicy.upsert({ where: { id: 'DEFAULT' }, update: {}, create: { id: 'DEFAULT' } }),
    prisma.refreshToken.findMany({ include: { user: true }, orderBy: { createdAt: 'desc' }, take: 100 })
  ]);
  res.render('security/index', { title: 'Security Center', loginHistory, auditLogs, passwordPolicy, refreshTokens });
});

router.post('/password-policy', async (req, res) => {
  await prisma.passwordPolicy.upsert({
    where: { id: 'DEFAULT' },
    update: {
      minLength: Number(req.body.minLength || 8),
      requireUppercase: req.body.requireUppercase === 'on',
      requireLowercase: req.body.requireLowercase === 'on',
      requireNumber: req.body.requireNumber === 'on',
      requireSpecial: req.body.requireSpecial === 'on',
      expiryDays: Number(req.body.expiryDays || 90),
      maxFailedAttempts: Number(req.body.maxFailedAttempts || 5)
    },
    create: { id: 'DEFAULT' }
  });
  res.redirect('/security');
});

router.post('/refresh-tokens/:id/revoke', async (req, res) => {
  await prisma.refreshToken.update({ where: { id: req.params.id }, data: { revokedAt: new Date() } });
  res.redirect('/security');
});

module.exports = router;
