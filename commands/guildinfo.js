// commands/GuildInfo.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('guildinfo')
    .setDescription('Shows information about this server'),

  async execute(interaction) {

    const Guild = interaction.guild;

    const Owner = await Guild.fetchOwner();

    const MemberCount = Guild.memberCount;
    const RoleCount = Guild.roles.cache.size;
    const ChannelCount = Guild.channels.cache.size;

    const CreatedAt = `<t:${Math.floor(Guild.createdTimestamp / 1000)}:F>`;

    const Embed = new EmbedBuilder()
      .setTitle(`📊 ${Guild.name} Information`)
      .setThumbnail(Guild.iconURL({ dynamic: true }))
      .addFields(
        { name: 'Owner', value: `<@${Owner.id}>`, inline: true },
        { name: 'Members', value: `${MemberCount}`, inline: true },
        { name: 'Roles', value: `${RoleCount}`, inline: true },
        { name: 'Channels', value: `${ChannelCount}`, inline: true },
        { name: 'Server ID', value: Guild.id, inline: true },
        { name: 'Created', value: CreatedAt, inline: true }
      )
      .setColor(0x00AE86)
      .setTimestamp();

    await interaction.reply({ embeds: [Embed] });
  },
};