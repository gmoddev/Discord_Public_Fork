module.exports = {
  name: 'ReactionFilter',
  event: 'messageReactionAdd',

  onEvent: async (client, reaction, user) => {
    try {
      if (user.bot) return;

      const blockedEmojis = [
        '🫃',
        '🖕'
      ];

      const emoji = reaction.emoji.name;

      if (blockedEmojis.includes(emoji)) {
        await reaction.users.remove(user.id);
        console.log(`🚫 Removed '${emoji}' from message by ${user.tag}`);
      }
    } catch (err) {
      console.error(`[ReactionFilter] ❌ Failed to remove emoji:`, err);
    }
  }
};
