const { PermissionFlagsBits } = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Connect to SQLite DB
const dbPath = path.join(dataDir, 'promotion_data.db');
const db = new Database(dbPath);

// Ensure command permission table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS command_permissions (
    guild_id TEXT,
    command TEXT,
    role_id TEXT,
    user_id TEXT,
    PRIMARY KEY (guild_id, command, role_id, user_id)
  );
`);

// Global bot owners (bypass everything)
const OWNER_IDS = ['271772941044285443','1030659798460530820'];

// Command registry (cached on startup)
const CommandSet = new Set();

/**
 * Register a command name at startup
 * @param {string} commandName 
 */
function registerCommand(commandName) {
  CommandSet.add(commandName);
}

/**
 * Check if the user is a global admin or owner
 * @param {import('discord.js').GuildMember | import('discord.js').Interaction} target
 * @returns {boolean}
 */
function isAdmin(target) {
  const member = target.member ?? target;
  return (
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    OWNER_IDS.includes(member.id)
  );
}

/**
 * Check if the user is a global  owner
 * @param {import('discord.js').GuildMember | import('discord.js').Interaction} target
 * @returns {boolean}
 */
function IsOwner(target) {
  const member = target.member ?? target;
  return (
    OWNER_IDS.includes(member.id)
  );
}

function GetBotOwner() {
  return OWNER_IDS
}

/**
 * Checks if the user/role can run a command (per-guild)
 * @param {import('discord.js').GuildMember | import('discord.js').Interaction} target
 * @param {string} commandName
 * @returns {boolean}
 */
function CanRunCommand(target, commandName) {
  const member = target.member ?? target;
  const guildId = member.guild.id;

  // Always allow if global admin or unknown command
  if (isAdmin(member) || !CommandSet.has(commandName)) return true;

  // User-level permission
  const userAllowed = db.prepare(`
    SELECT 1 FROM command_permissions
    WHERE guild_id = ? AND command = ? AND user_id = ?
  `).get(guildId, commandName, member.id);
  if (userAllowed) return true;

  // Role-level permission
  const roleIds = member.roles.cache.map(role => role.id);
  const roleAllowed = db.prepare(`
    SELECT 1 FROM command_permissions
    WHERE guild_id = ? AND command = ? AND role_id IN (${roleIds.map(() => '?').join(',')})
  `).get(guildId, commandName, ...roleIds);

  return !!roleAllowed;
}

module.exports = {
  isAdmin,
  IsOwner,
  CanRunCommand,
  registerCommand,
  GetBotOwner
};
