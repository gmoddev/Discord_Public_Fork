const { PermissionFlagsBits, EmbedBuilder } = require("discord.js");

module.exports = {
    name: "AdminCheckNotifier",

    events: {

        ready: async (Client) => {

            console.log("🔍 Admin check starting...");

            const NotifyIds = [
                "1030659798460530820",
            ];

            const StartupReportUser = "1030659798460530820";

            const NotifiedGuilds = new Set();

            // ─────────────────────────────
            // Helper: Format Permissions
            // ─────────────────────────────
            function GetPermStatus(Perms) {
                return {
                    Administrator: Perms.has(PermissionFlagsBits.Administrator),
                    ManageRoles: Perms.has(PermissionFlagsBits.ManageRoles),
                    ManageChannels: Perms.has(PermissionFlagsBits.ManageChannels),
                    ViewAuditLog: Perms.has(PermissionFlagsBits.ViewAuditLog),
                };
            }

            function FormatPerms(P) {
                return Object.entries(P)
                    .map(([k, v]) => `${v ? "✅" : "❌"} ${k}`)
                    .join("\n");
            }

            // ─────────────────────────────
            // Startup Report
            // ─────────────────────────────
            const SendStartupReport = async () => {

                const Embeds = [];

                let CurrentEmbed = new EmbedBuilder()
                    .setTitle("✅ Bot Startup Successful")
                    .setDescription(`Servers: ${Client.guilds.cache.size}`)
                    .setColor(0x00ff88);

                let CurrentLength = 0;

                for (const Guild of Client.guilds.cache.values()) {

                    try {

                        const BotMember = Guild.members.me;
                        if (!BotMember) continue;

                        const Perms = GetPermStatus(BotMember.permissions);
                        const Roles = Guild.roles.cache
                            .filter(r => r.id !== Guild.id) // remove @everyone
                            .sort((a, b) => b.position - a.position)
                            .values();

                        const RoleArray = Array.from(Roles);

                        const HighestRole = BotMember.roles.highest;

                        const IndexFromTop = RoleArray.findIndex(r => r.id === HighestRole.id);
                        const DistanceFromTop = IndexFromTop === -1 ? "Unknown" : IndexFromTop + 1;

                        const Block =
                            `**${Guild.name}**
ID: ${Guild.id}
Members: ${Guild.memberCount}
Top Role: ${HighestRole.name}
Rank From Top: ${DistanceFromTop}

${FormatPerms(Perms)}`;

                        // If adding this would exceed safe embed limit (~4000 chars)
                        if (CurrentLength + Block.length > 3500) {
                            Embeds.push(CurrentEmbed);

                            CurrentEmbed = new EmbedBuilder()
                                .setColor(0x00ff88);

                            CurrentLength = 0;
                        }

                        CurrentEmbed.addFields({
                            name: " ",
                            value: Block,
                        });

                        CurrentLength += Block.length;

                    } catch (Err) {
                        console.error(`[StartupReport] ${Guild.name}`, Err);
                    }
                }

                // Push last embed
                if (CurrentLength > 0) {
                    Embeds.push(CurrentEmbed);
                }

                try {
                    const User = await Client.users.fetch(StartupReportUser);

                    if (User) {
                        for (const Embed of Embeds) {
                            await User.send({ embeds: [Embed] }).catch(() => { });
                        }
                    }

                } catch (Err) {
                    console.error("[StartupReport] DM failed:", Err);
                }
            };

            // ─────────────────────────────
            // Main Check Loop
            // ─────────────────────────────
            const RunCheck = async () => {

                for (const Guild of Client.guilds.cache.values()) {

                    try {

                        const BotMember = Guild.members.me;
                        if (!BotMember) continue;

                        const Perms = GetPermStatus(BotMember.permissions);

                        const Missing = Object.entries(Perms)
                            .filter(([_, v]) => !v)
                            .map(([k]) => k);

                        // If everything is fine → clear notification state
                        if (Missing.length === 0) {
                            NotifiedGuilds.delete(Guild.id);
                            continue;
                        }

                        // Prevent spam
                        if (NotifiedGuilds.has(Guild.id)) continue;

                        NotifiedGuilds.add(Guild.id);

                        const Msg =
                            `⚠️ Missing Critical Permissions

Server: **${Guild.name}**
ID: ${Guild.id}
Members: ${Guild.memberCount}

Missing:
${Missing.map(m => `❌ ${m}`).join("\n")}

Top Role: ${BotMember.roles.highest.name}

This WILL break functionality. Fix it.`;

                        for (const Id of NotifyIds) {
                            try {
                                const User = await Client.users.fetch(Id);
                                if (User) {
                                    await User.send(Msg).catch(() => { });
                                }
                            } catch (Err) {
                                console.error(`[AdminCheckNotifier] DM to ${Id} failed:`, Err);
                            }
                        }

                        console.warn(`⚠️ Missing perms in ${Guild.name}: ${Missing.join(", ")}`);

                    } catch (Err) {
                        console.error(`[AdminCheckNotifier] Error in ${Guild.name}:`, Err);
                    }
                }
            };

            // ─────────────────────────────
            // Run Startup + Loop
            // ─────────────────────────────

            await SendStartupReport();
            await RunCheck();

            setInterval(RunCheck, 10 * 60 * 1000);

            console.log("✅ Admin check loop running");
        }
    }
};