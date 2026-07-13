const express = require('express');
const prisma = require('../config/prisma');
const { signToken, signRefreshToken, comparePassword } = require('../utils/auth');
const crypto = require('crypto');
const router = express.Router();

router.get('/login', (req, res) => res.render('auth/login', { title: 'Login', error: null }));

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const identifier = String(email || '').trim();
    const user = await prisma.user.findFirst({ where: { OR: [{ email: identifier }, { username: identifier }] }, include: { role: true, tenant: true } });
    const ok = user && await comparePassword(password, user.password);
    await prisma.loginHistory.create({ data: {
      userId: user?.id || null, tenantId: user?.tenantId || null, email, status: ok ? 'SUCCESS' : 'FAILED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null, userAgent: req.headers['user-agent'] || null,
      message: ok ? 'Login successful' : 'Invalid credentials'
    }}).catch(() => {});
    if (!ok) {
      return res.render('auth/login', { title: 'Login', error: 'Invalid email or password' });
    }
    const refreshToken = signRefreshToken(user);
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({ data: { userId: user.id, tokenHash, expiresAt, ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null, userAgent: req.headers['user-agent'] || null } }).catch(() => {});
    res.cookie('token', signToken(user), { httpOnly: true, sameSite: process.env.COOKIE_SAME_SITE || 'lax', secure: process.env.NODE_ENV === 'production' });
    res.cookie('refreshToken', refreshToken, { httpOnly: true, sameSite: process.env.COOKIE_SAME_SITE || 'lax', secure: process.env.NODE_ENV === 'production' });
    if (user.role?.scope === 'SMART_DATA') return res.redirect('/superadmin');
    return res.redirect('/client');
  } catch (error) {
    console.error(error);
    return res.render('auth/login', { title: 'Login', error: 'Login failed. Please check server logs.' });
  }
});

router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.clearCookie('refreshToken');
  res.redirect('/login');
});

module.exports = router;
