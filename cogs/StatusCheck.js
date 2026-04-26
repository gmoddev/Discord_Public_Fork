// Not_Lowest

const { Events, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const Database = require('better-sqlite3');
const Path = require('path');
const { registerCommand } = require('../helpers/RankChecker');

// Register Commands
registerCommand('AddStatusCheckRole');
registerCommand('RemoveStatusCheckRole');
registerCommand('ViewStatusCheckRoles');

// Database
const Db = new Database(Path.join(__dirname, '..', 'data', 'status_check_roles.db'));
Db.prepare(`
    CREATE TABLE IF NOT EXISTS status_check_roles (
        guild_id TEXT,
        role_id TEXT,
        keywords TEXT,
        PRIMARY KEY (guild_id, role_id)
    );
`).run();


// Queries
const InsertStatusCheckRole = Db.prepare(`INSERT OR REPLACE INTO status_check_roles (guild_id, role_id, keywords) VALUES (?, ?, ?)`);
const DeleteStatusCheckRole = Db.prepare(`DELETE FROM status_check_roles WHERE guild_id = ? AND role_id = ?`);
const SelectStatusCheckRoles = Db.prepare(`SELECT role_id, keywords FROM status_check_roles WHERE guild_id = ?`);

module.exports = {
    name: 'StatusCheckRole',
    event: Events.PresenceUpdate,

    async onEvent(Client, OldPresence, NewPresence) {
        const Guild = NewPresence.guild;
        if (!Guild) return;

        const Member = NewPresence.member;
        if (!Member || Member.user.bot) return;

        const Rows = SelectStatusCheckRoles.all(Guild.id);
        if (Rows.length === 0) return;

        
        let StatusText = '';
        for (const Activity of NewPresence.activities) {
            if (Activity.type === 4 && Activity.state) {
                StatusText = Activity.state.toLowerCase();
                break;
            }
        }

        for (const Row of Rows) {
            const RoleId = Row.role_id;
            const Keywords = (Row.keywords || '').split('|').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
            const Role = Guild.roles.cache.get(RoleId);
            if (!Role) continue;

            const HasMatch = Keywords.some(k => StatusText.includes(k));
            const HasRole = Member.roles.cache.has(RoleId);

            if (HasMatch && !HasRole) {
                try {
                    await Member.roles.add(RoleId, `Matched custom status keywords: ${Keywords.join(', ')}`);
                    console.log(` Added ${Role.name} to ${Member.user.tag}`);
                } catch (Err) {
                    console.error(` Add Failed:`, Err);
                }
            } else if (!HasMatch && HasRole) {
                try {
                    await Member.roles.remove(RoleId, `Status no longer matches keywords`);
                    console.log(` Removed ${Role.name} from ${Member.user.tag}`);
                } catch (Err) {
                    console.error(` Remove Failed:`, Err);
                }
            }
        }
    },

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName('addstatuscheckrole')
                .setDescription('Add or update a role that is applied when a custom status matches keywords.')
                .addRoleOption(opt => opt.setName('role').setDescription('Role to assign').setRequired(true))
                .addStringOption(opt =>
                    opt.setName('keywords')
                       .setDescription('Keywords to match (separate multiple with |)')
                       .setRequired(true)
                ),
            async execute(Interaction) {
                if (!Interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                    return Interaction.reply({ content: ' Manage Roles Permission Required.', ephemeral: true });
                }
                const Role = Interaction.options.getRole('role');
                const KeywordsRaw = Interaction.options.getString('keywords');
                InsertStatusCheckRole.run(Interaction.guildId, Role.id, KeywordsRaw);
                await Interaction.reply(` Added **${Role.name}** with keywords: \`${KeywordsRaw}\``);
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName('removestatuscheckrole')
                .setDescription('Remove a status check role.')
                .addRoleOption(opt => opt.setName('role').setDescription('Role to remove').setRequired(true)),
            async execute(Interaction) {
                if (!Interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                    return Interaction.reply({ content: ' Manage Roles Permission Required.', ephemeral: true });
                }
                const Role = Interaction.options.getRole('role');
                DeleteStatusCheckRole.run(Interaction.guildId, Role.id);
                await Interaction.reply(` Removed status check for **${Role.name}**.`);
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName('viewstatuscheckroles')
                .setDescription('View all status check roles for this server.'),
            async execute(Interaction) {
                const Rows = SelectStatusCheckRoles.all(Interaction.guildId);
                if (Rows.length === 0) {
                    return Interaction.reply({ content: ' No status check roles configured.', ephemeral: true });
                }
                const Lines = Rows.map(r => `• <@&${r.role_id}> → \`${r.keywords}\``).join('\n');
                await Interaction.reply({
                    content: `**Status Check Roles:**\n${Lines}`,
                    ephemeral: true
                });
            }
        },
        {
    data: new SlashCommandBuilder()
        .setName('')
        .setDescription('Force a status check for a specific user.')
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to check').setRequired(true)
        ),
    async execute(Interaction) {
        if (!Interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return Interaction.reply({ content: ' Manage Roles Permission Required.', ephemeral: true });
        }

        const TargetUser = Interaction.options.getUser('user');
        const Guild = Interaction.guild;
        const Member = await Guild.members.fetch(TargetUser.id).catch(() => null);

        if (!Member) {
            return Interaction.reply({ content: ' User not found in this server.', ephemeral: true });
        }

        const Rows = SelectStatusCheckRoles.all(Guild.id);
        if (Rows.length === 0) {
            return Interaction.reply({ content: ' No status check roles configured.', ephemeral: true });
        }

        // get current presence
        const Presence = Member.presence;
        if (!Presence) {
            return Interaction.reply({ content: ' No presence information available for that user (offline or intent missing).', ephemeral: true });
        }

        let StatusText = '';
        for (const Activity of Presence.activities) {
            if (Activity.type === 4 && Activity.state) {
                StatusText = Activity.state.toLowerCase();
                break;
            }
        }

        let ChangedRoles = [];
        for (const Row of Rows) {
            const RoleId = Row.role_id;
            const Keywords = (Row.keywords || '').split('|').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
            const Role = Guild.roles.cache.get(RoleId);
            if (!Role) continue;

            const HasKeyword = Keywords.some(k => StatusText.includes(k));
            const HasRole = Member.roles.cache.has(RoleId);

            if (HasKeyword && !HasRole) {
                try {
                    await Member.roles.add(RoleId, ` matched: ${Keywords.join(', ')}`);
                    ChangedRoles.push(` Added ${Role.name}`);
                } catch (Err) {
                    ChangedRoles.push(` Failed to add ${Role.name}`);
                    console.error(` Add Failed:`, Err);
                }
            } else if (!HasKeyword && HasRole) {
                try {
                    await Member.roles.remove(RoleId, ` removed: ${Keywords.join(', ')}`);
                    ChangedRoles.push(` Removed ${Role.name}`);
                } catch (Err) {
                    ChangedRoles.push(` Failed to remove ${Role.name}`);
                    console.error(` Remove Failed:`, Err);
                }
            }
        }

        if (ChangedRoles.length === 0) {
            await Interaction.reply({ content: `ℹ️ No role changes were necessary for ${TargetUser.tag}.`, ephemeral: true });
        } else {
            await Interaction.reply({ content: `🔄 Force status check results for **${TargetUser.tag}**:\n${ChangedRoles.join('\n')}`, ephemeral: false });
        }
    }
}

    ]
};
