const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const Database = require('better-sqlite3');
const Path = require('path');

// Database
const Db = new Database(Path.join(__dirname, '..', 'data', 'link_blocker.db'));
Db.prepare(`
CREATE TABLE IF NOT EXISTS ban_log_channel (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT
)
`).run();

const SetLogChannel = Db.prepare(`INSERT OR REPLACE INTO ban_log_channel (guild_id, channel_id) VALUES (?, ?)`); 
const GetLogChannel = Db.prepare(`SELECT channel_id FROM ban_log_channel WHERE guild_id = ?`);

function CanModerate(Invoker, TargetMember) {
    if (!TargetMember) return true;
    if (TargetMember.id === Invoker.id) return false;
    return TargetMember.roles.highest.position < Invoker.roles.highest.position;
}

function GetLogChannelForGuild(Guild) {
    const Row = GetLogChannel.get(Guild.id);
    return Row ? Guild.channels.cache.get(Row.channel_id) : null;
}

function CreateCaseEmbed(Type, CaseId, Offender, PublicReason, PrivateReason, Moderator) {
    return new EmbedBuilder()
        .setColor(Type === 'ban' ? 0xff5555 : 0x55ff55)
        .setTitle(`${Type} | case ${CaseId}`)
        .addFields([
            { name: 'Offender', value: `${Offender?.tag || 'Unknown'} (<@${Offender?.id || 'N/A'}>)`, inline: false },
            { name: 'Reason', value: PublicReason, inline: false },
            { name: 'Responsible Moderator', value: `${Moderator?.tag || 'Unknown'}`, inline: false },
            { name: 'ID', value: Date.now().toString(), inline: false },
            { name: 'Private Reason', value: PrivateReason, inline: false }
        ])
        .setTimestamp();
}

module.exports = {
    name: 'DiscordBan',
    commands: [
        {
            data: new SlashCommandBuilder()
                .setName('ban')
                .setDescription('Ban a user')
                .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers)
                .addUserOption(opt => opt.setName('user').setDescription('User to ban').setRequired(true))
                .addStringOption(opt => opt.setName('publicreason').setDescription('Public reason').setRequired(true))
                .addStringOption(opt => opt.setName('privatereason').setDescription('Private reason').setRequired(true)),
            async execute(Interaction) {
                if (!Interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                    return Interaction.reply({ content: '❌ You need Ban Members permission.', ephemeral: true });
                }

                const Target = Interaction.options.getUser('user');
                const TargetMember = Interaction.guild.members.cache.get(Target.id);
                const PublicReason = Interaction.options.getString('publicreason');
                const PrivateReason = Interaction.options.getString('privatereason');

                if (!PublicReason.trim() || !PrivateReason.trim()) {
                    return Interaction.reply({ content: '❌ Reason cannot be empty.', ephemeral: true });
                }

                if (TargetMember && !CanModerate(Interaction.member, TargetMember)) {
                    return Interaction.reply({ content: '❌ You cannot ban someone with equal or higher role.', ephemeral: true });
                }

                try {
                    await Target.send(`You have been **banned** from **${Interaction.guild.name}**.\n**Reason:** ${PublicReason}`);
                } catch {
                    console.log(`[BanCommand] Could not DM ${Target.tag}`);
                }

                try {
                    await Interaction.guild.members.ban(Target.id, { reason: `${PublicReason} | Moderator: ${Interaction.user.tag} (${Interaction.user.id})` });
                } catch (Err) {
                    console.error(Err);
                    return Interaction.reply({ content: '❌ Failed to ban user.', ephemeral: true });
                }

                const LogChannel = GetLogChannelForGuild(Interaction.guild);
                const CaseId = Math.floor(Math.random() * 1000);
                const Embed = CreateCaseEmbed('ban', CaseId, Target, PublicReason, `${PrivateReason}\nModerator: ${Interaction.user.tag} (${Interaction.user.id})`, Interaction.user);
                if (LogChannel) LogChannel.send({ embeds: [Embed] }).catch(console.error);

                await Interaction.reply({ content: `✅ Banned ${Target.tag}`, ephemeral: true });
            }
        },

        {
            data: new SlashCommandBuilder()
                .setName('unban')
                .setDescription('Unban a user')
                .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers)
                .addStringOption(opt => opt.setName('userid').setDescription('User ID to unban').setRequired(true))
                .addStringOption(opt => opt.setName('publicreason').setDescription('Public reason').setRequired(true))
                .addStringOption(opt => opt.setName('privatereason').setDescription('Private reason').setRequired(true)),
            async execute(Interaction) {
                if (!Interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                    return Interaction.reply({ content: '❌ You need Ban Members permission.', ephemeral: true });
                }

                const UserId = Interaction.options.getString('userid');
                const PublicReason = Interaction.options.getString('publicreason');
                const PrivateReason = Interaction.options.getString('privatereason');

                if (!PublicReason.trim() || !PrivateReason.trim()) {
                    return Interaction.reply({ content: '❌ Reason cannot be empty.', ephemeral: true });
                }

                try {
                    await Interaction.guild.bans.remove(UserId, `${PublicReason} | Moderator: ${Interaction.user.tag} (${Interaction.user.id})`);
                } catch (Err) {
                    console.error(Err);
                    return Interaction.reply({ content: '❌ Failed to unban user.', ephemeral: true });
                }

                const FetchedUser = await Interaction.client.users.fetch(UserId).catch(() => ({ id: UserId, tag: `Unknown#0000` }));
                const LogChannel = GetLogChannelForGuild(Interaction.guild);
                const CaseId = Math.floor(Math.random() * 1000);
                const Embed = CreateCaseEmbed('unban', CaseId, FetchedUser, PublicReason, `${PrivateReason}\nModerator: ${Interaction.user.tag} (${Interaction.user.id})`, Interaction.user);
                if (LogChannel) LogChannel.send({ embeds: [Embed] }).catch(console.error);

                await Interaction.reply({ content: `✅ Unbanned ${FetchedUser.tag}`, ephemeral: true });
            }
        },

        {
            data: new SlashCommandBuilder()
                .setName('setbanloggingchannel')
                .setDescription('Set the channel for ban/unban logs')
                .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
                .addChannelOption(opt => opt.setName('channel').setDescription('Channel to use').setRequired(true)),
            async execute(Interaction) {
                if (!Interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    return Interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
                }
                const Channel = Interaction.options.getChannel('channel');
                if (!Channel || !Channel.isTextBased()) {
                    return Interaction.reply({ content: '❌ Invalid channel type.', ephemeral: true });
                }

                SetLogChannel.run(Interaction.guildId, Channel.id);
                await Interaction.reply({ content: `✅ Set ban log channel to <#${Channel.id}>`, ephemeral: true });
            }
        }
    ]
};
