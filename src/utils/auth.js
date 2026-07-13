const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, hashedPassword) {
  if (!password || !hashedPassword) return false;
  return bcrypt.compare(password, hashedPassword);
}

function signToken(user) {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'smart-data-dev-secret';
  return jwt.sign({ id: user.id, email: user.email, role: user.role?.name, scope: user.role?.scope, tenantId: user.tenantId }, secret, { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
}

function signRefreshToken(user) {
  const secret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET || 'smart-data-refresh-secret';
  return jwt.sign({ id: user.id, type: 'refresh' }, secret, { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d' });
}

function verifyToken(token) {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'smart-data-dev-secret';
  return jwt.verify(token, secret);
}

module.exports = { hashPassword, comparePassword, signToken, signRefreshToken, verifyToken };
