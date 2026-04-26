const { SlashCommandBuilder } = require('discord.js');
const { IsOwner } = require('../helpers/RankChecker');

module.exports = {
  name: 'ForceLeaveServer',

  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('forceleaveserver')
        .setDescription('Force the bot to leave a server (bot owner only)')
        .addStringOption(option =>
          option.setName('guildid')
            .setDescription('The ID of the server the bot should leave')
            .setRequired(true)
        ),

      async execute(interaction) {
        if (!IsOwner(interaction)) {
          return interaction.reply({
            content: '❌ You do not have permission to use this command.',
            ephemeral: true
          });
        }

        const guildId = interaction.options.getString('guildid');
        const guild = interaction.client.guilds.cache.get(guildId);

        if (!guild) {
          return interaction.reply({
            content: `❌ I am not in a guild with the ID \`${guildId}\`.`,
            ephemeral: true
          });
        }

        try {
          await guild.leave();
          await interaction.reply({
            content: `✅ Successfully left **${guild.name}** (\`${guildId}\`).`,
            ephemeral: true
          });
          console.log(`⚠️ Bot was forced to leave guild: ${guild.name} (${guildId})`);
        } catch (err) {
          console.error(`Failed to leave guild ${guildId}:`, err);
          await interaction.reply({
            content: `❌ Failed to leave guild \`${guildId}\`. Check logs for details.`,
            ephemeral: true
          });
        }
      }
    }
  ]
};
