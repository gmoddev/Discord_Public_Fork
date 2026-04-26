const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require("discord.js");
const Database = require("better-sqlite3");
const Path = require("path");

// ─────────────────────────────────────────
// Database
// ─────────────────────────────────────────
const Db = new Database(Path.join(__dirname, "..", "data", "auto_delete.db"));

Db.prepare(`
CREATE TABLE IF NOT EXISTS auto_delete_config (
    guild_id TEXT,
    channel_id TEXT,
    ttl_ms INTEGER,
    PRIMARY KEY (guild_id, channel_id)
)
`).run();

Db.prepare(`
CREATE TABLE IF NOT EXISTS auto_delete_queue (
    message_id TEXT PRIMARY KEY,
    channel_id TEXT,
    guild_id TEXT,
    delete_at INTEGER
)
`).run();

// ─────────────────────────────────────────
// Queries
// ─────────────────────────────────────────

const UpsertConfig = Db.prepare(`
INSERT INTO auto_delete_config (guild_id, channel_id, ttl_ms)
VALUES (@guild_id, @channel_id, @ttl_ms)
ON CONFLICT(guild_id, channel_id)
DO UPDATE SET ttl_ms = excluded.ttl_ms
`);

const DeleteConfig = Db.prepare(`
DELETE FROM auto_delete_config
WHERE guild_id = ? AND channel_id = ?
`);

const GetConfigs = Db.prepare(`
SELECT * FROM auto_delete_config
WHERE guild_id = ?
`);

const InsertQueue = Db.prepare(`
INSERT OR REPLACE INTO auto_delete_queue
(message_id, channel_id, guild_id, delete_at)
VALUES (?, ?, ?, ?)
`);

const GetExpired = Db.prepare(`
SELECT * FROM auto_delete_queue
WHERE delete_at <= ?
LIMIT 100
`);

const DeleteQueue = Db.prepare(`
DELETE FROM auto_delete_queue
WHERE message_id = ?
`);

// ─────────────────────────────────────────
// Delete Worker
// ─────────────────────────────────────────

const StopAtFourteenDays = false; // set false if you want to delete older-than-14d messages too (single delete still works)
const BackfillIntervalMs = 60 * 60 * 1000; // hourly
const BackfillMaxPagesPerRun = 10; // 10 pages * 100 = 1000 messages max per run per channel
const BackfillSleepMs = 750; // pause between fetches

function Sleep(Ms) {
    return new Promise(r => setTimeout(r, Ms));
}

function Log(...Args) {
    console.log("[AutoDelete]", ...Args);
}

async function BackfillChannel(Channel, TtlMs) {

    const Now = Date.now();
    const FourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

    Log("Scanning channel:", Channel.name, Channel.id);

    let LastId = null;
    let Pages = 0;

    while (Pages < BackfillMaxPagesPerRun) {

        Pages++;

        Log("Fetching page", Pages, "before:", LastId);

        const Messages = await Channel.messages.fetch({
            limit: 100,
            before: LastId ?? undefined
        });

        Log("Fetched messages:", Messages.size);

        if (Messages.size === 0) {
            Log("No more messages to scan");
            break;
        }

        for (const Message of Messages.values()) {

            if (Message.author?.bot) continue;

            const AgeMs = Date.now() - new Date(Message.createdAt).getTime();

            Log(
                "Inspecting message:",
                Message.id,
                "Created:",
                Message.createdAt.toISOString(),
                "Age(days):",
                (AgeMs / 86400000).toFixed(2)
            );
            if (StopAtFourteenDays && AgeMs > FourteenDaysMs) {
                Log("Stopping scan due to 14 day limit");
                return;
            }

            if (AgeMs >= TtlMs) {
                Log(
                    "Deleting message:",
                    Message.id,
                    "Created:",
                    Message.createdAt.toISOString(),
                    "Age(days):",
                    (AgeMs / 86400000).toFixed(2),
                    "TTL(days):",
                    (TtlMs / 86400000).toFixed(2)
                );

                await Message.delete().catch(err => {
                    Log(
                        "Delete failed:",
                        Message.id,
                        "Created:",
                        Message.createdAt.toISOString(),
                        "Age(days):",
                        (AgeMs / 86400000).toFixed(2),
                        err?.message
                    );
                });
            }
        }

        LastId = Messages.last().id;

        if (Messages.size < 100) {
            Log("Reached end of channel history");
            break;
        }

        await Sleep(BackfillSleepMs);
    }

    Log("Finished scanning channel:", Channel.name);
}

async function BackfillAllConfiguredChannels(Client, GetConfigs) {

    Log("Starting backfill run");

    for (const Guild of Client.guilds.cache.values()) {

        Log("Scanning guild:", Guild.name);

        const Configs = GetConfigs.all(Guild.id);

        if (!Configs.length) {
            Log("No configs for guild");
            continue;
        }

        for (const Config of Configs) {

            const Channel = Guild.channels.cache.get(Config.channel_id);

            if (!Channel || Channel.type !== ChannelType.GuildText) {
                Log("Channel missing or invalid:", Config.channel_id);
                continue;
            }

            try {
                Log("Backfill channel:", Channel.name, "TTL:", Config.ttl_ms);

                await BackfillChannel(Channel, Config.ttl_ms);

            } catch (Err) {
                console.warn("[AutoDelete] Backfill failed for", Channel.id, Err);
            }
        }
    }

    Log("Backfill run complete");
}

function StartBackfillLoop(Client, GetConfigs) {

    const Run = async () => {

        try {
            await BackfillAllConfiguredChannels(Client, GetConfigs);
        }
        catch (Err) {
            console.warn("[AutoDelete] Backfill loop error", Err);
        }
    };

    Log("Scheduling first backfill in 15 seconds");

    setTimeout(Run, 15000);

    setInterval(() => {
        Log("Scheduled backfill triggered");
        Run();
    }, BackfillIntervalMs);
}

async function DeleteWorker(client) {

    const Now = Date.now();

    Log("DeleteWorker tick");

    const Expired = GetExpired.all(Now);

    Log("Expired queue entries:", Expired.length);

    if (!Expired.length) return;

    for (const row of Expired) {

        Log("Processing queue message:", row.message_id);

        try {

            const guild = client.guilds.cache.get(row.guild_id);
            const channel = guild?.channels.cache.get(row.channel_id);

            if (!guild) {
                Log("Guild missing:", row.guild_id);
                DeleteQueue.run(row.message_id);
                continue;
            }

            if (!channel) {
                Log("Channel missing:", row.channel_id);
                DeleteQueue.run(row.message_id);
                continue;
            }

            Log("Deleting queued message:", row.message_id);

            await channel.messages.delete(row.message_id).catch(err => {
                Log("Queue delete failed:", row.message_id, err?.message);
            });

        } catch (Err) {

            Log("DeleteWorker error:", Err);

        }

        DeleteQueue.run(row.message_id);

        Log("Queue entry removed:", row.message_id);
    }
}

// ─────────────────────────────────────────
// Cog
// ─────────────────────────────────────────

module.exports = {
    name: "AutoDelete",

    events: {

        // Start worker
        ready: async (Client) => {
            setInterval(() => DeleteWorker(Client), 60_000);

            // add this:
            StartBackfillLoop(Client, GetConfigs);

            console.log("🗑 AutoDelete worker + backfill loop started");
        },

        // Track new messages
        messageCreate: async (client, message) => {

            if (message.author.bot || !message.guild) return;

            const Configs = GetConfigs.all(message.guild.id);
            if (!Configs.length) return;

            const ChannelConfig = Configs.find(c => c.channel_id === message.channel.id);
            if (!ChannelConfig) return;

            const deleteAt = Date.now() + ChannelConfig.ttl_ms;

            InsertQueue.run(
                message.id,
                message.channel.id,
                message.guild.id,
                deleteAt
            );
        }
    },

    // ─────────────────────────────────────────
    // Slash Commands
    // ─────────────────────────────────────────

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("autodelete")
                .setDescription("Configure automatic message deletion")
                .addSubcommand(sub =>
                    sub.setName("enable")
                        .setDescription("Enable auto-delete for a channel")
                        .addChannelOption(o =>
                            o.setName("channel")
                                .setDescription("Channel")
                                .addChannelTypes(ChannelType.GuildText)
                                .setRequired(true))
                        .addIntegerOption(o =>
                            o.setName("minutes")
                                .setDescription("Delete messages after X minutes")
                                .setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName("disable")
                        .setDescription("Disable auto-delete")
                        .addChannelOption(o =>
                            o.setName("channel")
                                .setDescription("Channel")
                                .addChannelTypes(ChannelType.GuildText)
                                .setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName("list")
                        .setDescription("List auto-delete channels")),

            async execute(interaction) {

                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    return interaction.reply({
                        content: "❌ Manage Server permission required.",
                        ephemeral: true
                    });
                }

                const sub = interaction.options.getSubcommand();

                // ───── ENABLE ─────

                if (sub === "enable") {

                    const channel = interaction.options.getChannel("channel");
                    const minutes = interaction.options.getInteger("minutes");

                    const ttlMs = Math.max(1, minutes) * 60 * 1000;

                    UpsertConfig.run({
                        guild_id: interaction.guild.id,
                        channel_id: channel.id,
                        ttl_ms: ttlMs
                    });

                    return interaction.reply(
                        `✅ Auto-delete enabled for ${channel} (${minutes} minutes)`
                    );
                }

                // ───── DISABLE ─────

                if (sub === "disable") {

                    const channel = interaction.options.getChannel("channel");

                    DeleteConfig.run(
                        interaction.guild.id,
                        channel.id
                    );

                    return interaction.reply(
                        `🛑 Auto-delete disabled for ${channel}`
                    );
                }

                // ───── LIST ─────

                if (sub === "list") {

                    const Configs = GetConfigs.all(interaction.guild.id);

                    if (!Configs.length) {
                        return interaction.reply("📭 No auto-delete channels configured.");
                    }

                    const Lines = Configs.map(c =>
                        `<#${c.channel_id}> — ${Math.round(c.ttl_ms / 60000)} minutes`
                    );

                    return interaction.reply(
                        "🗑 Auto-delete channels:\n" + Lines.join("\n")
                    );
                }
            }
        }
    ]
};