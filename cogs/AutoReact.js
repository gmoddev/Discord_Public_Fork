const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require("discord.js");

const Database = require("better-sqlite3");
const Path = require("path");


// ─────────────────────────────────────────────────────────────
// Database a
// ─────────────────────────────────────────────────────────────
const Db = new Database(Path.join(__dirname, "..", "data", "auto_react.db"));

Db.prepare(`
CREATE TABLE IF NOT EXISTS auto_react_config (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    keyword TEXT,
    PRIMARY KEY (guild_id, channel_id, emoji)
)
`).run();

const InsertConfig = Db.prepare(`
INSERT OR REPLACE INTO auto_react_config 
(guild_id, channel_id, emoji, keyword)
VALUES (@guild_id, @channel_id, @emoji, @keyword)
`);

const DeleteConfig = Db.prepare(`
DELETE FROM auto_react_config 
WHERE guild_id = ? AND channel_id = ? AND emoji = ?
`);

const GetGuildConfigs = Db.prepare(`
SELECT * FROM auto_react_config WHERE guild_id = ?
`);

const GetChannelConfigs = Db.prepare(`
SELECT * FROM auto_react_config WHERE guild_id = ? AND channel_id = ?
`);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function MatchesKeyword(Content, Keyword) {
    if (!Keyword) return true;
    return Content.toLowerCase().includes(Keyword.toLowerCase());
}

async function SafeReact(Message, Emoji) {
    try {
        if (Message.reactions.cache.some(r => r.emoji.id === Emoji || r.emoji.name === Emoji)) return;
        await Message.react(Emoji);
    } catch { }

}

async function ProcessMessage(Message, Configs) {
    for (const Row of Configs) {
        try {
            if (!MatchesKeyword(Message.content || "", Row.keyword)) continue;
            await SafeReact(Message, Row.emoji);
        } catch { }
    }
}

function NormalizeEmoji(Input) {
    if (!Input) return null;

    // Unicode emoji
    if (!Input.includes("<")) return Input;

    // <a:name:id> or <:name:id>
    const Match = Input.match(/<a?:\w+:(\d+)>/);
    if (!Match) return null;

    return Match[1]; // Snowflake ID
}


// Discord-safe 14 day window
const MAX_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// Backfill On Startup
// ─────────────────────────────────────────────────────────────
async function BackfillGuild(Client, Guild) {
    try {
        const Rows = GetGuildConfigs.all(Guild.id);
        if (!Rows.length) return;

        const Channels = [...new Set(Rows.map(r => r.channel_id))];

        for (const ChannelId of Channels) {
            try {
                const Channel = await Guild.channels.fetch(ChannelId).catch(() => null);
                if (!Channel || !Channel.isTextBased()) continue;

                const Configs = Rows.filter(r => r.channel_id === ChannelId);

                let LastId = null;
                let Done = false;

                while (!Done) {
                    const Messages = await Channel.messages.fetch({ limit: 100, before: LastId }).catch(() => null);
                    if (!Messages || Messages.size === 0) break;

                    for (const Msg of Messages.values()) {
                        if (Date.now() - Msg.createdTimestamp > MAX_LOOKBACK_MS) {
                            Done = true;
                            break;
                        }
                        await ProcessMessage(Msg, Configs);
                    }

                    LastId = Messages.last().id;
                }
            } catch { }
        }
    } catch { }
}

// ─────────────────────────────────────────────────────────────
// Cog
// ─────────────────────────────────────────────────────────────
module.exports = {
    name: "autoreact",
    components: {},

    events: {
        ready: async (client) => {
            for (const Guild of client.guilds.cache.values()) {
                await BackfillGuild(client, Guild);
            }
        },

        messageCreate: async (client, message) => {
            try {
                if (message.author.bot || !message.guild) return;
                const Configs = GetChannelConfigs.all(message.guild.id, message.channel.id);
                if (!Configs.length) return;
                await ProcessMessage(message, Configs);
            } catch { }
        }
    },

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("autoreact")
                .setDescription("Automatically react to messages in a channel.")

                .addSubcommand(s =>
                    s.setName("add")
                        .setDescription("Add an auto-reaction rule")
                        .addChannelOption(o =>
                            o.setName("channel")
                                .setDescription("Channel to watch for messages")
                                .setRequired(true)
                                .addChannelTypes(ChannelType.GuildText)
                        )
                        .addStringOption(o =>
                            o.setName("emoji")
                                .setDescription("Emoji to react with (Unicode or custom)")
                                .setRequired(true)
                        )
                        .addStringOption(o =>
                            o.setName("keyword")
                                .setDescription("Only react when this text appears")
                                .setRequired(false)
                        )
                )

                .addSubcommand(s =>
                    s.setName("remove")
                        .setDescription("Remove an auto-reaction rule")
                        .addChannelOption(o =>
                            o.setName("channel")
                                .setDescription("Channel to remove the rule from")
                                .setRequired(true)
                                .addChannelTypes(ChannelType.GuildText)
                        )
                        .addStringOption(o =>
                            o.setName("emoji")
                                .setDescription("Emoji to remove")
                                .setRequired(true)
                        )
                )

                .addSubcommand(s =>
                    s.setName("list")
                        .setDescription("List all configured auto-react rules")
                ),

            async execute(interaction) {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    return interaction.reply({ content: "❌ Manage Server permission required.", ephemeral: true });
                }

                const Sub = interaction.options.getSubcommand();

                if (Sub === "add") {
                    const Channel = interaction.options.getChannel("channel");
                    const RawEmoji = interaction.options.getString("emoji");
                    const Emoji = NormalizeEmoji(RawEmoji);

                    if (!Emoji) {
                        return interaction.reply({ content: "❌ Invalid emoji format.", ephemeral: true });
                    }

                    const Keyword = interaction.options.getString("keyword");

                    InsertConfig.run({
                        guild_id: interaction.guild.id,
                        channel_id: Channel.id,
                        emoji: Emoji,
                        keyword: Keyword || null
                    });

                    return interaction.reply({
                        content: `✅ Auto-react enabled in ${Channel} with ${Emoji}${Keyword ? ` when message contains "${Keyword}"` : ""}`,
                        ephemeral: true
                    });
                }

                if (Sub === "remove") {
                    const Channel = interaction.options.getChannel("channel");
                    const RawEmoji = interaction.options.getString("emoji");
                    const Emoji = NormalizeEmoji(RawEmoji);

                    if (!Emoji) {
                        return interaction.reply({ content: "❌ Invalid emoji format.", ephemeral: true });
                    }

                    DeleteConfig.run(interaction.guild.id, Channel.id, Emoji);

                    return interaction.reply({
                        content: `🗑 Removed ${Emoji} from ${Channel}`,
                        ephemeral: true
                    });
                }

                if (Sub === "list") {
                    const Rows = GetGuildConfigs.all(interaction.guild.id);
                    if (!Rows.length) {
                        return interaction.reply({ content: "📭 No auto-react rules configured.", ephemeral: true });
                    }

                    const Lines = Rows.map(r =>
                        `<#${r.channel_id}> → ${r.emoji}${r.keyword ? ` (keyword: "${r.keyword}")` : ""}`
                    );

                    return interaction.reply({
                        content: "🤖 **Auto-React Rules:**\n" + Lines.join("\n"),
                        ephemeral: true
                    });
                }
            }
        }
    ]

};
