// Not a dyncommand yet
const { CanRunCommand, registerCommand } = require("../helpers/RankChecker.js");
const { ChannelType, SlashCommandBuilder } = require("discord.js");
const Database = require("better-sqlite3");
const path = require("path");

const LOG_CHANNEL_NAME = '📑┃𝖬𝗈𝖽-𝖫𝗈𝗀𝗌'; 

// Register the command this module will enforce
registerCommand("MessageBypass");
registerCommand("messages")
// Initialize the message count database
const db = new Database(path.join(__dirname, '..', 'data', 'message_counts.db'));
//
// Ensure table exists
db.prepare(`
  CREATE TABLE IF NOT EXISTS message_counts (
    user_id TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  );
`).run();

module.exports = {
  name: 'MessageSanitizer',
  event: 'messageCreate',

  

  onEvent: async (client, message) => {
    try {
      if (!message.guild || message.author.bot) return;

      const content = message.content.trim();
      
      const userId = message.author.id;
      const getStmt = db.prepare("SELECT count FROM message_counts WHERE user_id = ?");
      const row = getStmt.get(userId);

      if (row) {
        db.prepare("UPDATE message_counts SET count = count + 1 WHERE user_id = ?").run(userId);
      } else {
        db.prepare("INSERT INTO message_counts (user_id, count) VALUES (?, 1)").run(userId);
      }

      // disabled because i need to remake it to a dynamic command
      // Match if the message starts with 1–3 '#' followed by space or end
     /*

      if (/^#{1,3}(\s|$)/.test(content)) {
        if (CanRunCommand(message.member, "MessageBypass")) return;

        await message.delete();
        console.log(`🧹 Deleted message from ${message.author.tag}: "${content}"`);

        // Send log to mod channel
        const logChannel = message.guild.channels.cache.find(
          ch => ch.name === LOG_CHANNEL_NAME && ch.type === ChannelType.GuildText
        );

        if (logChannel) {
          await logChannel.send({
            content: `🧹 **Message deleted** in <#${message.channel.id}> by ${message.author.tag}:\n\`\`\`\n${content}\n\`\`\``
          });
        }
      }
     */
    } catch (err) {
      console.error(`[MessageSanitizer] ❌ Error:`, err);
    }
  },

  data: new SlashCommandBuilder()
    .setName('messages')
    .setDescription('See how many messages you have sent.'),
  
  async execute(interaction) {
    const userId = interaction.user.id;
    const row = db.prepare("SELECT count FROM message_counts WHERE user_id = ?").get(userId);
    const count = row?.count || 0;

    await interaction.reply(`📨 You have sent **${count}** message(s).`);
  }
};
