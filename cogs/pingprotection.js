const { Events, PermissionsBitField, SlashCommandBuilder } = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');
const { registerCommand } = require('../helpers/RankChecker');

registerCommand('PingProtection');
registerCommand('togglepingprotection');
registerCommand('addprotectedrole');
registerCommand('removeprotectedrole');
registerCommand('addprotecteduser');
registerCommand('setpingthreshold');
registerCommand('resetstrikes');
registerCommand('protectedstatus');

const db = new Database(path.join(__dirname, '..', 'data', 'ping_protection.db'));

db.prepare(`CREATE TABLE IF NOT EXISTS ping_settings (guild_id TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1, threshold INTEGER DEFAULT 4);`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS ping_protected_roles (guild_id TEXT, role_id TEXT, PRIMARY KEY (guild_id, role_id));`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS ping_protected_users (guild_id TEXT, user_id TEXT, PRIMARY KEY (guild_id, user_id));`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS ping_strikes (guild_id TEXT, user_id TEXT, count INTEGER DEFAULT 0, PRIMARY KEY (guild_id, user_id));`).run();

const getGuildConfig = db.prepare(`SELECT * FROM ping_settings WHERE guild_id = ?`);
const getProtectedRoles = db.prepare(`SELECT role_id FROM ping_protected_roles WHERE guild_id = ?`);
const getProtectedUsers = db.prepare(`SELECT user_id FROM ping_protected_users WHERE guild_id = ?`);
const getStrike = db.prepare(`SELECT count FROM ping_strikes WHERE guild_id = ? AND user_id = ?`);
const incrementStrike = db.prepare(`INSERT INTO ping_strikes (guild_id, user_id, count) VALUES (?, ?, 1) ON CONFLICT(guild_id, user_id) DO UPDATE SET count = count + 1`);
const resetStrikes = db.prepare(`DELETE FROM ping_strikes WHERE guild_id = ? AND user_id = ?`);
const addProtectedRole = db.prepare(`INSERT OR IGNORE INTO ping_protected_roles (guild_id, role_id) VALUES (?, ?)`);
const removeProtectedRole = db.prepare(`DELETE FROM ping_protected_roles WHERE guild_id = ? AND role_id = ?`);
const addProtectedUser = db.prepare(`INSERT OR IGNORE INTO ping_protected_users (guild_id, user_id) VALUES (?, ?)`);
const updateThreshold = db.prepare(`UPDATE ping_settings SET threshold = ? WHERE guild_id = ?`);

module.exports = {
  name: 'PingProtection',
  event: Events.MessageCreate,
  async onEvent(client, message) {
    if (message.author.bot || !message.guild) return;

    const guildId = message.guild.id;
    const author = message.member;

    const config = getGuildConfig.get(guildId);
    if (!config || config.enabled !== 1) return;

    if (author.permissions.has(PermissionsBitField.Flags.Administrator)) return;

    const protectedRoles = getProtectedRoles.all(guildId).map(r => r.role_id);
    const protectedUsers = getProtectedUsers.all(guildId).map(u => u.user_id);

    if (protectedRoles.length === 0 && protectedUsers.length === 0) return;
    if (author.roles.cache.some(role => protectedRoles.includes(role.id)) || protectedUsers.includes(author.id)) return;

    if (!message.mentions.roles.some(role => protectedRoles.includes(role.id))) return;

    incrementStrike.run(guildId, author.id);

    const { count } = getStrike.get(guildId, author.id);
    const threshold = config.threshold || 4;

    if (count >= threshold) {
      try {
        await message.member.timeout(300000, 'Excessive protected role pinging');
        await message.reply(`⚠️ Timed out for 5 minutes due to excessive pings.`);
        resetStrikes.run(guildId, author.id);
      } catch (err) {
        console.error('[PingProtection] Timeout failed:', err);
      }
    } else {
      await message.reply(`⚠️ Warning: Pinging protected roles. (${count}/${threshold})`);
    }
  },

  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('togglepingprotection')
        .setDescription('Enable or disable ping protection.'),
      async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: '❌ Admins only.', ephemeral: true });
        }
        const current = getGuildConfig.get(interaction.guildId);
        const newState = current?.enabled === 1 ? 0 : 1;
        if (current) {
          db.prepare(`UPDATE ping_settings SET enabled = ? WHERE guild_id = ?`).run(newState, interaction.guildId);
        } else {
          db.prepare(`INSERT INTO ping_settings (guild_id, enabled) VALUES (?, ?)`).run(interaction.guildId, newState);
        }
        await interaction.reply(`✅ Ping protection ${newState ? 'enabled' : 'disabled'}.`);
      }
    },
    {
      data: new SlashCommandBuilder()
        .setName('addprotectedrole')
        .setDescription('Add a protected role')
        .addRoleOption(option => option.setName('role').setDescription('Role to protect').setRequired(true)),
      async execute(interaction) {
        const role = interaction.options.getRole('role');
        addProtectedRole.run(interaction.guildId, role.id);
        await interaction.reply(`✅ ${role.name} added to protected roles.`);
      }
    },
    {
      data: new SlashCommandBuilder()
        .setName('removeprotectedrole')
        .setDescription('Remove a protected role')
        .addRoleOption(option => option.setName('role').setDescription('Role to unprotect').setRequired(true)),
      async execute(interaction) {
        const role = interaction.options.getRole('role');
        removeProtectedRole.run(interaction.guildId, role.id);
        await interaction.reply(`✅ ${role.name} removed from protected roles.`);
      }
    },
    {
      data: new SlashCommandBuilder()
        .setName('addprotecteduser')
        .setDescription('Add a protected user')
        .addUserOption(option => option.setName('user').setDescription('User to protect').setRequired(true)),
      async execute(interaction) {
        const user = interaction.options.getUser('user');
        addProtectedUser.run(interaction.guildId, user.id);
        await interaction.reply(`✅ ${user.tag} added to protected users.`);
      }
    },
    {
      data: new SlashCommandBuilder()
        .setName('setpingthreshold')
        .setDescription('Set ping strike threshold')
        .addIntegerOption(option => option.setName('count').setDescription('Strike count before timeout').setRequired(true)),
      async execute(interaction) {
        const count = interaction.options.getInteger('count');
        updateThreshold.run(count, interaction.guildId);
        await interaction.reply(`✅ Threshold set to ${count}.`);
      }
    },
    {
      data: new SlashCommandBuilder()
        .setName('resetstrikes')
        .setDescription('Reset user ping strikes')
        .addUserOption(option => option.setName('user').setDescription('User to reset').setRequired(true)),
      async execute(interaction) {
        const user = interaction.options.getUser('user');
        resetStrikes.run(interaction.guildId, user.id);
        await interaction.reply(`✅ Reset ping strikes for ${user.tag}.`);
      }
    },
    {
      data: new SlashCommandBuilder()
        .setName('protectedstatus')
        .setDescription('View all protected roles and users for this server.'),
      async execute(interaction) {
        const protectedRoles = getProtectedRoles.all(interaction.guildId);
        const protectedUsers = getProtectedUsers.all(interaction.guildId);
        const config = getGuildConfig.get(interaction.guildId);

        const roleList = protectedRoles.map(r => `<@&${r.role_id}>`).join(', ') || 'None';
        const userList = protectedUsers.map(u => `<@${u.user_id}>`).join(', ') || 'None';
        const isEnabled = config?.enabled === 1 ? '✅ Enabled' : '❌ Disabled';
        const threshold = config?.threshold || 4;

        await interaction.reply({
          content: `**Ping Protection Status**\nStatus: ${isEnabled}\nThreshold: ${threshold}\nProtected Roles: ${roleList}\nProtected Users: ${userList}`,
          ephemeral: true
        });
      }
    }
  ]
};