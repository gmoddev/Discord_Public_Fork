const {
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType
} = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');
const { IsOwner } = require('../helpers/RankChecker');

const Db = new Database(path.join(__dirname, '..', 'data', 'templates.db'));

// ─────────────────────────────────────────────
// DB Schema
// ─────────────────────────────────────────────
Db.exec(`
CREATE TABLE IF NOT EXISTS templates (
  template_id TEXT PRIMARY KEY,
  name TEXT UNIQUE,
  created_by TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS template_roles (
  template_id TEXT,
  role_data TEXT
);

CREATE TABLE IF NOT EXISTS template_channels (
  template_id TEXT,
  channel_data TEXT
);

CREATE TABLE IF NOT EXISTS template_messages (
  template_id TEXT,
  channel_index INTEGER,
  content TEXT
);
`);

module.exports = {
  name: 'TemplateManager',

  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('template')
        .setDescription('Manage global server templates')
        .addSubcommand(s =>
          s.setName('save')
            .setDescription('Save a server template (owner only)')
            .addStringOption(o =>
              o.setName('name').setDescription('Template name').setRequired(true)
            )
        )
        .addSubcommand(s =>
          s.setName('load')
            .setDescription('Load a template into this server')
            .addStringOption(o =>
              o.setName('name').setDescription('Template name').setRequired(true)
            )
        )
        .addSubcommand(s =>
          s.setName('list')
            .setDescription('List available templates')
        )
        .addSubcommand(s =>
          s.setName('delete')
            .setDescription('Delete a template (owner only)')
            .addStringOption(o =>
              o.setName('name').setDescription('Template name').setRequired(true)
            )
        ),

      async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const name = interaction.options.getString('name');

        // ───────── SAVE ─────────
        if (sub === 'save') {
          if (!IsOwner(interaction.user.id))
            return interaction.reply({ content: '❌ Owner only.', ephemeral: true });

          const me = interaction.guild.members.me;
          if (!me.permissions.has([
            PermissionsBitField.Flags.ManageRoles,
            PermissionsBitField.Flags.ManageChannels
          ])) {
            return interaction.reply({ content: '❌ Missing ManageRoles / ManageChannels.', ephemeral: true });
          }

          const templateId = `${name.toLowerCase()}_${Date.now()}`;

          try {
            Db.prepare(`
              INSERT INTO templates VALUES (?, ?, ?, ?)
            `).run(templateId, name, interaction.user.id, Date.now());
          } catch {
            return interaction.reply({ content: '❌ Template name already exists.', ephemeral: true });
          }

          // Save roles (below bot)
          const botTop = me.roles.highest.position;
          const roles = interaction.guild.roles.cache
            .filter(r => !r.managed && r.name !== '@everyone' && r.position < botTop)
            .sort((a, b) => b.position - a.position);

          for (const role of roles.values()) {
            Db.prepare(`INSERT INTO template_roles VALUES (?, ?)`)
              .run(templateId, JSON.stringify({
                name: role.name,
                color: role.color,
                permissions: role.permissions.bitfield.toString(),
                hoist: role.hoist,
                mentionable: role.mentionable,
                position: role.position
              }));
          }

          // Save channels
          const channels = [...interaction.guild.channels.cache.values()];
          channels.forEach((ch, index) => {
            Db.prepare(`INSERT INTO template_channels VALUES (?, ?)`)
              .run(templateId, JSON.stringify({
                index,
                name: ch.name,
                type: ch.type,
                parentIndex: ch.parent
                  ? channels.findIndex(c => c.id === ch.parent.id)
                  : null
              }));

            if (ch.isTextBased() &&
                ch.permissionsFor(me)?.has(PermissionsBitField.Flags.ReadMessageHistory)) {
              ch.messages.fetch({ limit: 10 }).then(msgs => {
                for (const msg of msgs.values()) {
                  if (!msg.author.bot && msg.content) {
                    Db.prepare(`INSERT INTO template_messages VALUES (?, ?, ?)`)
                      .run(templateId, index, msg.content);
                  }
                }
              }).catch(() => {});
            }
          });

          return interaction.reply({ content: `✅ Template **${name}** saved.`, ephemeral: true });
        }

        // ───────── LOAD ─────────
        if (sub === 'load') {
          await interaction.deferReply({ ephemeral: true });

          const template = Db.prepare(
            `SELECT template_id FROM templates WHERE name = ?`
          ).get(name);

          if (!template)
            return interaction.editReply('❌ Template not found.');

          const me = interaction.guild.members.me;
          if (!me.permissions.has([
            PermissionsBitField.Flags.ManageRoles,
            PermissionsBitField.Flags.ManageChannels
          ])) {
            return interaction.editReply('❌ Missing permissions.');
          }

          // Roles
          const roleRows = Db.prepare(
            `SELECT role_data FROM template_roles WHERE template_id = ?`
          ).all(template.template_id);

          const createdRoles = [];
          for (const row of roleRows) {
            try {
              const d = JSON.parse(row.role_data);
              const r = await interaction.guild.roles.create({
                name: d.name,
                color: d.color,
                permissions: BigInt(d.permissions),
                hoist: d.hoist,
                mentionable: d.mentionable
              });
              createdRoles.push({ role: r, position: d.position });
            } catch {}
          }

          // Restore role order
          createdRoles
            .sort((a, b) => a.position - b.position)
            .forEach((r, i) => r.role.setPosition(i + 1).catch(() => {}));

          // Channels
          const channelRows = Db.prepare(
            `SELECT channel_data FROM template_channels WHERE template_id = ?`
          ).all(template.template_id);

          const createdChannels = [];

          for (const row of channelRows) {
            const c = JSON.parse(row.channel_data);
            try {
              const ch = await interaction.guild.channels.create({
                name: c.name,
                type: c.type,
                parent: c.parentIndex !== null
                  ? createdChannels[c.parentIndex]?.id
                  : null
              });
              createdChannels[c.index] = ch;
            } catch {}
          }

          // Messages
          const messages = Db.prepare(
            `SELECT channel_index, content FROM template_messages WHERE template_id = ?`
          ).all(template.template_id);

          for (const msg of messages) {
            const ch = createdChannels[msg.channel_index];
            if (ch?.isTextBased()) {
              ch.send({ content: msg.content }).catch(() => {});
            }
          }

          return interaction.editReply(`🚀 Template **${name}** loaded.`);
        }

        // ───────── LIST ─────────
        if (sub === 'list') {
          const rows = Db.prepare(`SELECT name FROM templates`).all();
          return interaction.reply({
            content: rows.length
              ? `📦 Templates:\n${rows.map(r => `• ${r.name}`).join('\n')}`
              : '📭 No templates saved.',
            ephemeral: true
          });
        }

        // ───────── DELETE ─────────
        if (sub === 'delete') {
          if (!IsOwner(interaction.user.id))
            return interaction.reply({ content: '❌ Owner only.', ephemeral: true });

          const t = Db.prepare(
            `SELECT template_id FROM templates WHERE name = ?`
          ).get(name);

          if (!t)
            return interaction.reply({ content: '❌ Template not found.', ephemeral: true });

          Db.prepare(`DELETE FROM templates WHERE template_id = ?`).run(t.template_id);
          Db.prepare(`DELETE FROM template_roles WHERE template_id = ?`).run(t.template_id);
          Db.prepare(`DELETE FROM template_channels WHERE template_id = ?`).run(t.template_id);
          Db.prepare(`DELETE FROM template_messages WHERE template_id = ?`).run(t.template_id);

          return interaction.reply({ content: `🗑️ Template **${name}** deleted.`, ephemeral: true });
        }
      }
    }
  ]
};
