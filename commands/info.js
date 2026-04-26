// commands/Info.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Shows creator and bot details'),
  async execute(interaction) {
    const uptimeSeconds = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const uptimeString = `${hours}h ${minutes}m ${seconds}s`;

    const embed = new EmbedBuilder()
      .setTitle('🤖 Bot Information')
      .addFields(
        { name: 'Creator', value: 'Not_Lowest', inline: true },
        { name: 'GitHub',   value: '[github.com/gmoddev](https://github.com/gmoddev)', inline: true },
        { name: 'Uptime',   value: uptimeString, inline: true }
      )
      .setThumbnail(interaction.client.user.displayAvatarURL())
      .setTimestamp()
      .setColor(0x00AE86);

    await interaction.reply({ embeds: [embed] });
  },
};
