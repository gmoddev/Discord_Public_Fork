 /* 
 Not_Lowest
 Dev command

 Testing comparasions for messages
 */
const { SlashCommandBuilder, PermissionsBitField, ChannelType, EmbedBuilder } = require("discord.js");
const Database = require("better-sqlite3");
const Path = require("path");

// Database
const Db = new Database(Path.join(__dirname, "..", "data", "ad_monitor.db"));
Db.prepare(`
CREATE TABLE IF NOT EXISTS ad_monitor_config (
    guild_id TEXT,
    channel_id TEXT,
    threshold INTEGER,
    time_limit_ms INTEGER,
    PRIMARY KEY (guild_id, channel_id)
)
`).run();
Db.prepare(`
CREATE TABLE IF NOT EXISTS ad_monitor_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    channel_id TEXT,
    user_id TEXT,
    similarity REAL,
    content TEXT,
    timestamp INTEGER
)
`).run();

// Queries
const UpsertConfig = Db.prepare(`
INSERT INTO ad_monitor_config (guild_id, channel_id, threshold, time_limit_ms)
VALUES (@guild_id, @channel_id, @threshold, @time_limit_ms)
ON CONFLICT(guild_id, channel_id)
DO UPDATE SET threshold = excluded.threshold, time_limit_ms = excluded.time_limit_ms
`);
const DeleteConfig = Db.prepare(`DELETE FROM ad_monitor_config WHERE guild_id = ? AND channel_id = ?`);
const GetConfigs = Db.prepare(`SELECT * FROM ad_monitor_config WHERE guild_id = ?`);
const InsertLog = Db.prepare(`
INSERT INTO ad_monitor_logs (guild_id, channel_id, user_id, similarity, content, timestamp)
VALUES (?, ?, ?, ?, ?, ?)
`);
const GetLogs = Db.prepare(`SELECT * FROM ad_monitor_logs WHERE guild_id = ? ORDER BY id DESC LIMIT 5`);

function TokenOverlap(A, B) {
    const SetA = new Set(A.toLowerCase().split(/\s+/));
    const SetB = new Set(B.toLowerCase().split(/\s+/));
    let Matches = 0;
    for (const Word of SetA) {
        if (SetB.has(Word)) Matches++;
    }
    const Total = Math.max(SetA.size, SetB.size);
    return Total === 0 ? 0 : (Matches / Total) * 100;
}
function LevenshteinRatio(A, B) {
    const LenA = A.length;
    const LenB = B.length;
    const DP = Array.from({ length: LenA + 1 }, () => Array(LenB + 1).fill(0));
    for (let i = 0; i <= LenA; i++) DP[i][0] = i;
    for (let j = 0; j <= LenB; j++) DP[0][j] = j;
    for (let i = 1; i <= LenA; i++) {
        for (let j = 1; j <= LenB; j++) {
            const Cost = A[i-1] === B[j-1] ? 0 : 1;
            DP[i][j] = Math.min(DP[i-1][j]+1, DP[i][j-1]+1, DP[i-1][j-1]+Cost);
        }
    }
    const Distance = DP[LenA][LenB];
    const MaxLen = Math.max(LenA, LenB);
    return MaxLen === 0 ? 0 : ((MaxLen - Distance) / MaxLen) * 100;
}
function JaccardIndex(A, B) {
    const SetA = new Set(A.toLowerCase().split(/\s+/));
    const SetB = new Set(B.toLowerCase().split(/\s+/));
    const Intersection = new Set([...SetA].filter(x => SetB.has(x)));
    const Union = new Set([...SetA, ...SetB]);
    return Union.size === 0 ? 0 : (Intersection.size / Union.size) * 100;
}
function GetAllSimilarities(A, B) {
    return {
        Token: TokenOverlap(A, B),
        Levenshtein: LevenshteinRatio(A, B),
        Jaccard: JaccardIndex(A, B)
    };
}

function ExtractIds(Input) {
    const UrlMatch = Input.match(/\/channels\/(\d+)\/(\d+)\/(\d+)$/);
    if (UrlMatch) {
        return { channelId: UrlMatch[2], messageId: UrlMatch[3] };
    }
    const MsgMatch = Input.match(/(\d{17,20})$/);
    return { channelId: null, messageId: MsgMatch ? MsgMatch[1] : null };
}

// In-memory cache for fast recent checks
const Cache = new Map(); // channelId -> [{content, timestamp}]

function PurgeOld(channelId, timeLimitMs) {
    const Now = Date.now();
    if (!Cache.has(channelId)) return;
    Cache.set(channelId, Cache.get(channelId).filter(e => Now - e.timestamp <= timeLimitMs));
}

module.exports = {
    name: "AdMonitor",
    events: {
        messageCreate: async (client, message) => {
            if (message.author.bot || !message.guild) return;
            const Configs = GetConfigs.all(message.guild.id);
            if (!Configs || Configs.length === 0) return;

            const ChannelConfig = Configs.find(c => c.channel_id === message.channel.id);
            if (!ChannelConfig) return;

            PurgeOld(message.channel.id, ChannelConfig.time_limit_ms);

            const history = Cache.get(message.channel.id) || [];
            for (const entry of history) {
                const sim = GetAllSimilarities(message.content, entry.content);
                const score = Math.max(sim.Token, sim.Levenshtein, sim.Jaccard);
                if (score >= ChannelConfig.threshold) {
                    await message.delete().catch(() => {});
                    await message.channel.send(
                        `⚠️ ${message.author}, your message was too similar to a recent one and has been removed.`
                    );

                    InsertLog.run(
                        message.guild.id,
                        message.channel.id,
                        message.author.id,
                        score.toFixed(2),
                        message.content.slice(0, 200),
                        Date.now()
                    );
                    return;
                }
            }

            history.push({ content: message.content, timestamp: Date.now() });
            Cache.set(message.channel.id, history);
        }
    },

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("admonitor")
                .setDescription("Manage the Ad Monitor system")
                .addSubcommand(sub =>
                    sub.setName("enable")
                        .setDescription("Enable monitoring for a channel")
                        .addChannelOption(o =>
                            o.setName("channel").setDescription("Channel to monitor").addChannelTypes(ChannelType.GuildText).setRequired(true))
                        .addIntegerOption(o =>
                            o.setName("threshold").setDescription("Similarity % (50-100)").setRequired(true))
                        .addIntegerOption(o =>
                            o.setName("hours").setDescription("Time window in hours").setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName("disable")
                        .setDescription("Disable monitoring for a channel")
                        .addChannelOption(o =>
                            o.setName("channel").setDescription("Channel to stop monitoring").addChannelTypes(ChannelType.GuildText).setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName("list")
                        .setDescription("List monitored channels"))
                .addSubcommand(sub =>
                    sub.setName("logs")
                        .setDescription("Show recent blocked messages")),
            async execute(interaction) {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    return interaction.reply({ content: "❌ Manage Server Permission Required.", ephemeral: true });
                }

                const sub = interaction.options.getSubcommand();

                if (sub === "enable") {
                    const channel = interaction.options.getChannel("channel");
                    const threshold = interaction.options.getInteger("threshold");
                    const hours = interaction.options.getInteger("hours");
                    const timeLimitMs = hours * 60 * 60 * 1000;

                    UpsertConfig.run({
                        guild_id: interaction.guild.id,
                        channel_id: channel.id,
                        threshold: Math.min(Math.max(threshold, 50), 100),
                        time_limit_ms: timeLimitMs
                    });

                    await interaction.reply(`✅ Ad monitor enabled for ${channel} (Threshold: ${threshold}%, Window: ${hours}h).`);
                }

                if (sub === "disable") {
                    const channel = interaction.options.getChannel("channel");
                    DeleteConfig.run(interaction.guild.id, channel.id);
                    await interaction.reply(`🛑 Ad monitor disabled for ${channel}.`);
                }

                if (sub === "list") {
                    const Configs = GetConfigs.all(interaction.guild.id);
                    if (Configs.length === 0) return interaction.reply("📭 No channels have ad monitoring enabled.");
                    const Lines = Configs.map(c =>
                        `<#${c.channel_id}> — Threshold ${c.threshold}%, Window ${Math.round(c.time_limit_ms / 3600000)}h`
                    );
                    await interaction.reply("🔎 Ad Monitor channels:\n" + Lines.join("\n"));
                }

                if (sub === "logs") {
                    const Recent = GetLogs.all(interaction.guild.id);
                    if (Recent.length === 0) return interaction.reply("📭 No logs yet.");
                    const Embed = new EmbedBuilder()
                        .setTitle("Ad Monitor Logs")
                        .setColor("Red")
                        .setDescription(Recent.map(l =>
                            `• <@${l.user_id}> in <#${l.channel_id}> — ${l.similarity}%\n\`${l.content}\``
                        ).join("\n"))
                        .setTimestamp();
                    await interaction.reply({ embeds: [Embed], ephemeral: true });
                }
            }
        }
    ]
};