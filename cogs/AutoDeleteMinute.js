const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require("discord.js");
const Database = require("better-sqlite3");
const Path = require("path");

// Database
const Db = new Database(Path.join(__dirname, "..", "data", "short_auto_delete.db"));
Db.prepare(`
CREATE TABLE IF NOT EXISTS auto_delete_config (
    guild_id TEXT,
    channel_id TEXT,
    ttl_ms INTEGER,
    PRIMARY KEY (guild_id, channel_id)
)
`).run();

// Queries
const UpsertConfig = Db.prepare(`
INSERT INTO auto_delete_config (guild_id, channel_id, ttl_ms)
VALUES (@guild_id, @channel_id, @ttl_ms)
ON CONFLICT(guild_id, channel_id)
DO UPDATE SET ttl_ms = excluded.ttl_ms
`);
const DeleteConfig = Db.prepare(`DELETE FROM auto_delete_config WHERE guild_id = ? AND channel_id = ?`);
const GetConfigs = Db.prepare(`SELECT * FROM auto_delete_config WHERE guild_id = ?`);

const Timers = new Map(); // messageId -> Timeout

async function RecoverMessages(client) {
    const Guilds = client.guilds.cache;

    for (const guild of Guilds.values()) {
        const Configs = GetConfigs.all(guild.id);
        if (!Configs.length) continue;

        for (const config of Configs) {
            const channel = guild.channels.cache.get(config.channel_id);
            if (!channel || channel.type !== ChannelType.GuildText) continue;

            try {
                let lastId = null;
                let done = false;

                while (!done) {
                    const Messages = await channel.messages.fetch({
                        limit: 100,
                        before: lastId ?? undefined
                    });

                    if (Messages.size === 0) break;

                    for (const message of Messages.values()) {
                        if (message.author.bot) continue;

                        const Age = Date.now() - message.createdTimestamp;

                        if (Age >= config.ttl_ms) {
                            await message.delete().catch(() => {});
                        } else {
                            const Remaining = config.ttl_ms - Age;
                            ScheduleDelete(message, Remaining);
                        }

                        if (Age > config.ttl_ms * 2) {
                            done = true;
                            break;
                        }
                    }

                    lastId = Messages.last().id;

                    if (Messages.size < 100) break;
                }

            } catch (err) {
                console.warn(`AutoDelete recovery failed for ${channel.id}`, err);
            }
        }
    }

    console.log("AutoDelete recovery completed.");
}

function ScheduleDelete(message, ttlMs) {
    const Timer = setTimeout(async () => {
        try {
            await message.delete().catch(() => {});
        } finally {
            Timers.delete(message.id);
        }
    }, ttlMs);
    Timers.set(message.id, Timer);
}

module.exports = {
    name: "AutoDelete",
    events: {
        ready: async (client) => {
            await RecoverMessages(client)
        },
        messageCreate: async (client, message) => {
            if (message.author.bot || !message.guild) return;
            const Configs = GetConfigs.all(message.guild.id);
            if (!Configs || Configs.length === 0) return;

            const ChannelConfig = Configs.find(c => c.channel_id === message.channel.id);
            if (!ChannelConfig) return;

            ScheduleDelete(message, ChannelConfig.ttl_ms);
        }
    },

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("autodeleteshort")
                .setDescription("Configure automatic message deletion for channels.")
                .addSubcommand(sub =>
                    sub.setName("enable")
                        .setDescription("Enable auto-delete for a channel.")
                        .addChannelOption(o =>
                            o.setName("channel")
                                .setDescription("Channel to monitor")
                                .addChannelTypes(ChannelType.GuildText)
                                .setRequired(true))
                        .addIntegerOption(o =>
                            o.setName("minutes")
                                .setDescription("Time until messages are deleted")
                                .setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName("disable")
                        .setDescription("Disable auto-delete for a channel.")
                        .addChannelOption(o =>
                            o.setName("channel")
                                .setDescription("Channel to stop monitoring")
                                .addChannelTypes(ChannelType.GuildText)
                                .setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName("list")
                        .setDescription("List channels with auto-delete enabled")),
            async execute(interaction) {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    return interaction.reply({ content: "❌ Manage Server Permission Required.", ephemeral: true });
                }

                const sub = interaction.options.getSubcommand();

                if (sub === "enable") {
                    const channel = interaction.options.getChannel("channel");
                    const minutes = interaction.options.getInteger("minutes");
                    const ttlMs = Math.max(1, minutes) * 60 * 1000;

                    UpsertConfig.run({
                        guild_id: interaction.guild.id,
                        channel_id: channel.id,
                        ttl_ms: ttlMs
                    });

                    await interaction.reply(`✅ Auto-delete enabled for ${channel} (${minutes} minutes).`);
                }

                if (sub === "disable") {
                    const channel = interaction.options.getChannel("channel");
                    DeleteConfig.run(interaction.guild.id, channel.id);
                    await interaction.reply(`🛑 Auto-delete disabled for ${channel}.`);
                }

                if (sub === "list") {
                    const Configs = GetConfigs.all(interaction.guild.id);
                    if (Configs.length === 0) {
                        return interaction.reply("📭 No channels have auto-delete enabled.");
                    }
                    const Lines = Configs.map(c =>
                        `<#${c.channel_id}> — ${Math.round(c.ttl_ms / 60000)} minutes`
                    );
                    await interaction.reply("🗑 Auto-delete channels:\n" + Lines.join("\n"));
                }
            }
        }
    ]
};
