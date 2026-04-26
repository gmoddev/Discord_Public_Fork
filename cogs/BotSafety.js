const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const fs = require("fs");
const path = require("path");

const { IsOwner, GetBotOwner } = require("../helpers/RankChecker");

const DataPath = path.join(__dirname, "../data/hierarchyWarnings.json");

// ───── LOAD / SAVE ─────
function LoadData() {
    if (!fs.existsSync(DataPath)) return {};
    return JSON.parse(fs.readFileSync(DataPath));
}

function SaveData(Data) {
    fs.mkdirSync(path.dirname(DataPath), { recursive: true });
    fs.writeFileSync(DataPath, JSON.stringify(Data, null, 2));
}

let GuildStates = LoadData();

// ───── CHANNEL FINDER ─────
function FindBestChannel(Guild) {

    const Keywords = ["admin", "staff", "mod", "private", "bot"];

    // Semi-private first
    let Channel = Guild.channels.cache.find(c =>
        c.isTextBased() &&
        Keywords.some(k => c.name.toLowerCase().includes(k))
    );

    if (Channel) return Channel;

    // System channel
    if (Guild.systemChannel) return Guild.systemChannel;

    // Any text channel
    return Guild.channels.cache.find(c => c.isTextBased());
}

// ───── ESCALATION TIMER ─────
function GetInterval(DurationMs) {
    const Hours = DurationMs / (1000 * 60 * 60);

    if (Hours < 6) return 1000 * 60 * 60 * 2;      // 2h
    if (Hours < 24) return 1000 * 60 * 30;         // 30m
    return 1000 * 60 * 10;                         // 10m
}

// ───── MESSAGE LEVEL ─────
function GetMessage(DurationMs, GuildName) {
    const Hours = DurationMs / (1000 * 60 * 60);

    if (Hours < 6) {
        return `⚠️ Bot must be highest role in **${GuildName}**. Please fix this.`;
    }

    if (Hours < 24) {
        return `⚠️ **WARNING**: Bot is not highest role in **${GuildName}**. Fix this soon.`;
    }

    return `🚨 **NON-COMPLIANT**: Bot is not highest role in **${GuildName}**. This server may be struck.`;
}

// ───── MAIN CHECK ─────
async function CheckGuild(client, Guild) {

    const BotMember = Guild.members.me;
    if (!BotMember) return;

    const BotHighest = BotMember.roles.highest;
    const Highest = Guild.roles.highest;

    const OthersHaveRole = BotHighest.members.some(m => m.id !== BotMember.id);

    const IsBad = (BotHighest.id !== Highest.id) || OthersHaveRole;

    let State = GuildStates[Guild.id];

    if (!IsBad) {
        if (State) {
            delete GuildStates[Guild.id];
            SaveData(GuildStates);
        }
        return;
    }

    const Now = Date.now();

    // ───── FIRST DETECT ─────
    if (!State) {
        State = {
            firstDetected: Now,
            lastNotified: 0,
            dmSent: false,
            silenced: false
        };
        GuildStates[Guild.id] = State;
        SaveData(GuildStates);
    }

    if (State.silenced) return;

    const Duration = Now - State.firstDetected;
    const Interval = GetInterval(Duration);

    if (Now - State.lastNotified < Interval) return;

    State.lastNotified = Now;
    SaveData(GuildStates);

    // ───── SEND MESSAGE ─────
    const Channel = FindBestChannel(Guild);
    const Message = GetMessage(Duration, Guild.name);

    try {
        const Owner = await Guild.fetchOwner();
        if (Channel) {
            await Channel.send(`${Owner} ${Message}`);
        }
    } catch { }

    // ───── DM BOT OWNER (ONCE) ─────
    if (!State.dmSent) {
        const Owners = GetBotOwner();

        for (const Id of Owners) {
            try {
                const User = await client.users.fetch(Id);
                await User.send(`🚨 Guild "${Guild.name}" is non-compliant.`);
            } catch { }
        }

        State.dmSent = true;
        SaveData(GuildStates);
    }
}

// ───── LOOP ─────
async function RunCheck(client) {
    for (const Guild of client.guilds.cache.values()) {
        await CheckGuild(client, Guild);
    }
}

function EvaluateCompliance(Guild) {
    const BotMember = Guild.members.me;
    if (!BotMember) {
        return { exists: false };
    }

    const BotHighest = BotMember.roles.highest;
    const Highest = Guild.roles.highest;

    const HasAdmin = BotMember.permissions.has(PermissionFlagsBits.Administrator);

    const OthersHaveRole = BotHighest.members.some(m => m.id !== BotMember.id);
    const NotHighest = BotHighest.id !== Highest.id;

    const IsBad = !HasAdmin || NotHighest || OthersHaveRole;

    const State = GuildStates[Guild.id];

    return {
        exists: true,
        isBad: IsBad,
        hasAdmin: HasAdmin,
        notHighest: NotHighest,
        othersHaveRole: OthersHaveRole,
        state: State,
        botRole: BotHighest,
        highestRole: Highest
    };
}
// ───── EXPORT ─────
module.exports = {
    name: "HierarchyEnforcer",

    events: {
        ready: (client) => {

            // Run every 5 minutes (fine-grained control)
            setInterval(() => {
                RunCheck(client);
            }, 1000 * 60 * 5);
        }
    },

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("silencehierarchywarnings")
                .setDescription("Silence hierarchy warnings for a guild")
                .addStringOption(opt =>
                    opt.setName("guildid")
                        .setDescription("Guild ID")
                        .setRequired(true)
                ),

            async execute(interaction) {

                if (!IsOwner(interaction)) {
                    return interaction.reply({
                        content: "Owner only command.",
                        ephemeral: true
                    });
                }

                const GuildId = interaction.options.getString("guildid");

                if (!GuildStates[GuildId]) {
                    GuildStates[GuildId] = {
                        firstDetected: Date.now(),
                        lastNotified: 0,
                        dmSent: true,
                        silenced: true
                    };
                } else {
                    GuildStates[GuildId].silenced = true;
                }

                SaveData(GuildStates);

                await interaction.reply({
                    content: `🔕 Silenced warnings for ${GuildId}`,
                    ephemeral: true
                });
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName("compliancestatus")
                .setDescription("Check compliance status for this server"),

            async execute(interaction) {

                if (!IsOwner(interaction)) {
                    return interaction.reply({
                        content: "❌ Owner only."
                    });
                }

                const Guild = interaction.guild;
                const Result = EvaluateCompliance(Guild);

                if (!Result.exists) {
                    return interaction.reply("❌ Bot member not found.");
                }

                let Status = "✅ COMPLIANT";
                let Details = [];

                if (Result.notHighest) {
                    Details.push("• Bot is NOT the highest role");
                }

                if (Result.othersHaveRole) {
                    Details.push("• Other users have the bot's top role");
                }

                if (Result.isBad) {
                    Status = "🚨 NON-COMPLIANT";
                }

                if (Result.state?.silenced) {
                    Details.push("• Warnings are silenced");
                }

                if (Result.state) {
                    const Duration = Date.now() - Result.state.firstDetected;
                    const Hours = (Duration / (1000 * 60 * 60)).toFixed(1);
                    Details.push(`• Non-compliant for: ${Hours}h`);
                }

                if (Details.length === 0) {
                    Details.push("• All checks passed");
                }

                // 🔥 SOLUTION BLOCK
                let Solution = [];

                if (Result.notHighest) {
                    Solution.push("Move bot role above all roles");
                }

                if (Result.othersHaveRole) {
                    Solution.push("Remove other users from the bot's top role");
                }

                if (!Result.hasAdmin) {
                    Details.push("• Bot does NOT have Administrator permission");
                }

                if (Solution.length === 0) {
                    Solution.push("No action required");
                }

                await interaction.reply(
                    `**Compliance Status for ${Guild.name}**
${Status}

**Details:**
${Details.join("\n")}

**Solution:**
You must:
${Solution.map(s => `• ${s}`).join("\n")}`
                );
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName("compliancesolution")
                .setDescription("Get steps to fix compliance issues"),

            async execute(interaction) {

                if (!IsOwner(interaction)) {
                    return interaction.reply({
                        content: "❌ Owner only."
                    });
                }

                const Guild = interaction.guild;
                const Result = EvaluateCompliance(Guild);

                if (!Result.exists) {
                    return interaction.reply("❌ Bot member not found.");
                }

                if (!Result.isBad) {
                    return interaction.reply(
                        `✅ This server is already compliant.

No action needed.`
                    );
                }

                let Steps = [];

                if (Result.notHighest) {
                    Steps.push("Move the bot role to the top of the role hierarchy");
                }

                if (Result.othersHaveRole) {
                    Steps.push("Remove all users from the bot's highest role");
                }

                if (!Result.hasAdmin) {
                    Details.push("• Bot does NOT have Administrator permission");
                }
                await interaction.reply(
                    `🚨 **Fix Required for ${Guild.name}**

You must:
${Steps.map(s => `• ${s}`).join("\n")}`
                );
            }
        }
    ]
};