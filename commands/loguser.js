const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logmember')
    .setDescription('Logs the entire GuildMember object of a user.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to log')
        .setRequired(true)
),  

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: 'User not found in this guild.', ephemeral: true });
    }

    console.log('--- GuildMember Object ---');
    console.dir(member, { depth: null });

    await interaction.reply({ content: `Logged data for ${member.user.tag}`, ephemeral: true });
  }
};
