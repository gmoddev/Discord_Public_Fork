const { SlashCommandBuilder } = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');

const fs = require('fs');
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });


const db = new Database(path.join(__dirname, '..', 'data', 'promotion_data.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS configs (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT,
    max_per_day INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS thresholds (
    guild_id TEXT,
    role_id TEXT,
    points_required INTEGER,
    PRIMARY KEY (guild_id, role_id)
  );
  CREATE TABLE IF NOT EXISTS points (
    guild_id TEXT,
    user_id TEXT,
    points INTEGER,
    last_updated TEXT,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS admins (
    guild_id TEXT,
    user_id TEXT,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS allowed_roles (
    guild_id TEXT,
    role_id TEXT,
    PRIMARY KEY (guild_id, role_id)
  );
`);

function isAdmin(guildId, userId) {
  const row = db.prepare('SELECT 1 FROM admins WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return !!row;
}

function canAddPoints(guildId, roleIds) {
  const stmt = db.prepare('SELECT role_id FROM allowed_roles WHERE guild_id = ?');
  const allowed = stmt.all(guildId).map(r => r.role_id);
  return roleIds.some(id => allowed.includes(id));
}

function getConfig(guildId) {
  const row = db.prepare('SELECT * FROM configs WHERE guild_id = ?').get(guildId);
  return row || { channel_id: null, max_per_day: 1 };
}

function getUserPoints(guildId, userId) {
  const row = db.prepare('SELECT * FROM points WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return row || { points: 0, last_updated: null };
}

function getThresholds(guildId) {
  return db.prepare('SELECT * FROM thresholds WHERE guild_id = ?').all(guildId);
}

module.exports = {
  name: 'PromotionPoints',
  data: new SlashCommandBuilder()
    .setName('promotionpoints')
    .setDescription('Manage and assign promotion points')
    .addSubcommand(sub => sub.setName('add').setDescription('Add a promotion point').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove a promotion point').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(sub => sub.setName('info').setDescription('Check promotion points').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommandGroup(group =>
      group.setName('config').setDescription('Promotion system config')
        .addSubcommand(sub => sub.setName('allow-role').setDescription('Allow role to assign points').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand(sub => sub.setName('set-threshold').setDescription('Set required points for role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)).addIntegerOption(o => o.setName('points').setDescription('Points').setRequired(true)))
        .addSubcommand(sub => sub.setName('set-channel').setDescription('Set the promotion notification channel').addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
        .addSubcommand(sub => sub.setName('set-max-per-day').setDescription('Max points per person per day').addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true)))
        .addSubcommand(sub => sub.setName('add-admin').setDescription('Add a promotion admin').addUserOption(o => o.setName('user').setDescription('User').setRequired(true))))
,

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);

    if (group === 'config') {
      const role = interaction.options.getRole('role');
      const channel = interaction.options.getChannel('channel');
      const amount = interaction.options.getInteger('amount');
      const targetUser = interaction.options.getUser('user');

      switch (sub) {
        case 'allow-role':
          db.prepare('INSERT OR IGNORE INTO allowed_roles (guild_id, role_id) VALUES (?, ?)').run(guildId, role.id);
          break;
        case 'set-threshold':
          db.prepare('INSERT OR REPLACE INTO thresholds (guild_id, role_id, points_required) VALUES (?, ?, ?)').run(guildId, role.id, amount);
          break;
        case 'set-channel':
          db.prepare('INSERT OR REPLACE INTO configs (guild_id, channel_id) VALUES (?, ?)').run(guildId, channel.id);
          break;
        case 'set-max-per-day':
          db.prepare('INSERT OR REPLACE INTO configs (guild_id, max_per_day) VALUES (?, ?)').run(guildId, amount);
          break;
        case 'add-admin':
          db.prepare('INSERT OR IGNORE INTO admins (guild_id, user_id) VALUES (?, ?)').run(guildId, targetUser.id);
          break;
      }
      return interaction.reply({ content: `✅ Updated config: ${sub}`, ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    const member = interaction.guild.members.cache.get(targetUser.id);
    const issuer = interaction.guild.members.cache.get(userId);
    const config = getConfig(guildId);
    const thresholds = getThresholds(guildId);
    const userEntry = getUserPoints(guildId, targetUser.id);
    const now = new Date();
    const isSameDay = userEntry.last_updated && new Date(userEntry.last_updated).toDateString() === now.toDateString();

    if (sub === 'add') {
      if (!isAdmin(guildId, userId) && !canAddPoints(guildId, [...issuer.roles.cache.keys()])) {
        return interaction.reply({ content: '🚫 No permission to add points.', ephemeral: true });
      }
      if (!isAdmin(guildId, userId)) {
        if (member.roles.highest.position >= issuer.roles.highest.position) {
          return interaction.reply({ content: '🚫 Cannot promote equal or higher ranked user.', ephemeral: true });
        }
        if (isSameDay && userEntry.points >= config.max_per_day) {
          return interaction.reply({ content: `⚠️ Max daily points reached (${config.max_per_day}).`, ephemeral: true });
        }
      }
      const newPoints = userEntry.points + 1;
      db.prepare('INSERT OR REPLACE INTO points (guild_id, user_id, points, last_updated) VALUES (?, ?, ?, ?)')
        .run(guildId, targetUser.id, newPoints, now.toISOString());

      for (const row of thresholds) {
        if (newPoints >= row.points_required && !member.roles.cache.has(row.role_id)) {
          const channel = config.channel_id ? interaction.guild.channels.cache.get(config.channel_id) : interaction.guild.channels.cache.find(c => c.isTextBased());
          if (channel) await channel.send(`🎉 ${member.user} is ready for promotion to <@&${row.role_id}>!`);
          break;
        }
      }
      return interaction.reply({ content: `✅ Added. Total: ${newPoints}`, ephemeral: true });

    } else if (sub === 'remove') {
      const newPoints = Math.max(0, userEntry.points - 1);
      db.prepare('INSERT OR REPLACE INTO points (guild_id, user_id, points, last_updated) VALUES (?, ?, ?, ?)')
        .run(guildId, targetUser.id, newPoints, now.toISOString());
      return interaction.reply({ content: `✅ Removed. Total: ${newPoints}`, ephemeral: true });

    } else if (sub === 'info') {
      return interaction.reply({ content: `ℹ️ ${targetUser.tag} has ${userEntry.points} promotion points.`, ephemeral: true });
    }
  }
};
