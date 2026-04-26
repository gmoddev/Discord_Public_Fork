const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'log_channels.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS rank_log_channels (
    guild_id TEXT PRIMARY KEY,
    promotion_channel TEXT,
    demotion_channel TEXT
  );
`);

function setChannel(guildId, type, channelId) {
  const column = type === 'promotion' ? 'promotion_channel' : 'demotion_channel';
  db.prepare(`INSERT INTO rank_log_channels (guild_id, ${column}) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET ${column} = excluded.${column}
  `).run(guildId, channelId);
}

function getChannel(guildId, type) {
  const row = db.prepare('SELECT * FROM rank_log_channels WHERE guild_id = ?').get(guildId);
  return row ? row[`${type}_channel`] : null;
}

module.exports = {
  name: 'LogRankChange',
  data: new SlashCommandBuilder()
    .setName('logrankchange')
    .setDescription('Log rank promotions and demotions')
    .addSubcommand(sub =>
      sub.setName('setpromotionchannel')
        .setDescription('Set the channel for promotion logs')
        .addChannelOption(opt =>
          opt.setName('channel').setDescription('The channel').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('setdemotionchannel')
        .setDescription('Set the channel for demotion logs')
        .addChannelOption(opt =>
          opt.setName('channel').setDescription('The channel').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('promotion')
        .setDescription('Log a promotion')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption(o => o.setName('from_rank').setDescription('From rank').setRequired(true))
        .addStringOption(o => o.setName('to_rank').setDescription('To rank').setRequired(true))
        .addStringOption(o => o.setName('note').setDescription('Note'))
    )
    .addSubcommand(sub =>
      sub.setName('demotion')
        .setDescription('Log a demotion')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption(o => o.setName('from_rank').setDescription('From rank').setRequired(true))
        .addStringOption(o => o.setName('to_rank').setDescription('To rank').setRequired(true))
        .addStringOption(o => o.setName('note').setDescription('Note'))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'setpromotionchannel') {
      const channel = interaction.options.getChannel('channel');
      setChannel(guildId, 'promotion', channel.id);
      return interaction.reply({ content: `✅ Promotion log channel set to ${channel}.`, ephemeral: true });
    }

    if (sub === 'setdemotionchannel') {
      const channel = interaction.options.getChannel('channel');
      setChannel(guildId, 'demotion', channel.id);
      return interaction.reply({ content: `✅ Demotion log channel set to ${channel}.`, ephemeral: true });
    }

    const user = interaction.options.getUser('user');
    const fromRank = interaction.options.getString('from_rank');
    const toRank = interaction.options.getString('to_rank');
    const note = interaction.options.getString('note') || 'No additional message provided.';

    const type = sub;
    const channelId = getChannel(guildId, type);
    if (!channelId) {
      return interaction.reply({ content: `❌ No ${type} log channel is set.`, ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(type === 'promotion' ? 0x00FF88 : 0xFF5555)
      .setTitle(type === 'promotion' ? '🎉 Promotion!' : '⚠️ Demotion')
      .addFields(
        { name: 'User', value: `<@${user.id}>`, inline: true },
        { name: 'From', value: fromRank, inline: true },
        { name: 'To', value: toRank, inline: true },
        { name: 'Note', value: note }
      )
      .setTimestamp();

    const channel = await interaction.client.channels.fetch(channelId);
    await channel.send({ embeds: [embed] });
    await interaction.reply({ content: `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} logged for <@${user.id}>.`, ephemeral: true });
  }
};
