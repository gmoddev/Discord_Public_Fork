// cogs/RoleGroups.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags, PermissionsBitField } = require('discord.js');
const Database = require('better-sqlite3');
const Path = require('path');

// ─────────────────────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────────────────────

const Db = new Database(Path.join(__dirname, '..', 'data', 'rolegroups.db'));

Db.prepare(`
CREATE TABLE IF NOT EXISTS role_groups (
  guild_id TEXT NOT NULL,
  group_id INTEGER NOT NULL,
  source_role_id TEXT NOT NULL,
  target_role_id TEXT NOT NULL,
  soft INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, group_id, source_role_id, target_role_id)
)
`).run();

// ─────────────────────────────────────────────────────────────
// DB migration: add `soft` column if missing
// ─────────────────────────────────────────────────────────────

const Columns = Db.prepare(`PRAGMA table_info(role_groups)`).all();
const HasSoftColumn = Columns.some(c => c.name === 'soft');

if (!HasSoftColumn) {
  Db.prepare(`
    ALTER TABLE role_groups
    ADD COLUMN soft INTEGER NOT NULL DEFAULT 0
  `).run();
}

// ─────────────────────────────────────────────────────────────
// Hard-coded defaults (backwards compatibility)
// ─────────────────────────────────────────────────────────────

const DEFAULT_GROUPS = [
  {
    sources: [
      '1373784946606608445',
      '1356816897705775174',
      '1356816898884374531',
      '1356816900427878472',
    ],
    targets: ['1356837034135650454'],
  },
  {
    sources: [
      '1356816902781009961',
      '1356816903401639939',
    ],
    targets: ['1356836972802347064'],
  },
  {
    sources: [
      '1356837034135650454',
      '1356836972802347064',
    ],
    targets: ['1356818546532810933'],
  },
];

// ─────────────────────────────────────────────────────────────
// DB statements
// ─────────────────────────────────────────────────────────────

const GetGuildGroups = Db.prepare(`
  SELECT group_id, source_role_id, target_role_id, soft
  FROM role_groups
  WHERE guild_id = ?
`);

const InsertRule = Db.prepare(`
  INSERT OR IGNORE INTO role_groups
  (guild_id, group_id, source_role_id, target_role_id, soft)
  VALUES (?, ?, ?, ?, ?)
`);

const DeleteGroup = Db.prepare(`
  DELETE FROM role_groups
  WHERE guild_id = ? AND group_id = ?
`);

// ─────────────────────────────────────────────────────────────
// Group resolution
// ─────────────────────────────────────────────────────────────

function ResolveGroups(GuildId) {
  const Rows = GetGuildGroups.all(GuildId);

  const Groups = DEFAULT_GROUPS.map(g => ({
    sources: new Set(g.sources),
    targets: new Map(g.targets.map(t => [t, { soft: false }])),
  }));

  const MapGroups = new Map();

  for (const Row of Rows) {
    if (!MapGroups.has(Row.group_id)) {
      MapGroups.set(Row.group_id, {
        sources: new Set(),
        targets: new Map(),
      });
    }

    const Group = MapGroups.get(Row.group_id);
    Group.sources.add(Row.source_role_id);
    Group.targets.set(Row.target_role_id, { soft: !!Row.soft });
  }

  for (const Group of MapGroups.values()) {
    Groups.push(Group);
  }

  return Groups;
}

// ─────────────────────────────────────────────────────────────
// Core sync logic
// ─────────────────────────────────────────────────────────────

async function SyncMemberRoles(Member) {
  const Roles = new Set(Member.roles.cache.keys());
  const Groups = ResolveGroups(Member.guild.id);

  for (const Group of Groups) {
    const HasSource = [...Roles].some(r => Group.sources.has(r));

    for (const [TargetRoleId, Meta] of Group.targets.entries()) {
      const HasTarget = Roles.has(TargetRoleId);

      if (HasSource && !HasTarget) {
        await Member.roles.add(TargetRoleId).catch(() => {});
      }

      // Remove only if NOT soft
      if (!HasSource && HasTarget && !Meta.soft) {
        await Member.roles.remove(TargetRoleId).catch(() => {});
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Event handler
// ─────────────────────────────────────────────────────────────

async function HandleGuildMemberUpdate(Client, OldMember, NewMember) {
  await SyncMemberRoles(NewMember);
}

// ─────────────────────────────────────────────────────────────
// Slash command
// ─────────────────────────────────────────────────────────────

const Command = {
  data: new SlashCommandBuilder()
    .setName('rolegroup')
    .setDescription('Manage role groups')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)

    .addSubcommand(sc =>
      sc.setName('add')
        .setDescription('Add a role group rule')
        .addIntegerOption(o =>
          o.setName('group')
            .setDescription('Group ID')
            .setRequired(true)
        )
        .addRoleOption(o =>
          o.setName('source')
            .setDescription('Source role')
            .setRequired(true)
        )
        .addRoleOption(o =>
          o.setName('target')
            .setDescription('Target role')
            .setRequired(true)
        )
        .addBooleanOption(o =>
          o.setName('soft')
            .setDescription('Soft add (do not auto-remove)')
            .setRequired(false)
        )
    )

    .addSubcommand(sc =>
      sc.setName('remove')
        .setDescription('Remove a group')
        .addIntegerOption(o =>
          o.setName('group')
            .setDescription('Group ID')
            .setRequired(true)
        )
    )

    .addSubcommand(sc =>
      sc.setName('list')
        .setDescription('List role groups')
    ),

  async execute(Interaction) {
    const Sub = Interaction.options.getSubcommand();
    const GuildId = Interaction.guild.id;

    if (Sub === 'add') {
      const Group = Interaction.options.getInteger('group');
      const Source = Interaction.options.getRole('source').id;
      const Target = Interaction.options.getRole('target').id;
      const Soft = Interaction.options.getBoolean('soft') ? 1 : 0;

      InsertRule.run(GuildId, Group, Source, Target, Soft);

      return Interaction.reply({
        content: `✅ Added ${Soft ? 'SOFT' : 'HARD'} rule: <@&${Source}> → <@&${Target}> (group ${Group})`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (Sub === 'list') {
      const Rows = GetGuildGroups.all(GuildId);

      if (!Rows.length) {
        return Interaction.reply({
          content: '📭 No role groups configured.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const Grouped = new Map();

      for (const Row of Rows) {
        if (!Grouped.has(Row.group_id)) {
          Grouped.set(Row.group_id, []);
        }
        Grouped.get(Row.group_id).push(Row);
      }

      let Output = '';

      for (const [GroupId, Rules] of Grouped.entries()) {
        Output += `**Group ${GroupId}**\n`;
        for (const Rule of Rules) {
          Output += `• <@&${Rule.source_role_id}> → <@&${Rule.target_role_id}> ${Rule.soft ? '*(soft)*' : ''}\n`;
        }
        Output += '\n';
      }

      return Interaction.reply({
        content: Output,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (Sub === 'remove') {
      const Group = Interaction.options.getInteger('group');
      DeleteGroup.run(GuildId, Group);

      return Interaction.reply({
        content: `🗑️ Removed group ${Group}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Cog export
// ─────────────────────────────────────────────────────────────

module.exports = {
  name: 'RoleGroups',
  event: 'guildMemberUpdate',
  onEvent: HandleGuildMemberUpdate,
  commands: [Command],
};
