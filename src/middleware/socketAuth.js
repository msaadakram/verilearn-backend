const jwt = require('jsonwebtoken');
const { getEnv } = require('../config/env');
const { normalizeActiveMode, canUserAccessMode } = require('../services/messageService');
const { getUserRoles } = require('../utils/roles');
const User = require('../models/User');

const env = getEnv();

/**
 * Middleware to authenticate socket connections using JWT token
 * Token should be sent in socket handshake query: ?token=<jwt>
 */
function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth.token || socket.handshake.query?.token;
  const activeMode = socket.handshake.auth.activeMode || socket.handshake.query?.activeMode;

  if (!token) {
    return next(new Error('Authentication required: no token provided'));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    socket.userId = decoded.sub || decoded.userId;
    socket.roles = Array.isArray(decoded.roles) ? decoded.roles : [];
    socket.profession = decoded.profession;
    socket.email = decoded.email;
    socket.activeMode = normalizeActiveMode(activeMode, socket.profession || socket.roles[0] || 'student');

    if (!socket.userId) {
      return next(new Error('Authentication failed: token payload missing user id'));
    }

    if (!socket.activeMode) {
      return next(new Error('Authentication failed: invalid activeMode provided'));
    }

    User.findById(socket.userId)
      .then((user) => {
        if (!user) {
          throw new Error('Authentication failed: user not found');
        }

        if (!canUserAccessMode(user, socket.activeMode)) {
          throw new Error(`Access denied for ${socket.activeMode} mode`);
        }

        socket.user = user;
        socket.roles = getUserRoles(user);

        next();
      })
      .catch((error) => next(new Error(`Authentication failed: ${error.message}`)));
  } catch (error) {
    next(new Error(`Authentication failed: ${error.message}`));
  }
}

module.exports = socketAuthMiddleware;
