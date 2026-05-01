const { SlashCommandBuilder } = require("discord.js");
const Database = require("better-sqlite3");
const Path = require("path");
const Fs = require("fs");
const { IsOwner } = require("../helpers/RankChecker");
const { ParseDuration } = require("../helpers/TimeHelper");

// ================= CONFIG =================

const Config = {
    DatabaseFolder: Path.join(__dirname, "..", "data"),
    DatabaseFile: "global_bans.db",

    ExpirationCheckIntervalMs: 30 * 1000,

    ReasonLimit: 450,

    // Anything equal to or above this becomes permanent.
    MaxTemporaryBanMs: 2 * 365 * 24 * 60 * 60 * 1000,

    DefaultBanReason: "Global Ban Enforcement",
    JoinBanReason: "Active Global Ban",

    LogFailedGuildActions: true
};

// ================= DATABASE =================

if (!Fs.existsSync(Config.DatabaseFolder)) {
    Fs.mkdirSync(Config.DatabaseFolder, { recursive: true });
}

const Db = new Database(Path.join(Config.DatabaseFolder, Config.DatabaseFile));

Db.prepare(`
CREATE TABLE IF NOT EXISTS global_bans (
    user_id TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
)
`).run();

const InsertBan = Db.prepare(`
INSERT INTO global_bans (user_id, reason, expires_at, created_at)
VALUES (@user_id, @reason, @expires_at, @created_at)
ON CONFLICT(user_id)
DO UPDATE SET
    reason = excluded.reason,
    expires_at = excluded.expires_at,
    created_at = excluded.created_at
`);

const RemoveBan = Db.prepare(`DELETE FROM global_bans WHERE user_id = ?`);
const GetBan = Db.prepare(`SELECT * FROM global_bans WHERE user_id = ?`);
const GetAllBans = Db.prepare(`SELECT * FROM global_bans`);

// ================= HELPERS =================

function TrimReason(Reason) {
    if (!Reason) return "No reason provided.";
    return Reason.slice(0, Config.ReasonLimit);
}

function LogGuildActionFailure(Action, Guild, UserId, Error) {
    if (!Config.LogFailedGuildActions) return;

    console.warn(
        `Failed to ${Action} user ${UserId} in guild ${Guild.name} (${Guild.id}): ${Error.message}`
    );
}

// ================= BAN ENFORCEMENT =================

async function EnforceBan(Client, UserId, Reason = Config.DefaultBanReason) {
    for (const Guild of Client.guilds.cache.values()) {
        try {
            await Guild.members.ban(UserId, {
                reason: TrimReason(Reason)
            });
        } catch (Error) {
            LogGuildActionFailure("ban", Guild, UserId, Error);
        }
    }
}

async function LiftBan(Client, UserId) {
    for (const Guild of Client.guilds.cache.values()) {
        try {
            await Guild.members.unban(UserId);
        } catch (Error) {
            LogGuildActionFailure("unban", Guild, UserId, Error);
        }
    }
}

async function CheckExpiredBans(Client) {
    const Now = Date.now();
    const Bans = GetAllBans.all();

    for (const Ban of Bans) {
        if (Ban.expires_at !== 0 && Ban.expires_at <= Now) {
            RemoveBan.run(Ban.user_id);
            await LiftBan(Client, Ban.user_id);
            console.log(`Expired global ban lifted: ${Ban.user_id}`);
        }
    }
}

// ================= MODULE =================

module.exports = {
    name: "GlobalBanSystem",

    events: {
        ready: async (Client) => {
            console.log("Loaded.");

            await Client.guilds.fetch();

            const Bans = GetAllBans.all();
            const Now = Date.now();

            for (const Ban of Bans) {
                if (Ban.expires_at === 0 || Ban.expires_at > Now) {
                    await EnforceBan(Client, Ban.user_id, Config.DefaultBanReason);
                } else {
                    RemoveBan.run(Ban.user_id);
                }
            }

            setInterval(() => {
                CheckExpiredBans(Client).catch(Error => {
                    console.error("Expiration check failed:", Error);
                });
            }, Config.ExpirationCheckIntervalMs);
        },

        guildMemberAdd: async (Client, Member) => {
            const Ban = GetBan.get(Member.id);
            if (!Ban) return;

            if (Ban.expires_at === 0 || Ban.expires_at > Date.now()) {
                try {
                    await Member.ban({
                        reason: TrimReason(Ban.reason || Config.JoinBanReason)
                    });
                } catch (Error) {
                    LogGuildActionFailure("ban joining member", Member.guild, Member.id, Error);
                }
            } else {
                RemoveBan.run(Member.id);
            }
        }
    },

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("gban")
                .setDescription("Globally ban a user.")
                .addUserOption(o =>
                    o.setName("user")
                        .setDescription("User to ban")
                        .setRequired(true))
                .addStringOption(o =>
                    o.setName("time")
                        .setDescription("5s, 10m, 1d, 1y or 0 for permanent")
                        .setRequired(true))
                .addStringOption(o =>
                    o.setName("reason")
                        .setDescription("Reason for the ban")
                        .setRequired(true)),

            async execute(interaction) {
                if (!IsOwner(interaction.member)) {
                    return interaction.reply({
                        content: "Bot Owner Only.",
                        ephemeral: true
                    });
                }

                const User = interaction.options.getUser("user");
                const TimeInput = interaction.options.getString("time");
                const Reason = TrimReason(interaction.options.getString("reason"));

                if (User.id === interaction.client.user.id) {
                    return interaction.reply({
                        content: "You cannot globally ban the bot.",
                        ephemeral: true
                    });
                }

                if (User.id === interaction.user.id) {
                    return interaction.reply({
                        content: "You cannot globally ban yourself.",
                        ephemeral: true
                    });
                }

                const Duration = ParseDuration(TimeInput, {
                    maxTemporaryMs: Config.MaxTemporaryBanMs
                });
                if (Duration === null) {
                    return interaction.reply({
                        content: "Invalid time format. Use examples like 5s, 10m, 1d, 1y, or 0.",
                        ephemeral: true
                    });
                }

                const CreatedAt = Date.now();
                const ExpiresAt = Duration === 0 ? 0 : CreatedAt + Duration;

                InsertBan.run({
                    user_id: User.id,
                    reason: Reason,
                    expires_at: ExpiresAt,
                    created_at: CreatedAt
                });

                await EnforceBan(interaction.client, User.id, Reason);

                const ExpireText = Duration === 0
                    ? "Permanent"
                    : `<t:${Math.floor(ExpiresAt / 1000)}:F>`;

                await interaction.reply(
                    `Global ban issued.\nUser: ${User.tag}\nExpires: ${ExpireText}\nReason: ${Reason}`
                );
            }
        },

        {
            data: new SlashCommandBuilder()
                .setName("ungban")
                .setDescription("Remove a global ban.")
                .addUserOption(o =>
                    o.setName("user")
                        .setDescription("User to unban")
                        .setRequired(true)),

            async execute(interaction) {
                if (!IsOwner(interaction.member)) {
                    return interaction.reply({
                        content: "Bot Owner Only.",
                        ephemeral: true
                    });
                }

                const User = interaction.options.getUser("user");

                RemoveBan.run(User.id);
                await LiftBan(interaction.client, User.id);

                await interaction.reply(`Global ban removed for ${User.tag}`);
            }
        }
    ]
};
