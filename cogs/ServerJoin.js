// cogs/ServerJoin.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags, PermissionsBitField } = require('discord.js');
const Database = require('better-sqlite3');
const Path = require('path');

// ─────────────────────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────────────────────

const Db = new Database(Path.join(__dirname, '..', 'data', 'serverjoin.db'));

Db.prepare(`
CREATE TABLE IF NOT EXISTS server_join (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  description TEXT NOT NULL
)
`).run();

// ─────────────────────────────────────────────────────────────
// DB statements
// ─────────────────────────────────────────────────────────────

const GetConfig = Db.prepare(`
  SELECT channel_id, description
  FROM server_join
  WHERE guild_id = ?
`);

const UpsertConfig = Db.prepare(`
  INSERT INTO server_join (guild_id, channel_id, description)
  VALUES (?, ?, ?)
  ON CONFLICT(guild_id)
  DO UPDATE SET
    channel_id = excluded.channel_id,
    description = excluded.description
`);

const DeleteConfig = Db.prepare(`
  DELETE FROM server_join
  WHERE guild_id = ?
`);

// ─────────────────────────────────────────────────────────────
// Event handler
// ─────────────────────────────────────────────────────────────

async function HandleGuildMemberAdd(Client, Member) {
  const Config = GetConfig.get(Member.guild.id);
  if (!Config) return;

  const Channel = Member.guild.channels.cache.get(Config.channel_id);
  if (!Channel) return;

  const Message = Config.description
    .replace(/{User}/gi, `<@${Member.id}>`)
    .replace(/{Username}/gi, Member.user.username)
    .replace(/{Server}/gi, Member.guild.name);

  await Channel.send({ content: Message }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────
// Slash command
// ─────────────────────────────────────────────────────────────

const Command = {
  data: new SlashCommandBuilder()
    .setName('serverjoin')
    .setDescription('Configure server join welcome message')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)

    .addSubcommand(sc =>
      sc.setName('set')
        .setDescription('Set the welcome channel and message')
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Welcome channel')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('description')
            .setDescription('Welcome message (use {User})')
            .setRequired(true)
        )
    )

    .addSubcommand(sc =>
      sc.setName('remove')
        .setDescription('Disable join messages')
    )

    .addSubcommand(sc =>
      sc.setName('view')
        .setDescription('View current join configuration')
    ),

  async execute(Interaction) {
    const Sub = Interaction.options.getSubcommand();
    const GuildId = Interaction.guild.id;

    if (Sub === 'set') {
      const Channel = Interaction.options.getChannel('channel');
      const Description = Interaction.options.getString('description');

      UpsertConfig.run(GuildId, Channel.id, Description);

      return Interaction.reply({
        content: `✅ Join message set for ${Channel}\n\n**Preview:**\n${Description.replace(/{User}/gi, Interaction.user)}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (Sub === 'view') {
      const Config = GetConfig.get(GuildId);

      if (!Config) {
        return Interaction.reply({
          content: '📭 No join message configured.',
          flags: MessageFlags.Ephemeral,
        });
      }

      return Interaction.reply({
        content:
          `**Channel:** <#${Config.channel_id}>\n` +
          `**Message:**\n${Config.description}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (Sub === 'remove') {
      DeleteConfig.run(GuildId);

      return Interaction.reply({
        content: '🗑️ Join message disabled.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Cog export
// ─────────────────────────────────────────────────────────────

module.exports = {
  name: 'ServerJoin',
  event: 'guildMemberAdd',
  onEvent: HandleGuildMemberAdd,
  commands: [Command],
};
