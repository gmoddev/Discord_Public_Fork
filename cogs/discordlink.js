const { SlashCommandBuilder } = require("discord.js");
const Database = require("better-sqlite3");
const Path = require("path");

// ─────────────────────────────────────────
// Database
// ─────────────────────────────────────────

const Db = new Database(Path.join(__dirname, "..", "data", "discord_links.db"));

Db.prepare(`
CREATE TABLE IF NOT EXISTS discord_roblox_links (
    guild_id TEXT,
    discord_id TEXT,
    roblox_id TEXT,
    PRIMARY KEY (guild_id, discord_id)
)
`).run();

const UpsertLink = Db.prepare(`
INSERT INTO discord_roblox_links (guild_id, discord_id, roblox_id)
VALUES (?, ?, ?)
ON CONFLICT(guild_id, discord_id)
DO UPDATE SET roblox_id = excluded.roblox_id
`);

const GetLink = Db.prepare(`
SELECT roblox_id
FROM discord_roblox_links
WHERE guild_id = ? AND discord_id = ?
`);


// ─────────────────────────────────────────
// Roblox Validation
// ─────────────────────────────────────────

async function ValidateRobloxUser(UserId) {

    if (!/^\d+$/.test(UserId)) return null;

    try {

        const Response = await fetch(`https://users.roblox.com/v1/users/${UserId}`);

        if (!Response.ok) return null;

        const Data = await Response.json();

        if (!Data || !Data.id) return null;

        return Data;

    } catch {
        return null;
    }
}


// ─────────────────────────────────────────
// Cog
// ─────────────────────────────────────────

module.exports = {

    name: "LinkDiscord",

    commands: [

        // ─────────────────────────────────────
        // LINK DISCORD → ROBLOX
        // ─────────────────────────────────────
        {
            data: new SlashCommandBuilder()
                .setName("linkdiscord")
                .setDescription("Link a Discord user to a Roblox account")
                .addUserOption(o =>
                    o.setName("user")
                        .setDescription("Discord user")
                        .setRequired(true))
                .addStringOption(o =>
                    o.setName("roblox_id")
                        .setDescription("Roblox user ID")
                        .setRequired(true)
                ),

            async execute(interaction) {

                const Target = interaction.options.getUser("user");
                const RobloxId = interaction.options.getString("roblox_id");

                await interaction.deferReply({ ephemeral: true });

                const RobloxUser = await ValidateRobloxUser(RobloxId);

                if (!RobloxUser) {
                    return interaction.editReply({
                        content: "❌ Invalid Roblox ID or user does not exist."
                    });
                }

                UpsertLink.run(
                    interaction.guild.id,
                    Target.id,
                    RobloxUser.id
                );

                return interaction.editReply({
                    content: `✅ Linked **${Target.tag}** → **${RobloxUser.name}** (${RobloxUser.id})`
                });
            }
        },

        // ─────────────────────────────────────
        // GET LINKED USER
        // ─────────────────────────────────────
        {
            data: new SlashCommandBuilder()
                .setName("getuser")
                .setDescription("Get the Roblox account linked to a Discord user")
                .addUserOption(o =>
                    o.setName("user")
                        .setDescription("Discord user")
                        .setRequired(true)
                ),

            async execute(interaction) {

                const Target = interaction.options.getUser("user");

                const Row = GetLink.get(
                    interaction.guild.id,
                    Target.id
                );

                if (!Row) {
                    return interaction.reply({
                        content: "❌ No Roblox account linked for that user.",
                        ephemeral: true
                    });
                }

                try {

                    const Response = await fetch(`https://users.roblox.com/v1/users/${Row.roblox_id}`);
                    const Data = await Response.json();

                    return interaction.reply({
                        content:
                            `👤 **${Target.tag}**\n` +
                            `Roblox: **${Data.name}** (${Data.id})\n` +
                            `https://www.roblox.com/users/${Data.id}/profile`,
                        ephemeral: true
                    });

                } catch {

                    return interaction.reply({
                        content:
                            `👤 **${Target.tag}**\n` +
                            `Roblox ID: **${Row.roblox_id}**`,
                        ephemeral: true
                    });

                }
            }
        }

    ]
};