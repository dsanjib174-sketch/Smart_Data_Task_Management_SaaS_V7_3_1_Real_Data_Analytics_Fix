const prisma = require('../config/prisma');
const { verifyToken } = require('../utils/auth');

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) return res.redirect('/login');
    const decoded = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: decoded.id }, include: { role: true, tenant: true } });
    if (!user || user.status !== 'ACTIVE') return res.redirect('/login');
    req.user = user;
    res.locals.currentUser = user;
    next();
  } catch (error) {
    return res.redirect('/login');
  }
}

function requireSmartData(req, res, next) {
  if (!req.user?.role || req.user.role.scope !== 'SMART_DATA') return res.status(403).send('Access denied');
  next();
}

function requireClient(req, res, next) {
  if (!req.user?.tenantId) return res.status(403).send('Client access only');
  next();
}

module.exports = { requireAuth, requireSmartData, requireClient };
