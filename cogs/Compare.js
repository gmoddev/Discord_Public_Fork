const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

let CachedGuildChoices = [];

const CompareUsersCommand = new SlashCommandBuilder()
  .setName('compareusers')
  .setDescription('Compare users between two servers.')
  .addStringOption(opt =>
    opt.setName('servera')
      .setDescription('First server')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('serverb')
      .setDescription('Second server')
      .setRequired(true)
  );

module.exports = {
  name: 'CompareUsersInServer',

  events: {
    ready: async (client) => {
      CachedGuildChoices = client.guilds.cache.map(g => ({ name: g.name, value: g.id })).slice(0, 25);

      if (CachedGuildChoices.length > 0) {
        CompareUsersCommand.options[0].choices = CachedGuildChoices;
        CompareUsersCommand.options[1].choices = CachedGuildChoices;
      }

      console.log('✅ [CompareUsersInServer] Cached guild choices for slash command');
    }
  },

  commands: [
    {
      data: CompareUsersCommand,
      async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
          return interaction.reply({ content: '❌ Manage Server Permission Required.', ephemeral: true });
        }

        await interaction.deferReply();

        const serverAId = interaction.options.getString('servera');
        const serverBId = interaction.options.getString('serverb');

        if (serverAId === serverBId) {
          return interaction.editReply('❌ You must pick two different servers.');
        }

        try {
          const guildA = await interaction.client.guilds.fetch(serverAId);
          const guildB = await interaction.client.guilds.fetch(serverBId);

          if (!guildA || !guildB) {
            return interaction.editReply('❌ One or both servers could not be fetched.');
          }

          const membersA = await guildA.members.fetch();
          const membersB = await guildB.members.fetch();

          const idsA = new Set(membersA.map(m => m.id));
          const idsB = new Set(membersB.map(m => m.id));

          const both = [];
          const onlyA = [];
          const onlyB = [];

          for (const m of membersA.values()) {
            if (idsB.has(m.id)) both.push(m.user.tag);
            else onlyA.push(m.user.tag);
          }

          for (const m of membersB.values()) {
            if (!idsA.has(m.id)) onlyB.push(m.user.tag);
          }

          let out = `✅ **Compare Results:**\n\n**In Both Servers (${both.length}):**\n`;
          out += both.length ? both.join('\n') : 'None';
          out += `\n\n**Only In ${guildA.name} (${onlyA.length}):**\n`;
          out += onlyA.length ? onlyA.join('\n') : 'None';
          out += `\n\n**Only In ${guildB.name} (${onlyB.length}):**\n`;
          out += onlyB.length ? onlyB.join('\n') : 'None';

          if (out.length > 2000) {
            out = out.slice(0, 1900) + '\n…Output Truncated…';
          }

          await interaction.editReply(out);
        } catch (err) {
          console.error('[CompareUsersInServer] Error:', err);
          await interaction.editReply('❌ Error comparing users. Check console for details.');
        }
      }
    }
  ]
};
