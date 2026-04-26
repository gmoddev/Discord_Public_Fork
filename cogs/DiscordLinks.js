const { Events, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const Database = require('better-sqlite3');
const Path = require('path');
const { registerCommand, IsOwner } = require('../helpers/RankChecker');

// Register Commands
registerCommand('WhitelistLink');
registerCommand('RemoveWhitelistLink');
registerCommand('ViewWhitelistLinks');

const Db = new Database(Path.join(__dirname, '..', 'data', 'link_blocker.db'));
Db.prepare(`
CREATE TABLE IF NOT EXISTS link_whitelist (
    guild_id TEXT,
    link TEXT,
    PRIMARY KEY (guild_id, link)
);
`).run();
Db.prepare(`
CREATE TABLE IF NOT EXISTS user_whitelist (
    guild_id TEXT,
    target_id TEXT, -- user id OR role id
    type TEXT, -- 'user' or 'role'
    PRIMARY KEY (guild_id, target_id)
);
`).run();

Db.prepare(`
CREATE TABLE IF NOT EXISTS link_infractions (
    guild_id TEXT,
    user_id TEXT,
    count INTEGER,
    PRIMARY KEY (guild_id, user_id)
);
`).run();

Db.prepare(`
CREATE TABLE IF NOT EXISTS channel_whitelist (
    guild_id TEXT,
    channel_id TEXT,
    PRIMARY KEY (guild_id, channel_id)
);
`).run();

const InsertChannelWhitelist = Db.prepare(`INSERT OR REPLACE INTO channel_whitelist (guild_id, channel_id) VALUES (?, ?)`);
const DeleteChannelWhitelist = Db.prepare(`DELETE FROM channel_whitelist WHERE guild_id = ? AND channel_id = ?`);
const SelectChannelWhitelist = Db.prepare(`SELECT channel_id FROM channel_whitelist WHERE guild_id = ?`);

const InsertWhitelist = Db.prepare(`INSERT OR REPLACE INTO link_whitelist (guild_id, link) VALUES (?, ?)`);
const DeleteWhitelist = Db.prepare(`DELETE FROM link_whitelist WHERE guild_id = ? AND link = ?`);
const SelectWhitelist = Db.prepare(`SELECT link FROM link_whitelist WHERE guild_id = ?`);

const SelectInfraction = Db.prepare(`SELECT count FROM link_infractions WHERE guild_id = ? AND user_id = ?`);
const UpsertInfraction = Db.prepare(`INSERT INTO link_infractions (guild_id,user_id,count) VALUES (?,?,1)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET count = count + 1`);
const ClearInfraction = Db.prepare(`DELETE FROM link_infractions WHERE guild_id = ? AND user_id = ?`);

const InsertUserWhitelist = Db.prepare(`
INSERT OR REPLACE INTO user_whitelist (guild_id, target_id, type)
VALUES (?, ?, ?)
`);

const DeleteUserWhitelist = Db.prepare(`
DELETE FROM user_whitelist WHERE guild_id = ? AND target_id = ?
`);

const SelectUserWhitelist = Db.prepare(`
SELECT target_id, type FROM user_whitelist WHERE guild_id = ?
`);

const InvitePatterns = [
    'discord.gg/',
    'discord.com/invite/',
    'discord.com/',
    'discordapp.com',
    "discord .gg",
    "discordapp .com/invite"
];

const AllowedDiscordPaths = [
    '/attachments',
    '/channels',
    '/users',
    '/app',
    '/events',
    '/roles',
    '/threads'
];

module.exports = {
    name: 'InviteBlocker',
    event: Events.MessageCreate,

    async onEvent(Client, Message) {
        if (Message.author.bot) return;
        const Guild = Message.guild;
        if (!Guild) return;

        const UserWhitelist = SelectUserWhitelist.all(Guild.id);

        // Check user
        if (UserWhitelist.some(w => w.type === 'user' && w.target_id === Message.author.id)) {
            return;
        }
        if (Message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return;
        }

        // Check roles
        if (Message.member) {
            const MemberRoles = Message.member.roles.cache;
            const HasWhitelistedRole = UserWhitelist.some(w =>
                w.type === 'role' && MemberRoles.has(w.target_id)
            );

            if (HasWhitelistedRole) return;
        }

        const WhitelistedChannels = SelectChannelWhitelist.all(Guild.id).map(r => r.channel_id);
        if (WhitelistedChannels.includes(Message.channel.id)) return;

        const Content = Message.content.toLowerCase();
        const WhitelistRows = SelectWhitelist.all(Guild.id).map(r => r.link.toLowerCase());
        const IsWhitelisted = WhitelistRows.some(w => Content.includes(w));
        if (IsWhitelisted) return;

        if (
            Content.includes('discord.com') &&
            AllowedDiscordPaths.some(path => Content.includes(path))
        ) return;
        // incase above fails
        if (Content.includes('/attachment')) return;
        if (Content.includes('/channels')) return;
        const HasInvite = InvitePatterns.some(p => Content.includes(p));
        if (!HasInvite) return;

        let BanImmediate = false;
        const Match = Content.match(/discord(?:\.gg|\.com\/invite)\/([a-zA-Z0-9\-]+)/);
        if (Match && Match[1]) {
            try {
                const Invite = await Client.fetchInvite(Match[1]);
                const NameLower = Invite.guild?.name?.toLowerCase() || '';
                if (NameLower.includes('nsfw') || NameLower.includes('18+') || NameLower.includes('18 +') || NameLower.includes('🔞')) {
                    BanImmediate = true;
                }
            } catch (Err) {
                // ignore errors
            }
        }

        if (BanImmediate) {
            try {
                await Guild.members.ban(Message.author.id, { reason: 'Banned for posting NSFW/18+ server invites.' });
                console.log(`[InviteBlocker] Banned ${Message.author.tag} for NSFW invite`);
            } catch (Err) {
                console.error(`[InviteBlocker] Ban Failed:`, Err);
            }
            return;
        }

        UpsertInfraction.run(Guild.id, Message.author.id);
        const Row = SelectInfraction.get(Guild.id, Message.author.id);
        const Count = Row ? Row.count : 1;

        if (Count >= 3) {
            try {
                await Guild.members.ban(Message.author.id, { reason: 'Posting Discord Invites Repeatedly' });
                ClearInfraction.run(Guild.id, Message.author.id);
                console.log(`[InviteBlocker] Banned ${Message.author.tag} after repeated invites`);
            } catch (Err) {
                console.error(`[InviteBlocker] Ban Failed:`, Err);
            }
        } else {
            try {
                await Message.delete().catch(() => { });
                console.log(`[InviteBlocker] Deleted invite from ${Message.author.tag}. Count: ${Count}`);
            } catch (Err) {
                console.error(`[InviteBlocker] Delete Failed:`, Err);
            }
        }
    },

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName('whitelistlink')
                .setDescription('Whitelist a link from invite blocking.')
                .addStringOption(opt => opt.setName('link').setDescription('The link to whitelist').setRequired(true)),
            async execute(Interaction) {
                if (!Interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    return Interaction.reply({ content: '❌ Manage Server Permission Required.', ephemeral: true });
                }
                const Link = Interaction.options.getString('link');
                InsertWhitelist.run(Interaction.guildId, Link);
                await Interaction.reply(`✅ Whitelisted link: \`${Link}\``);
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName('removewhitelistlink')
                .setDescription('Remove a whitelisted link.')
                .addStringOption(opt => opt.setName('link').setDescription('The link to remove').setRequired(true)),
            async execute(Interaction) {
                if (!Interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    return Interaction.reply({ content: '❌ Manage Server Permission Required.', ephemeral: true });
                }
                const Link = Interaction.options.getString('link');
                DeleteWhitelist.run(Interaction.guildId, Link);
                await Interaction.reply(`✅ Removed whitelisted link: \`${Link}\``);
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName('viewwhitelistlinks')
                .setDescription('View all whitelisted links.'),
            async execute(Interaction) {
                const Rows = SelectWhitelist.all(Interaction.guildId);
                if (Rows.length === 0) {
                    return Interaction.reply({ content: 'ℹ️ No whitelisted links.', ephemeral: true });
                }
                const List = Rows.map(r => `• ${r.link}`).join('\n');
                await Interaction.reply({ content: `**Whitelisted Links:**\n${List}`, ephemeral: true });
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName('whitelistchannel')
                .setDescription('Whitelist a channel where links are allowed.')
                .addChannelOption(opt => opt.setName('channel').setDescription('Channel to whitelist').setRequired(true)),
            async execute(Interaction) {
                if (!Interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    return Interaction.reply({ content: '❌ Manage Server Permission Required.', ephemeral: true });
                }
                const Channel = Interaction.options.getChannel('channel');
                if (!Channel || !Channel.isTextBased()) {
                    return Interaction.reply({ content: '❌ Invalid Channel Type.', ephemeral: true });
                }
                InsertChannelWhitelist.run(Interaction.guildId, Channel.id);
                await Interaction.reply(`✅ Whitelisted Channel: <#${Channel.id}>`);
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName('removewhitelistchannel')
                .setDescription('Remove a whitelisted channel.')
                .addChannelOption(opt => opt.setName('channel').setDescription('Channel to remove').setRequired(true)),
            async execute(Interaction) {
                if (!Interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    return Interaction.reply({ content: '❌ Manage Server Permission Required.', ephemeral: true });
                }
                const Channel = Interaction.options.getChannel('channel');
                DeleteChannelWhitelist.run(Interaction.guildId, Channel.id);
                await Interaction.reply(`✅ Removed Whitelisted Channel: <#${Channel.id}>`);
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName('viewwhitelistchannels')
                .setDescription('View all whitelisted channels.'),
            async execute(Interaction) {
                const Rows = SelectChannelWhitelist.all(Interaction.guildId);
                if (Rows.length === 0) {
                    return Interaction.reply({ content: 'ℹ️ No Whitelisted Channels.', ephemeral: true });
                }
                const List = Rows.map(r => `<#${r.channel_id}>`).join('\n');
                await Interaction.reply({ content: `**Whitelisted Channels:**\n${List}`, ephemeral: true });
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName('whitelistlinkuser')
                .setDescription('Whitelist a user or role to bypass invite blocking')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to whitelist')
                        .setRequired(false)
                )
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('Role to whitelist')
                        .setRequired(false)
                ),

            async execute(Interaction) {
                if (!IsOwner(Interaction)) {
                    return Interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                }

                const User = Interaction.options.getUser('user');
                const Role = Interaction.options.getRole('role');

                if (!User && !Role) {
                    return Interaction.reply({
                        content: '❌ Provide a user or role.',
                        ephemeral: true
                    });
                }

                if (User) {
                    InsertUserWhitelist.run(Interaction.guildId, User.id, 'user');
                    return Interaction.reply(`✅ Whitelisted user: <@${User.id}>`);
                }

                if (Role) {
                    InsertUserWhitelist.run(Interaction.guildId, Role.id, 'role');
                    return Interaction.reply(`✅ Whitelisted role: <@&${Role.id}>`);
                }
            }

        },
        {
            data: new SlashCommandBuilder()
                .setName('removewhitelistlinkuser')
                .setDescription('Remove a whitelisted user or role')
                .addStringOption(opt =>
                    opt.setName('id')
                        .setDescription('User ID or Role ID')
                        .setRequired(true)
                ),

            async execute(Interaction) {
                if (!IsOwner(Interaction)) {
                    return Interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                }

                const Id = Interaction.options.getString('id');

                DeleteUserWhitelist.run(Interaction.guildId, Id);

                await Interaction.reply(`✅ Removed whitelist for: \`${Id}\``);
            }
        }

    ]
};
