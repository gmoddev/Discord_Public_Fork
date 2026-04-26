const { Events, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const Database = require('better-sqlite3');
const Path = require('path');
const { registerCommand } = require('../helpers/RankChecker');

registerCommand('PersistentRole');

const Db = new Database(Path.join(__dirname, '..', 'data', 'persistentroles.db'));

Db.prepare(`
CREATE TABLE IF NOT EXISTS persistent_roles (
    guild_id TEXT,
    role_id TEXT,
    PRIMARY KEY (guild_id, role_id)
)
`).run();

Db.prepare(`
CREATE TABLE IF NOT EXISTS persistent_members (
    guild_id TEXT,
    user_id TEXT,
    role_id TEXT,
    PRIMARY KEY (guild_id, user_id, role_id)
)
`).run();

const AddPersistentRole = Db.prepare(`INSERT OR IGNORE INTO persistent_roles (guild_id, role_id) VALUES (?, ?)`);
const RemovePersistentRole = Db.prepare(`DELETE FROM persistent_roles WHERE guild_id = ? AND role_id = ?`);
const GetPersistentRoles = (guildId) => 
    Db.prepare(`SELECT role_id FROM persistent_roles WHERE guild_id = ?`).all(guildId);

const AddMemberRole = Db.prepare(`INSERT OR IGNORE INTO persistent_members (guild_id, user_id, role_id) VALUES (?, ?, ?)`);
const RemoveMemberRole = Db.prepare(`DELETE FROM persistent_members WHERE guild_id = ? AND user_id = ? AND role_id = ?`);
const GetMemberRoles = (guildId, userId) => 
    Db.prepare(`SELECT role_id FROM persistent_members WHERE guild_id = ? AND user_id = ?`).all(guildId, userId);
const RemoveAllMemberRolesForRole = Db.prepare(`DELETE FROM persistent_members WHERE guild_id = ? AND role_id = ?`);

module.exports = {
    name: 'PersistentRole',

    events: {
        guildMemberRemove: (client, member) => {
            const persistentRoles = GetPersistentRoles(member.guild.id).map(r => r.role_id);
            member.roles.cache.forEach(role => {
                if (persistentRoles.includes(role.id)) {
                    AddMemberRole.run(member.guild.id, member.id, role.id);
                }
            });
        },

        guildMemberAdd: async (client, member) => {
            const rows = GetMemberRoles(member.guild.id, member.id);
            if (rows.length === 0) return;

            const roleIds = rows.map(r => r.role_id).filter(rid => member.guild.roles.cache.has(rid));
            if (roleIds.length > 0) {
                try {
                    await member.roles.add(roleIds, 'Restoring persistent roles');
                } catch (err) {
                    console.error(`[PersistentRole] Failed to restore roles for ${member.user.tag}:`, err);
                }
            }
        },

        guildMemberUpdate: (client, oldMember, newMember) => {
            const persistentRoles = GetPersistentRoles(newMember.guild.id).map(r => r.role_id); // line 64 is here
            newMember.roles.cache.forEach(role => {
                if (!oldMember.roles.cache.has(role.id) && persistentRoles.includes(role.id)) {
                    AddMemberRole.run(newMember.guild.id, newMember.id, role.id);
                }
            });

            oldMember.roles.cache.forEach(role => {
                if (!newMember.roles.cache.has(role.id) && persistentRoles.includes(role.id)) {
                    RemoveMemberRole.run(newMember.guild.id, newMember.id, role.id);
                }
            });
        }
    },

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName('persistentrole')
                .setDescription('Manage guild persistent roles')
                .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
                .addSubcommand(sc =>
                    sc.setName('mark')
                        .setDescription('Mark a role as persistent')
                        .addRoleOption(o => o.setName('role').setDescription('Role to mark').setRequired(true))
                )
                .addSubcommand(sc =>
                    sc.setName('unmark')
                        .setDescription('Unmark a persistent role')
                        .addRoleOption(o => o.setName('role').setDescription('Role to unmark').setRequired(true))
                )
                .addSubcommand(sc =>
                    sc.setName('list')
                        .setDescription('List persistent roles in this server')
                ),

            async execute(interaction) {
                const sub = interaction.options.getSubcommand();

                if (sub === 'mark') {
                    const role = interaction.options.getRole('role');
                    AddPersistentRole.run(interaction.guild.id, role.id);
                    await interaction.reply({ content: `✅ Role ${role.name} is now marked as persistent.`, ephemeral: true });
                    return;
                }

                if (sub === 'unmark') {
                    const role = interaction.options.getRole('role');
                    RemovePersistentRole.run(interaction.guild.id, role.id);
                    RemoveAllMemberRolesForRole.run(interaction.guild.id, role.id);
                    await interaction.reply({ content: `🚫 Role ${role.name} is no longer persistent.`, ephemeral: true });
                    return;
                }

                if (sub === 'list') {
                    const rows = GetPersistentRoles(interaction.guild.id);
                    if (rows.length === 0) {
                        return interaction.reply({ content: 'ℹ️ No persistent roles are set for this server.', ephemeral: true });
                    }
                    const roleList = rows.map(r => `<@&${r.role_id}>`).join('\n');
                    await interaction.reply({ content: `📌 Persistent Roles:\n${roleList}`, ephemeral: true });
                }
            }
        }
    ]
};
