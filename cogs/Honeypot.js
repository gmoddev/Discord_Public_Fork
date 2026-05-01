const {
    Events,
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");

const Database = require("better-sqlite3");
const Path = require("path");
const Fs = require("fs");
const { registerCommand } = require("../helpers/RankChecker");
const { ParsePunishmentLength, FormatPunishmentLength } = require("../helpers/TimeHelper");

// ================= CONFIG =================

const Config = {
    DatabaseFolder: Path.join(__dirname, "..", "data"),
    DatabaseFile: "honeypot.db",

    DefaultChannelName: "honeypot",
    DefaultEnabled: 0,

    DefaultBanReason: "Honeypot Triggered",
    DefaultBanLength: "0",
    DefaultDeleteMessageSeconds: 604800,

    DefaultEmbedTitle: "Honeypot Channel",
    DefaultEmbedDescription: "If you talk in here, you will be **banned automatically**.\nAppeals will **not** be given.",
    DefaultEmbedColor: 0xff0000,
    DefaultEmbedFooter: "This is an automated moderation channel",

    StartupEnsureChannels: true,
    ExpirationCheckIntervalMs: 30 * 1000,
    LogFailedActions: true
};

// ================= COMMAND REGISTER =================

registerCommand("Honeypot");

// ================= DATABASE =================

if (!Fs.existsSync(Config.DatabaseFolder)) {
    Fs.mkdirSync(Config.DatabaseFolder, { recursive: true });
}

const Db = new Database(Path.join(Config.DatabaseFolder, Config.DatabaseFile));

Db.prepare(`
CREATE TABLE IF NOT EXISTS honeypot (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    channel_name TEXT NOT NULL DEFAULT 'honeypot',
    ban_reason TEXT NOT NULL DEFAULT 'Honeypot Triggered',
    ban_length TEXT NOT NULL DEFAULT '0',
    delete_message_seconds INTEGER NOT NULL DEFAULT 604800,
    embed_title TEXT NOT NULL DEFAULT 'Honeypot Channel',
    embed_description TEXT NOT NULL DEFAULT 'If you talk in here, you will be **banned automatically**.\\nAppeals will **not** be given.',
    embed_color INTEGER NOT NULL DEFAULT 16711680,
    embed_footer TEXT NOT NULL DEFAULT 'This is an automated moderation channel',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
`).run();

Db.prepare(`
CREATE TABLE IF NOT EXISTS honeypot_temp_bans (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
`).run();

function EnsureColumn(TableName, ColumnName, Definition) {
    const Columns = Db.prepare(`PRAGMA table_info(${TableName})`).all();
    if (Columns.some(Column => Column.name === ColumnName)) return;

    Db.prepare(`ALTER TABLE ${TableName} ADD COLUMN ${ColumnName} ${Definition}`).run();
}

EnsureColumn("honeypot", "ban_length", "TEXT NOT NULL DEFAULT '0'");

const GetHoneypot = Db.prepare(`SELECT * FROM honeypot WHERE guild_id = ?`);
const DeleteHoneypot = Db.prepare(`DELETE FROM honeypot WHERE guild_id = ?`);
const InsertGuildConfig = Db.prepare(`
INSERT INTO honeypot (
    guild_id,
    channel_id,
    enabled,
    channel_name,
    ban_reason,
    ban_length,
    delete_message_seconds,
    embed_title,
    embed_description,
    embed_color,
    embed_footer,
    created_at,
    updated_at
) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const InsertTempBan = Db.prepare(`
INSERT INTO honeypot_temp_bans (guild_id, user_id, expires_at, reason, created_at)
VALUES (@guild_id, @user_id, @expires_at, @reason, @created_at)
ON CONFLICT(guild_id, user_id)
DO UPDATE SET
    expires_at = excluded.expires_at,
    reason = excluded.reason,
    created_at = excluded.created_at
`);
const RemoveTempBan = Db.prepare(`DELETE FROM honeypot_temp_bans WHERE guild_id = ? AND user_id = ?`);
const GetExpiredTempBans = Db.prepare(`SELECT * FROM honeypot_temp_bans WHERE expires_at <= ?`);

function LogFailure(Context, Error) {
    if (!Config.LogFailedActions) return;
    console.error(`[Honeypot] ${Context} failed:`, Error);
}

function EnsureGuildConfig(Guild) {
    let Record = GetHoneypot.get(Guild.id);
    if (Record) return Record;

    const Now = Date.now();
    InsertGuildConfig.run(
        Guild.id,
        Config.DefaultEnabled,
        Config.DefaultChannelName,
        Config.DefaultBanReason,
        Config.DefaultBanLength,
        Config.DefaultDeleteMessageSeconds,
        Config.DefaultEmbedTitle,
        Config.DefaultEmbedDescription,
        Config.DefaultEmbedColor,
        Config.DefaultEmbedFooter,
        Now,
        Now
    );

    return GetHoneypot.get(Guild.id);
}

function UpdateGuildConfig(GuildId, Updates) {
    const AllowedColumns = new Set([
        "channel_id",
        "enabled",
        "channel_name",
        "ban_reason",
        "ban_length",
        "delete_message_seconds",
        "embed_title",
        "embed_description",
        "embed_color",
        "embed_footer"
    ]);

    const Entries = Object.entries(Updates)
        .filter(([Key, Value]) => AllowedColumns.has(Key) && Value !== undefined);

    if (Entries.length === 0) {
        return GetHoneypot.get(GuildId);
    }

    const Sets = Entries.map(([Key]) => `${Key} = ?`);
    const Values = Entries.map(([, Value]) => Value);
    Values.push(Date.now(), GuildId);

    Db.prepare(`
        UPDATE honeypot
        SET ${Sets.join(", ")}, updated_at = ?
        WHERE guild_id = ?
    `).run(...Values);

    return GetHoneypot.get(GuildId);
}

async function EnsureHoneypotChannel(Guild) {
    let Record = GetHoneypot.get(Guild.id);
    let Channel = Record?.channel_id ? Guild.channels.cache.get(Record.channel_id) : null;

    if (!Channel) {
        Channel = Guild.channels.cache.find(c => c.name === 'honeypot' && c.type === ChannelType.GuildText);
    }

    if (!Channel) {
        Channel = await Guild.channels.create({
            name: 'honeypot',
            type: ChannelType.GuildText,
            position: 0,
            permissionOverwrites: [
                {
                    id: Guild.roles.everyone.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                }
            ]
        });
    }

    await Channel.setPosition(0).catch(() => {});

    const Messages = await Channel.messages.fetch({ limit: 10 }).catch(() => new Map());
    const AlreadyPosted = [...Messages.values()].some(
        m => m.author.id === Guild.client.user.id && m.embeds.length > 0 && m.embeds[0].title === '⚠️ Honeypot Channel ⚠️'
    );

    if (!AlreadyPosted) {
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Honeypot Channel ⚠️')
            .setDescription('If you talk in here, you will be **banned automatically**.\nAppeals will **not** be given.')
            .setColor(0xFF0000)
            .setFooter({ text: 'This is an automated moderation channel' })
            .setTimestamp();

        await Channel.send({ embeds: [embed] });
    }

    UpsertHoneypot.run(Guild.id, Channel.id, 1);
    return Channel;
}

async function EnsureHoneypotChannel(Guild, Options = {}) {
    const ShouldPostEmbed = Options.postEmbed ?? true;
    const Record = EnsureGuildConfig(Guild);

    let Channel = Record.channel_id
        ? Guild.channels.cache.get(Record.channel_id)
        : null;

    if (!Channel) {
        Channel = Guild.channels.cache.find(c =>
            c.name === Record.channel_name &&
            c.type === ChannelType.GuildText
        );
    }

    if (!Channel) {
        Channel = await Guild.channels.create({
            name: Record.channel_name,
            type: ChannelType.GuildText,
            position: 0,
            permissionOverwrites: [
                {
                    id: Guild.roles.everyone.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                }
            ]
        });
    }

    await Channel.setPosition(0).catch(() => { });

    if (ShouldPostEmbed) {
        const Messages = await Channel.messages.fetch({ limit: 10 }).catch(() => new Map());

        const AlreadyPosted = [...Messages.values()].some(Message =>
            Message.author.id === Guild.client.user.id &&
            Message.embeds.length > 0 &&
            Message.embeds[0].title === Record.embed_title
        );

        if (!AlreadyPosted) {
            const Embed = new EmbedBuilder()
                .setTitle(Record.embed_title)
                .setDescription(Record.embed_description)
                .setColor(Record.embed_color)
                .setFooter({ text: Record.embed_footer })
                .setTimestamp();

            await Channel.send({ embeds: [Embed] });
        }
    }

    UpdateGuildConfig(Guild.id, {
        channel_id: Channel.id
    });

    return Channel;
}

async function CheckExpiredHoneypotBans(Client) {
    const ExpiredBans = GetExpiredTempBans.all(Date.now());

    for (const Ban of ExpiredBans) {
        const Guild = Client.guilds.cache.get(Ban.guild_id);

        if (!Guild) {
            RemoveTempBan.run(Ban.guild_id, Ban.user_id);
            continue;
        }

        try {
            await Guild.members.unban(Ban.user_id, "Honeypot temporary ban expired");
        } catch (Error) {
            LogFailure(`Temporary ban expiration for ${Ban.user_id}`, Error);
        } finally {
            RemoveTempBan.run(Ban.guild_id, Ban.user_id);
        }
    }
}

function FormatStatus(Record) {
    const Enabled = Record.enabled === 1 ? "Enabled" : "Disabled";

    return [
        `Honeypot Status: ${Enabled}`,
        `Channel: ${Record.channel_id ? `<#${Record.channel_id}>` : "Not created"}`,
        `Channel Name: ${Record.channel_name}`,
        `Ban Reason: ${Record.ban_reason}`,
        `Ban Length: ${FormatPunishmentLength(Record.ban_length)}`,
        `Delete Message Seconds: ${Record.delete_message_seconds}`,
        `Embed Title: ${Record.embed_title}`,
        `Embed Color: #${Record.embed_color.toString(16).padStart(6, "0")}`
    ].join("\n");
}

// ================= MODULE =================

module.exports = {
    name: "Honeypot",
    event: Events.MessageCreate,

    async ready(Client) {
        console.log("[Honeypot] Loaded.");

        await Client.guilds.fetch();

        for (const Guild of Client.guilds.cache.values()) {
            try {
                EnsureGuildConfig(Guild);

                if (Config.StartupEnsureChannels) {
                    await EnsureHoneypotChannel(Guild, { postEmbed: true });
                }
            } catch (Error) {
                LogFailure(`Startup setup for guild ${Guild.id}`, Error);
            }
        }

        setInterval(() => {
            CheckExpiredHoneypotBans(Client).catch(Error => {
                LogFailure("Temporary ban expiration check", Error);
            });
        }, Config.ExpirationCheckIntervalMs);
    },

    async onEvent(Client, Message) {
        if (!Message.guild || Message.author.bot) return;

        const Guild = Message.guild;
        const Record = EnsureGuildConfig(Guild);

        if (Record.enabled !== 1) return;
        if (!Record.channel_id || Record.channel_id !== Message.channel.id) return;

        try {
            const Punishment = ParsePunishmentLength(Record.ban_length ?? Config.DefaultBanLength);

            if (!Punishment) {
                LogFailure(`Invalid ban length "${Record.ban_length}" for guild ${Guild.id}`, new Error("Invalid ban length"));
                return;
            }

            if (Punishment.action === "kick") {
                await Message.member.kick(Record.ban_reason);
                console.log(`[Honeypot] Kicked ${Message.author.tag} for typing in honeypot.`);
                return;
            }

            const CreatedAt = Date.now();
            const ExpiresAt = Punishment.durationMs === 0 ? 0 : CreatedAt + Punishment.durationMs;

            await Message.member.ban({
                reason: Record.ban_reason,
                deleteMessageSeconds: Record.delete_message_seconds
            });

            if (ExpiresAt !== 0) {
                InsertTempBan.run({
                    guild_id: Guild.id,
                    user_id: Message.author.id,
                    expires_at: ExpiresAt,
                    reason: Record.ban_reason,
                    created_at: CreatedAt
                });
            }

            console.log(`[Honeypot] Banned ${Message.author.tag} for typing in honeypot.`);
        } catch (Error) {
            LogFailure(`Ban for ${Message.author.tag}`, Error);
        }
    },

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("honeypot")
                .setDescription("Manage honeypot protection.")
                .addSubcommand(Sub =>
                    Sub.setName("enable")
                        .setDescription("Enable and setup the honeypot channel."))
                .addSubcommand(Sub =>
                    Sub.setName("disable")
                        .setDescription("Disable honeypot protection."))
                .addSubcommand(Sub =>
                    Sub.setName("ensure")
                        .setDescription("Create or verify the honeypot channel."))
                .addSubcommand(Sub =>
                    Sub.setName("view")
                        .setDescription("View honeypot status."))
                .addSubcommand(Sub =>
                    Sub.setName("config")
                        .setDescription("Configure honeypot settings.")
                        .addStringOption(Option =>
                            Option.setName("channel_name")
                                .setDescription("Name of the honeypot channel."))
                        .addChannelOption(Option =>
                            Option.setName("channel")
                                .setDescription("Use an existing text channel as the honeypot."))
                        .addStringOption(Option =>
                            Option.setName("ban_reason")
                                .setDescription("Ban reason used when someone triggers the honeypot."))
                        .addStringOption(Option =>
                            Option.setName("ban_length")
                                .setDescription("kick, 1d, 2d, 1y, or 0 for permanent."))
                        .addIntegerOption(Option =>
                            Option.setName("delete_message_seconds")
                                .setDescription("Seconds of message history to delete on ban."))
                        .addStringOption(Option =>
                            Option.setName("embed_title")
                                .setDescription("Warning embed title."))
                        .addStringOption(Option =>
                            Option.setName("embed_description")
                                .setDescription("Warning embed description. Use \\n for new lines."))
                        .addStringOption(Option =>
                            Option.setName("embed_color")
                                .setDescription("Embed color hex, example: #ff0000."))
                        .addStringOption(Option =>
                            Option.setName("embed_footer")
                                .setDescription("Warning embed footer."))),

            async execute(Interaction) {
                const Subcommand = Interaction.options.getSubcommand();
                let Record = EnsureGuildConfig(Interaction.guild);

                if (Subcommand === "enable") {
                    const Channel = await EnsureHoneypotChannel(Interaction.guild, { postEmbed: true });

                    Record = UpdateGuildConfig(Interaction.guildId, {
                        channel_id: Channel.id,
                        enabled: 1
                    });

                    return Interaction.reply({
                        content: `Honeypot is now enabled.\nChannel: <#${Record.channel_id}>`,
                        ephemeral: true
                    });
                }

                if (Subcommand === "disable") {
                    Record = UpdateGuildConfig(Interaction.guildId, {
                        enabled: 0
                    });

                    return Interaction.reply({
                        content: "Honeypot is now disabled.",
                        ephemeral: true
                    });
                }

                if (Subcommand === "ensure") {
                    const Channel = await EnsureHoneypotChannel(Interaction.guild, { postEmbed: true });

                    Record = UpdateGuildConfig(Interaction.guildId, {
                        channel_id: Channel.id
                    });

                    return Interaction.reply({
                        content: `Honeypot channel verified.\nChannel: <#${Channel.id}>`,
                        ephemeral: true
                    });
                }

                if (Subcommand === "view") {
                    return Interaction.reply({
                        content: FormatStatus(Record),
                        ephemeral: true
                    });
                }

                if (Subcommand === "config") {
                    const Channel = Interaction.options.getChannel("channel");
                    const ChannelName = Interaction.options.getString("channel_name");
                    const BanReason = Interaction.options.getString("ban_reason");
                    const BanLengthInput = Interaction.options.getString("ban_length");
                    const DeleteMessageSeconds = Interaction.options.getInteger("delete_message_seconds");
                    const EmbedTitle = Interaction.options.getString("embed_title");
                    const EmbedDescription = Interaction.options.getString("embed_description");
                    const EmbedColorInput = Interaction.options.getString("embed_color");
                    const EmbedFooter = Interaction.options.getString("embed_footer");

                    if (Channel && Channel.type !== ChannelType.GuildText) {
                        return Interaction.reply({
                            content: "The selected channel must be a text channel.",
                            ephemeral: true
                        });
                    }

                    let EmbedColor = null;
                    let BanLength = undefined;

                    if (BanLengthInput !== null) {
                        const Punishment = ParsePunishmentLength(BanLengthInput);

                        if (!Punishment) {
                            return Interaction.reply({
                                content: "Invalid ban length. Use kick, examples like 1d, 2d, 1y, or 0 for permanent.",
                                ephemeral: true
                            });
                        }

                        BanLength = Punishment.normalized;
                    }

                    if (EmbedColorInput) {
                        const CleanHex = EmbedColorInput.replace("#", "");

                        if (!/^[0-9a-fA-F]{6}$/.test(CleanHex)) {
                            return Interaction.reply({
                                content: "Invalid embed color. Use a hex color like #ff0000.",
                                ephemeral: true
                            });
                        }

                        EmbedColor = Number.parseInt(CleanHex, 16);
                    }

                    Record = UpdateGuildConfig(Interaction.guildId, {
                        channel_id: Channel?.id,
                        channel_name: ChannelName,
                        ban_reason: BanReason,
                        ban_length: BanLength,
                        delete_message_seconds: DeleteMessageSeconds,
                        embed_title: EmbedTitle,
                        embed_description: EmbedDescription?.replaceAll("\\n", "\n"),
                        embed_color: EmbedColor,
                        embed_footer: EmbedFooter
                    });

                    return Interaction.reply({
                        content: `Honeypot config updated.\n\n${FormatStatus(Record)}`,
                        ephemeral: true
                    });
                }
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName('unbanhoneypots')
                .setDescription('Unban everyone banned for the Honeypot Triggered reason.'),
            async execute(Interaction) {


                await Interaction.deferReply({ ephemeral: true });

                let UnbannedCount = 0;
                let FailedCount = 0;

                try {
                    const BanList = await Interaction.guild.bans.fetch();

                    for (const [UserId, Ban] of BanList) {
                        if (Ban.reason !== 'Honeypot Triggered') continue;

                        try {
                            await Interaction.guild.members.unban(UserId, 'Bulk Honeypot Unban');
                            UnbannedCount++;
                        } catch (Err) {
                            FailedCount++;
                            console.error(`[Honeypot] Failed to unban ${UserId}:`, Err);
                        }
                    }

                    await Interaction.editReply({
                        content:
                            `✅ Honeypot unban complete.\n\n` +
                            `Unbanned: **${UnbannedCount}**\n` +
                            `Failed: **${FailedCount}**`
                    });
                } catch (Err) {
                    console.error('[Honeypot] Unban sweep failed:', Err);

                    await Interaction.editReply({
                        content: '⚠️ Failed to process honeypot unbans.'
                    });
                }
            }
        }
    ]
};
