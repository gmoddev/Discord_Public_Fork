const {
    SlashCommandBuilder,
    PermissionsBitField,
    ActionRowBuilder,
    StringSelectMenuBuilder
} = require("discord.js");
const Database = require("better-sqlite3");
const Path = require("path");
const { registerCommand } = require('../helpers/RankChecker');

registerCommand('aura');

// ─────────────────────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────────────────────
const Db = new Database(Path.join(__dirname, "..", "data", "aura_system.db"));

Db.prepare(`
CREATE TABLE IF NOT EXISTS booster_config (
    guild_id TEXT PRIMARY KEY,
    booster_role_id TEXT
)
`).run();

Db.prepare(`
CREATE TABLE IF NOT EXISTS aura_roles (
    guild_id TEXT,
    role_id TEXT,
    PRIMARY KEY (guild_id, role_id)
)
`).run();

Db.prepare(`
CREATE TABLE IF NOT EXISTS bypass_users (
    guild_id TEXT,
    user_id TEXT,
    PRIMARY KEY (guild_id, user_id)
)
`).run();

Db.prepare(`
CREATE TABLE IF NOT EXISTS bypass_roles (
    guild_id TEXT,
    role_id TEXT,
    PRIMARY KEY (guild_id, role_id)
)
`).run();

// ─────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────
const SetBoosterRole = Db.prepare(`
INSERT INTO booster_config (guild_id, booster_role_id)
VALUES (?, ?)
ON CONFLICT(guild_id)
DO UPDATE SET booster_role_id = excluded.booster_role_id
`);

const AddAuraRole = Db.prepare(`INSERT OR IGNORE INTO aura_roles VALUES (?, ?)`);
const RemoveAuraRole = Db.prepare(`DELETE FROM aura_roles WHERE guild_id = ? AND role_id = ?`);
const GetAuraRoles = Db.prepare(`SELECT role_id FROM aura_roles WHERE guild_id = ?`);

const AddBypassUser = Db.prepare(`INSERT OR IGNORE INTO bypass_users VALUES (?, ?)`);
const AddBypassRole = Db.prepare(`INSERT OR IGNORE INTO bypass_roles VALUES (?, ?)`);
const HasBypassUser = Db.prepare(`SELECT 1 FROM bypass_users WHERE guild_id = ? AND user_id = ?`);
const GetBypassRoles = Db.prepare(`SELECT role_id FROM bypass_roles WHERE guild_id = ?`);
const GetBoosterRole = Db.prepare(`SELECT booster_role_id FROM booster_config WHERE guild_id = ?`);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function HasAuraAccess(member) {
    const Booster = GetBoosterRole.get(member.guild.id);
    if (Booster && member.roles.cache.has(Booster.booster_role_id)) return true;
    if (HasBypassUser.get(member.guild.id, member.id)) return true;

    const Roles = GetBypassRoles.all(member.guild.id);
    return Roles.some(r => member.roles.cache.has(r.role_id));
}

async function RemoveAllAuras(member) {
    const Auras = GetAuraRoles.all(member.guild.id);
    for (const r of Auras) {
        if (member.roles.cache.has(r.role_id)) {
            await member.roles.remove(r.role_id).catch(() => {});
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Cog Export
// ─────────────────────────────────────────────────────────────
module.exports = {
    name: "AuraSystem",

    // ─────────────── EVENTS ───────────────
    events: {
        guildMemberUpdate: async (client, oldMember, newMember) => {
            const Booster = GetBoosterRole.get(newMember.guild.id);
            if (!Booster) return;

            const BoosterRoleId = Booster.booster_role_id;

            // If they still have booster → nothing to do
            if (newMember.roles.cache.has(BoosterRoleId)) return;

            // If they never had booster → ignore
            if (!oldMember.roles.cache.has(BoosterRoleId)) return;

            // If they have bypass access → ignore
            if (HasAuraAccess(newMember)) return;

            // Booster lost → remove all auras
            await RemoveAllAuras(newMember);
        }
    },

    // ─────────────── COMPONENTS ───────────────
    components: {
        aura_menu_select: async (client, interaction) => {
            if (!HasAuraAccess(interaction.member)) {
                return interaction.reply({ content: "❌ Booster or authorization required.", ephemeral: true });
            }

            const SelectedRoleId = interaction.values[0];
            const GuildId = interaction.guild.id;

            await RemoveAllAuras(interaction.member);
            await interaction.member.roles.add(SelectedRoleId);

            await interaction.update({
                content: `✨ Aura set to <@&${SelectedRoleId}>`,
                components: []
            });
        }
    },

    // ─────────────── COMMAND ───────────────
    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("aura")
                .setDescription("Booster aura color system")

                // ADMIN
                .addSubcommand(sc =>
                    sc.setName("setboosterrole")
                        .setDescription("Set the booster role")
                        .addRoleOption(o =>
                            o.setName("role")
                                .setDescription("Server booster role")
                                .setRequired(true)
                        )
                )
                .addSubcommand(sc =>
                    sc.setName("addaura")
                        .setDescription("Register an aura role")
                        .addRoleOption(o =>
                            o.setName("role")
                                .setDescription("Role to add as an aura")
                                .setRequired(true)
                        )
                )
                .addSubcommand(sc =>
                    sc.setName("removeaura")
                        .setDescription("Remove an aura role")
                        .addRoleOption(o =>
                            o.setName("role")
                                .setDescription("Aura role to remove")
                                .setRequired(true)
                        )
                )
                .addSubcommand(sc =>
                    sc.setName("addbypassuser")
                        .setDescription("Allow a user to bypass booster requirement")
                        .addUserOption(o =>
                            o.setName("user")
                                .setDescription("User to bypass")
                                .setRequired(true)
                        )
                )
                .addSubcommand(sc =>
                    sc.setName("addbypassrole")
                        .setDescription("Allow a role to bypass booster requirement")
                        .addRoleOption(o =>
                            o.setName("role")
                                .setDescription("Role to bypass")
                                .setRequired(true)
                        )
                )
                .addSubcommand(sc =>
                    sc.setName("give")
                        .setDescription("Give an aura to a user")
                        .addUserOption(o =>
                            o.setName("user")
                                .setDescription("Target user")
                                .setRequired(true)
                        )
                        .addRoleOption(o =>
                            o.setName("role")
                                .setDescription("Aura role to give")
                                .setRequired(true)
                        )
                )

                // USER
                .addSubcommand(sc => sc.setName("list").setDescription("List available auras"))
                .addSubcommand(sc => sc.setName("menu").setDescription("Open aura selection menu"))
                .addSubcommand(sc => sc.setName("remove").setDescription("Remove your current aura"))
                .addSubcommand(sc =>
                    sc.setName("set")
                        .setDescription("Set your aura")
                        .addRoleOption(o =>
                            o.setName("role")
                                .setDescription("Aura role to apply")
                                .setRequired(true)
                        )
                ),

            async execute(interaction) {
                const sub = interaction.options.getSubcommand();
                const guildId = interaction.guild.id;

                if (
                    ["setboosterrole", "addaura", "removeaura", "addbypassuser", "addbypassrole", "give"].includes(sub) &&
                    !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)
                ) {
                    return interaction.reply({ content: "❌ Admin permission required.", ephemeral: true });
                }

                if (sub === "setboosterrole") {
                    const role = interaction.options.getRole("role");
                    SetBoosterRole.run(guildId, role.id);
                    return interaction.reply({ content: `✅ Booster role set to ${role}`, ephemeral: true });
                }

                if (sub === "addaura") {
                    const role = interaction.options.getRole("role");
                    AddAuraRole.run(guildId, role.id);
                    return interaction.reply({ content: `🎨 Aura added: ${role}`, ephemeral: true });
                }

                if (sub === "removeaura") {
                    const role = interaction.options.getRole("role");
                    RemoveAuraRole.run(guildId, role.id);
                    return interaction.reply({ content: `🗑 Aura removed: ${role}`, ephemeral: true });
                }

                if (sub === "addbypassuser") {
                    const user = interaction.options.getUser("user");
                    AddBypassUser.run(guildId, user.id);
                    return interaction.reply({ content: `🔓 Bypass user added: ${user.tag}`, ephemeral: true });
                }

                if (sub === "addbypassrole") {
                    const role = interaction.options.getRole("role");
                    AddBypassRole.run(guildId, role.id);
                    return interaction.reply({ content: `🔓 Bypass role added: ${role}`, ephemeral: true });
                }

                if (sub === "give") {
                    const user = interaction.options.getUser("user");
                    const role = interaction.options.getRole("role");
                    const member = await interaction.guild.members.fetch(user.id);
                    await member.roles.add(role);
                    return interaction.reply({ content: `✨ ${role} given to ${user}`, ephemeral: true });
                }

                if (!HasAuraAccess(interaction.member)) {
                    return interaction.reply({ content: "❌ Booster or authorization required.", ephemeral: true });
                }

                if (sub === "list") {
                    const rows = GetAuraRoles.all(guildId);
                    if (!rows.length) {
                        return interaction.reply({ content: "📭 No auras configured.", ephemeral: true });
                    }
                    const list = rows.map(r => `<@&${r.role_id}>`).join("\n");
                    return interaction.reply({ content: `🎨 Available Auras:\n${list}`, ephemeral: true });
                }

                if (sub === "set") {
                    const role = interaction.options.getRole("role");
                    const allowed = GetAuraRoles.all(guildId).some(r => r.role_id === role.id);
                    if (!allowed) {
                        return interaction.reply({ content: "❌ That role is not an aura.", ephemeral: true });
                    }

                    await RemoveAllAuras(interaction.member);
                    await interaction.member.roles.add(role);

                    return interaction.reply({ content: `✨ Aura set to ${role}`, ephemeral: true });
                }

                if (sub === "menu") {
                    const rows = GetAuraRoles.all(guildId);
                    if (!rows.length) {
                        return interaction.reply({ content: "📭 No auras configured.", ephemeral: true });
                    }

                    const options = rows
                        .map(r => interaction.guild.roles.cache.get(r.role_id))
                        .filter(Boolean)
                        .map(role => ({ label: role.name, value: role.id }));

                    const Menu = new StringSelectMenuBuilder()
                        .setCustomId("aura_menu_select")
                        .setPlaceholder("Choose your aura…")
                        .addOptions(options);

                    return interaction.reply({
                        content: "🎨 Select your aura:",
                        components: [new ActionRowBuilder().addComponents(Menu)],
                        ephemeral: true
                    });
                }

                if (sub === "remove") {
                    await RemoveAllAuras(interaction.member);
                    return interaction.reply({ content: "🧹 Your aura has been removed.", ephemeral: true });
                }
            }
        }
    ]
};
