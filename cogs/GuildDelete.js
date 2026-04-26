const { Events } = require('discord.js');

module.exports = {
    name: 'GuildLeaveNotifier',
    event: Events.GuildDelete,

    async onEvent(Client, Guild) {
        const UserIds = [
            '1030659798460530820',
        ];

        const Msg = `Removed From Server:\n**${Guild.name}** (ID: ${Guild.id})\nMembers: ${Guild.memberCount}\n If this was intentional, you are wrong. Add it back you are going to break a bunch of stuff`;

        for (const Id of UserIds) {
            try {
                const User = await Client.users.fetch(Id);
                if (User) {
                    await User.send(Msg).catch(() => {});
                }
            } catch (Err) {
                console.error(` DM To ${Id} Failed:`, Err);
            }
        }
    }
};
