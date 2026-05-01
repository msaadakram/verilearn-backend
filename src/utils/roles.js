'use strict';

const VALID_ROLES = ['student', 'teacher'];

function normalizeRole(role) {
  if (typeof role !== 'string') {
    return null;
  }

  const normalized = role.trim().toLowerCase();
  return VALID_ROLES.includes(normalized) ? normalized : null;
}

function getUserRoles(user) {
  const fromArray = Array.isArray(user?.roles)
    ? user.roles
      .map((role) => normalizeRole(role))
      .filter(Boolean)
    : [];

  const professionRole = normalizeRole(user?.profession);
  const roleSet = new Set(fromArray);

  if (professionRole) {
    roleSet.add(professionRole);
  }

  if (user?.teacherProfile?.dashboardUnlocked === true) {
    roleSet.add('teacher');
    roleSet.add('student');
  }

  if (roleSet.size === 0) {
    roleSet.add('student');
  }

  return Array.from(roleSet);
}

function hasRole(user, role) {
  const normalized = normalizeRole(role);
  if (!normalized) {
    return false;
  }

  return getUserRoles(user).includes(normalized);
}

function hasAnyRole(user, roles = []) {
  return roles.some((role) => hasRole(user, role));
}

module.exports = {
  VALID_ROLES,
  normalizeRole,
  getUserRoles,
  hasRole,
  hasAnyRole,
};
