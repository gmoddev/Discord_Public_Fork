// cogs/AutoRole.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags, PermissionsBitField } = require('discord.js');
const Database = require('better-sqlite3');
const Path = require('path');

// ─────────────────────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────────────────────

const Db = new Database(Path.join(__dirname, '..', 'data', 'autorole.db'));

Db.prepare(`
CREATE TABLE IF NOT EXISTS autoroles (
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  required_role_id TEXT,
  required_minutes INTEGER,
  PRIMARY KEY (guild_id, role_id)
)
`).run();

// ─────────────────────────────────────────────────────────────
// DB Statements
// ─────────────────────────────────────────────────────────────

const GetRolesForGuild = Db.prepare(`
  SELECT * FROM autoroles WHERE guild_id = ?
`);

const InsertRole = Db.prepare(`
  INSERT OR REPLACE INTO autoroles
  (guild_id, role_id, required_role_id, required_minutes)
  VALUES (?, ?, ?, ?)
`);

const DeleteRole = Db.prepare(`
  DELETE FROM autoroles
  WHERE guild_id = ? AND role_id = ?
`);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function TryApplyRole(Member, Config) {
  if (Member.roles.cache.has(Config.role_id)) return;

  if (Config.required_role_id) {
    if (!Member.roles.cache.has(Config.required_role_id)) return;
  }

  Member.roles.add(Config.role_id).catch(() => {});
}

function ScheduleTimedRole(Member, Config) {
  const JoinedAt = Member.joinedTimestamp;
  if (!JoinedAt) return;

  const DelayMs = (Config.required_minutes * 60 * 1000) - (Date.now() - JoinedAt);
  if (DelayMs <= 0) {
    return TryApplyRole(Member, Config);
  }

  setTimeout(() => {
    TryApplyRole(Member, Config);
  }, DelayMs);
}

// ─────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────

async function HandleMemberJoin(Client, Member) {
  const Roles = GetRolesForGuild.all(Member.guild.id);
  if (!Roles.length) return;

  for (const Config of Roles) {
    if (Config.required_minutes != null) {
      ScheduleTimedRole(Member, Config);
    } else {
      TryApplyRole(Member, Config);
    }
  }
}

async function HandleMemberUpdate(Client, OldMember, NewMember) {
  const Roles = GetRolesForGuild.all(NewMember.guild.id);
  if (!Roles.length) return;

  for (const Config of Roles) {
    if (!Config.required_role_id) continue;

    if (
      !OldMember.roles.cache.has(Config.required_role_id) &&
      NewMember.roles.cache.has(Config.required_role_id)
    ) {
      TryApplyRole(NewMember, Config);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Slash Command
// ─────────────────────────────────────────────────────────────

const Command = {
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Configure automatic roles')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)

    .addSubcommand(sc =>
      sc.setName('add')
        .setDescription('Add an autorole')
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role to assign')
            .setRequired(true)
        )
        .addRoleOption(o =>
          o.setName('require_role')
            .setDescription('User must already have this role')
            .setRequired(false)
        )
        .addIntegerOption(o =>
          o.setName('require_minutes')
            .setDescription('Minutes after join before role is applied')
            .setRequired(false)
            .setMinValue(1)
        )
    )

    .addSubcommand(sc =>
      sc.setName('remove')
        .setDescription('Remove an autorole')
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role to remove')
            .setRequired(true)
        )
    )

    .addSubcommand(sc =>
      sc.setName('list')
        .setDescription('List all autoroles')
    ),

  async execute(Interaction) {
    const Sub = Interaction.options.getSubcommand();
    const GuildId = Interaction.guild.id;

    if (Sub === 'add') {
      const Role = Interaction.options.getRole('role');
      const RequireRole = Interaction.options.getRole('require_role');
      const RequireMinutes = Interaction.options.getInteger('require_minutes');

      if (RequireRole && RequireMinutes) {
        return Interaction.reply({
          content: '❌ You can only use **one** requirement type.',
          flags: MessageFlags.Ephemeral,
        });
      }

      InsertRole.run(
        GuildId,
        Role.id,
        RequireRole?.id ?? null,
        RequireMinutes ?? null
      );

      let Info = `✅ Autorole added: ${Role}`;
      if (RequireRole) Info += `\n🔒 Requires role: ${RequireRole}`;
      if (RequireMinutes) Info += `\n⏱ Requires ${RequireMinutes} minutes in server`;

      return Interaction.reply({
        content: Info,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (Sub === 'remove') {
      const Role = Interaction.options.getRole('role');

      DeleteRole.run(GuildId, Role.id);

      return Interaction.reply({
        content: `🗑️ Autorole removed: ${Role}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (Sub === 'list') {
      const Roles = GetRolesForGuild.all(GuildId);

      if (!Roles.length) {
        return Interaction.reply({
          content: '📭 No autoroles configured.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const Lines = Roles.map(r => {
        let Line = `<@&${r.role_id}>`;
        if (r.required_role_id) Line += ` ← requires <@&${r.required_role_id}>`;
        if (r.required_minutes) Line += ` ← after ${r.required_minutes} min`;
        return Line;
      });

      return Interaction.reply({
        content: `**Autoroles:**\n${Lines.join('\n')}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────

module.exports = {
  name: 'AutoRole',
  events: [
    { name: 'guildMemberAdd', handler: HandleMemberJoin },
    { name: 'guildMemberUpdate', handler: HandleMemberUpdate },
  ],
  commands: [Command],
};
