const { ChannelType, PermissionsBitField, SlashCommandBuilder } = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'server_stats_config.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 1
  );
`);

function isStatsEnabled(guildId) {
  const row = db.prepare('SELECT enabled FROM guild_settings WHERE guild_id = ?').get(guildId);
  return !row || row.enabled === 1;
}

function setStatsEnabled(guildId, enabled) {
  db.prepare('INSERT OR REPLACE INTO guild_settings (guild_id, enabled) VALUES (?, ?)').run(guildId, enabled ? 1 : 0);
}

async function updateStats(guild) {
  if (!isStatsEnabled(guild.id)) return;

  const hasPermissions = guild.members.me.permissions.has([
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ViewChannel
  ]);

  if (!hasPermissions) {
    console.warn(`⚠️ Missing permissions in ${guild.name}`);
    return;
  }

  let category = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === '📊 SERVER STATS 📊'
  );

  if (!category) {
    category = await guild.channels.create({
      name: '📊 SERVER STATS 📊',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [{
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.Connect],
      }],
    });
  }

  const ensureChannel = async (nameStart, count) => {
    let existing = guild.channels.cache.find(
      c => c.type === ChannelType.GuildVoice && c.name.startsWith(nameStart)
    );
    const finalName = `${nameStart}${count}`;

    if (!existing) {
      await guild.channels.create({
        name: finalName,
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: [{
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.Connect],
        }]
      });
    } else if (existing.name !== finalName) {
      await existing.setName(finalName);
    }
  };

  const members = await guild.members.list({ limit: 1000 });
  const allMembers = guild.memberCount;
  const botCount = members.filter(m => m.user.bot).size;
  const humanCount = allMembers - botCount;

  await ensureChannel('All Members: ', allMembers);
  await ensureChannel('Members: ', humanCount);
  await ensureChannel('Bots: ', botCount);

  console.log(`✅ Server stats updated for ${guild.name}`);
}

module.exports = {
  name: 'ServerStats',
  event: 'ready',
  onEvent: async (client) => {
    console.log('📊 Checking server stats setup...');
    for (const [guildId, guild] of client.guilds.cache) {
      if (!isStatsEnabled(guildId)) continue;
      await updateStats(guild);
    }

    client.on('guildMemberAdd', async member => {
      await updateStats(member.guild);
    });

    client.on('guildMemberRemove', async member => {
      await updateStats(member.guild);
    });
  },

  data: new SlashCommandBuilder()
    .setName('serverstats')
    .setDescription('Enable or disable server stats')
    .addSubcommand(sub =>
      sub.setName('enable')
        .setDescription('Enable server stats and create/update channels')
    )
    .addSubcommand(sub =>
      sub.setName('disable')
        .setDescription('Disable server stats and delete the channels')
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();

    if (!guild) {
      return interaction.reply({ content: '❌ This command must be used in a server.', ephemeral: true });
    }

    if (sub === 'enable') {
      setStatsEnabled(guild.id, true);
      await updateStats(guild);
      await interaction.reply({ content: '✅ Server stats have been **enabled** and updated.', ephemeral: true });
    }

    if (sub === 'disable') {
      setStatsEnabled(guild.id, false);

      const category = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name === '📊 SERVER STATS 📊'
      );

      if (category) {
        for (const channel of guild.channels.cache.filter(c => c.parentId === category.id).values()) {
          await channel.delete().catch(console.warn);
        }
        await category.delete().catch(console.warn);
      }

      await interaction.reply({ content: '🛑 Server stats have been **disabled** and channels removed.', ephemeral: true });
    }
  }
};
