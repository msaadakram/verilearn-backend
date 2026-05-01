const jwt = require('jsonwebtoken');

const User = require('../models/User');
const { hasAnyRole } = require('../utils/roles');

async function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Authorization token is required.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);

    if (!user) {
      return res.status(401).json({ message: 'User no longer exists.' });
    }

    req.auth = payload;
    req.user = user;

    return next();
  } catch (_error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication is required.' });
    }

    const authorized = hasAnyRole(req.user, allowedRoles);

    if (!authorized) {
      return res.status(403).json({
        message: `Access denied. This resource is restricted to ${allowedRoles.join(', ')} role(s).`,
      });
    }

    return next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication is required.' });
  }

  if (!req.user.isAdmin) {
    return res.status(403).json({
      message: 'Access denied. This resource is restricted to administrators.',
    });
  }

  return next();
}

module.exports = {
  requireAuth,
  requireRole,
  requireAdmin,
};
