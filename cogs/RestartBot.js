const { SlashCommandBuilder } = require('discord.js');
const { registerCommand, IsOwner } = require('../helpers/RankChecker');

registerCommand('RestartBot');

module.exports = {
    name: 'RestartBot',

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName('restartbot')
                .setDescription('Restarts the bot process.'),

            async execute(Interaction) {
                if (!IsOwner(Interaction)) {
                    return Interaction.reply({
                        content: '❌ Owner Permission Required.',
                        ephemeral: true
                    });
                }

                await Interaction.reply({
                    content: '🔄 Restarting bot...',
                    ephemeral: true
                });

                console.log(`Restart requested by ${Interaction.user.tag}`);

                setTimeout(() => {
                    process.exit(0);
                }, 1000);
            }
        }
    ]
};