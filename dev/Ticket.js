const { SlashCommandBuilder, ChannelType, ButtonBuilder, ActionRowBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database(path.join(__dirname, '..', 'data', 'tickets.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS ticket_types (
    guild_id TEXT,
    type_name TEXT,
    embed_title TEXT,
    embed_desc TEXT,
    PRIMARY KEY (guild_id, type_name)
  );

  CREATE TABLE IF NOT EXISTS ticket_roles (
    guild_id TEXT,
    type_name TEXT,
    role_id TEXT,
    PRIMARY KEY (guild_id, type_name, role_id)
  );

  CREATE TABLE IF NOT EXISTS tickets (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT,
    user_id TEXT,
    type_name TEXT
  );
`);

function getTicketType(guildId, type) {
  return db.prepare(`SELECT * FROM ticket_types WHERE guild_id = ? AND type_name = ?`).get(guildId, type);
}

function getAllowedRoles(guildId, type) {
  return db.prepare(`SELECT role_id FROM ticket_roles WHERE guild_id = ? AND type_name = ?`).all(guildId, type).map(r => r.role_id);
}

module.exports = {
  name: 'TicketSystem',
  event: 'interactionCreate',

  onEvent: async (client, interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('open_ticket_')) {
      const type = interaction.customId.split('open_ticket_')[1];
      const guildId = interaction.guild.id;
      const userId = interaction.user.id;
      const ticketType = getTicketType(guildId, type);

      if (!ticketType) return interaction.reply({ content: '❌ Invalid ticket type.', ephemeral: true });

      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guildId, deny: [PermissionFlagsBits.ViewChannel] },
          { id: userId, allow: [PermissionFlagsBits.ViewChannel] },
          ...getAllowedRoles(guildId, type).map(r => ({ id: r, allow: [PermissionFlagsBits.ViewChannel] }))
        ]
      });

      db.prepare(`INSERT OR REPLACE INTO tickets (channel_id, guild_id, user_id, type_name) VALUES (?, ?, ?, ?)`)
        .run(channel.id, guildId, userId, type);

      const embed = new EmbedBuilder()
        .setTitle(ticketType.embed_title || `Ticket: ${type}`)
        .setDescription(ticketType.embed_desc || `Hello <@${userId}>, staff will be with you shortly.`);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success)
      );

      await channel.send({ content: `<@${userId}>`, embeds: [embed], components: [row] });
      await interaction.reply({ content: `✅ Ticket opened: ${channel}`, ephemeral: true });

    } else if (interaction.customId === 'claim_ticket') {
      return interaction.reply({ content: `✅ Ticket claimed by ${interaction.user}`, ephemeral: false });
    }
  },

  data: [
    new SlashCommandBuilder()
      .setName('createtickettype')
      .setDescription('Create a ticket type')
      .addStringOption(opt => opt.setName('type').setDescription('Ticket type name').setRequired(true)),

    new SlashCommandBuilder()
      .setName('customizeembed')
      .setDescription('Set title and description of a ticket type')
      .addStringOption(opt => opt.setName('type').setDescription('Ticket type').setRequired(true))
      .addStringOption(opt => opt.setName('title').setDescription('Embed title').setRequired(true))
      .addStringOption(opt => opt.setName('description').setDescription('Embed description').setRequired(true)),

    new SlashCommandBuilder()
      .setName('addroletotickettype')
      .setDescription('Allow a role to access a ticket type')
      .addStringOption(opt => opt.setName('type').setDescription('Ticket type').setRequired(true))
      .addRoleOption(opt => opt.setName('role').setDescription('Role to allow').setRequired(true)),

    new SlashCommandBuilder()
      .setName('sendembed')
      .setDescription('Send ticket embed')
      .addStringOption(opt => opt.setName('type').setDescription('Ticket type').setRequired(true)),

    new SlashCommandBuilder()
      .setName('close')
      .setDescription('Close the current ticket')
  ],

  async execute(interaction) {
    const sub = interaction.commandName;
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    if (sub === 'createtickettype') {
      const type = interaction.options.getString('type');
      db.prepare(`INSERT OR IGNORE INTO ticket_types (guild_id, type_name) VALUES (?, ?)`).run(guildId, type);
      return interaction.reply({ content: `✅ Ticket type "${type}" created.`, ephemeral: true });

    } else if (sub === 'customizeembed') {
      const type = interaction.options.getString('type');
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      db.prepare(`UPDATE ticket_types SET embed_title = ?, embed_desc = ? WHERE guild_id = ? AND type_name = ?`)
        .run(title, description, guildId, type);
      return interaction.reply({ content: `✅ Embed updated for "${type}"`, ephemeral: true });

    } else if (sub === 'addroletotickettype') {
      const type = interaction.options.getString('type');
      const role = interaction.options.getRole('role');
      db.prepare(`INSERT OR IGNORE INTO ticket_roles (guild_id, type_name, role_id) VALUES (?, ?, ?)`)
        .run(guildId, type, role.id);
      return interaction.reply({ content: `✅ Role allowed for ticket "${type}"`, ephemeral: true });

    } else if (sub === 'sendembed') {
      const type = interaction.options.getString('type');
      const ticketType = getTicketType(guildId, type);
      if (!ticketType) return interaction.reply({ content: '❌ Invalid type.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle(ticketType.embed_title || type)
        .setDescription(ticketType.embed_desc || 'Open a ticket below.');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`open_ticket_${type}`).setLabel('Open Ticket').setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({ embeds: [embed], components: [row] });
    } else if (sub === 'close') {
      const ticket = db.prepare(`SELECT * FROM tickets WHERE channel_id = ?`).get(interaction.channel.id);
      if (!ticket) return interaction.reply({ content: '❌ Not a ticket channel.', ephemeral: true });

      await interaction.channel.delete();
      db.prepare(`DELETE FROM tickets WHERE channel_id = ?`).run(interaction.channel.id);
    }
  }
};
