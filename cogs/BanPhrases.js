const { Events, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const Database = require('better-sqlite3');
const Path = require('path');
const { registerCommand } = require('../helpers/RankChecker');

// Register Commands
registerCommand('AddBanPhrase');
registerCommand('RemoveBanPhrase');
registerCommand('ListBanPhrases');

const Db = new Database(Path.join(__dirname, '..', 'data', 'ban_phrases.db'));
Db.prepare(`
CREATE TABLE IF NOT EXISTS ban_phrases (
    guild_id TEXT,
    phrase TEXT,
    max_delete INTEGER DEFAULT 100,
    PRIMARY KEY (guild_id, phrase)
);
`).run();

const InsertPhrase = Db.prepare(`INSERT OR REPLACE INTO ban_phrases (guild_id, phrase, max_delete) VALUES (?, ?, ?)`);
const DeletePhrase = Db.prepare(`DELETE FROM ban_phrases WHERE guild_id = ? AND phrase = ?`);
const GetPhrases = Db.prepare(`SELECT * FROM ban_phrases WHERE guild_id = ?`);

module.exports = {
    name: 'BanPhrase',
    event: Events.MessageCreate,

    async onEvent(Client, Message) {
        if (!Message.guild || Message.author.bot) return;

        const Records = GetPhrases.all(Message.guild.id);
        if (Records.length === 0) return;

        for (const Record of Records) {
            if (Message.content.toLowerCase().includes(Record.phrase.toLowerCase())) {
                try {
                    // Fetch and delete messages from this user
                    const MaxDelete = Math.min(Record.max_delete, 100); // Discord API max per fetch
                    const Messages = await Message.channel.messages.fetch({ limit: MaxDelete }).catch(() => new Map());

                    const UserMessages = Messages.filter(m => m.author.id === Message.author.id);
                    for (const Msg of UserMessages.values()) {
                        await Msg.delete().catch(() => {});
                    }

                    // Ban user
                    await Message.member.ban({
                        reason: `Triggered banned phrase: ${Record.phrase}`,
                        deleteMessageSeconds: 604800 // Delete 7 days of messages
                    });

                    console.log(`[BanPhrase] Banned ${Message.author.tag} for phrase "${Record.phrase}"`);
                } catch (Err) {
                    console.error(`[BanPhrase] Failed:`, Err);
                }
                return; // Stop after first match
            }
        }
    },

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName('addbanphrase')
                .setDescription('Add or update a banned phrase.')
                .addStringOption(opt => opt.setName('phrase').setDescription('Phrase to ban for').setRequired(true))
                .addIntegerOption(opt => opt.setName('maxdelete').setDescription('Max messages to delete (default 100)')),
            async execute(Interaction) {
                if (!Interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return Interaction.reply({ content: '❌ Administrator Permission Required.', ephemeral: true });
                }
                const Phrase = Interaction.options.getString('phrase');
                const MaxDelete = Interaction.options.getInteger('maxdelete') ?? 100;

                InsertPhrase.run(Interaction.guildId, Phrase, MaxDelete);
                await Interaction.reply(`✅ Added banned phrase \`${Phrase}\` (delete up to ${MaxDelete} messages).`);
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName('removebanphrase')
                .setDescription('Remove a banned phrase.')
                .addStringOption(opt => opt.setName('phrase').setDescription('Phrase to remove').setRequired(true)),
            async execute(Interaction) {
                if (!Interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return Interaction.reply({ content: '❌ Administrator Permission Required.', ephemeral: true });
                }
                const Phrase = Interaction.options.getString('phrase');
                DeletePhrase.run(Interaction.guildId, Phrase);
                await Interaction.reply(`🚫 Removed banned phrase \`${Phrase}\`.`);
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName('listbanphrases')
                .setDescription('List all banned phrases.'),
            async execute(Interaction) {
                const Records = GetPhrases.all(Interaction.guildId);
                if (Records.length === 0) {
                    return Interaction.reply({ content: 'ℹ️ No banned phrases set.', ephemeral: true });
                }

                const List = Records.map(r => `\`${r.phrase}\` (Max Delete: ${r.max_delete})`).join('\n');
                await Interaction.reply({ content: `**Banned Phrases:**\n${List}`, ephemeral: true });
            }
        }
    ]
};
