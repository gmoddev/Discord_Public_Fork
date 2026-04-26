const { SlashCommandBuilder } = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '..', 'data', 'promotion_data.db'));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('command')
    .setDescription('Manage command permissions')
    .addSubcommand(sub =>
      sub.setName('allow-role')
        .setDescription('Allow a role to use a command')
        .addStringOption(o =>
          o.setName('command')
            .setDescription('Command name')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role')
            .setRequired(true)
        ))
    .addSubcommand(sub =>
      sub.setName('allow-user')
        .setDescription('Allow a user to use a command')
        .addStringOption(o =>
          o.setName('command')
            .setDescription('Command name')
            .setRequired(true)
            .setAutocomplete(true) 
        )
        .addUserOption(o =>
          o.setName('user')
            .setDescription('User')
            .setRequired(true)
        )),
  
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const commandName = interaction.options.getString('command');

    if (sub === 'allow-role') {
      const role = interaction.options.getRole('role');
      db.prepare(`
        INSERT OR IGNORE INTO command_permissions (guild_id, command, role_id, user_id)
        VALUES (?, ?, ?, NULL)
      `).run(guildId, commandName, role.id);
      return interaction.reply({ content: `✅ Role <@&${role.id}> can now run \`${commandName}\`.`, ephemeral: true });
    }

    if (sub === 'allow-user') {
      const user = interaction.options.getUser('user');
      db.prepare(`
        INSERT OR IGNORE INTO command_permissions (guild_id, command, role_id, user_id)
        VALUES (?, ?, NULL, ?)
      `).run(guildId, commandName, user.id);
      return interaction.reply({ content: `✅ <@${user.id}> can now run \`${commandName}\`.`, ephemeral: true });
    }
  },
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const choices = [...interaction.client.Commands.keys()];
    const filtered = choices.filter(cmd => cmd.toLowerCase().includes(focused.toLowerCase())).slice(0, 25);
    await interaction.respond(filtered.map(c => ({ name: c, value: c })));
  }
};
