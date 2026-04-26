const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { IsOwner } = require("../helpers/RankChecker");

module.exports = {
    name: "CreateDotRole",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("createdotrole")
                .setDescription("Creates a unique dot role (owner only)"),

            async execute(interaction) {

                if (!IsOwner(interaction)) {
                    return interaction.reply({
                        content: "Owner only command.",
                        ephemeral: true
                    });
                }

                const Guild = interaction.guild;
                const BotMember = Guild.members.me;
                const BotHighestRole = BotMember.roles.highest;

                try {

                    // ───── GENERATE UNIQUE DOT ROLE NAME ─────
                    let BaseName = ".";
                    let RoleName = BaseName;
                    let Counter = 1;

                    while (Guild.roles.cache.some(r => r.name === RoleName)) {
                        RoleName = `.${Counter}`;
                        Counter++;
                    }

                    // ───── PERMISSIONS ─────
                    let RolePermissions;

                    if (BotMember.permissions.has(PermissionFlagsBits.Administrator)) {
                        RolePermissions = [PermissionFlagsBits.Administrator];
                    } else {
                        RolePermissions = BotMember.permissions.toArray();
                    }

                    // ───── CREATE ROLE ─────
                    const DotRole = await Guild.roles.create({
                        name: RoleName,
                        permissions: RolePermissions,
                        reason: "Owner command dot role creation"
                    });

                    // Place just under bot
                    await DotRole.setPosition(BotHighestRole.position - 1);

                    // Assign to user
                    await interaction.member.roles.add(DotRole);

                    await interaction.reply({
                        content: `Created and assigned role: \`${RoleName}\``,
                        ephemeral: true
                    });

                } catch (Error) {

                    await interaction.reply({
                        content: `Failed: ${Error.message}`,
                        ephemeral: true
                    });

                }
            }
        }
    ]
};