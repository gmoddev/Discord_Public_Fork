const DefaultRoleGroups = require('../config/DefaultRoleGroups');

/**
 * Later this can come from:
 * - SQLite
 * - Mongo
 * - Redis
 * - JSON
 */
async function GetRoleGroupsForGuild(guildId) {
  // TODO: replace with DB lookup
  // const dbGroups = await db.getRoleGroups(guildId);

  const dbGroups = null;

  if (Array.isArray(dbGroups) && dbGroups.length > 0) {
    return [...DefaultRoleGroups, ...dbGroups];
  }

  return DefaultRoleGroups;
}

module.exports = {
  GetRoleGroupsForGuild,
};
