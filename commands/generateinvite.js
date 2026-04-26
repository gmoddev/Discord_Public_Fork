// commands/BotInvites.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botinvites')
    .setDescription('Attempts to generate invites for servers the bot is in (owner only)'),

  async execute(Interaction) {
    const Client = Interaction.client;
    const Results = [];

    for (const Guild of Client.guilds.cache.values()) {

      try {

        await Guild.channels.fetch();

        const Channel = Guild.channels.cache
          .filter(c => c.isTextBased())
          .find(c => c.permissionsFor(Guild.members.me).has('CreateInstantInvite'));

        if (!Channel) {
          Results.push(`❌ **${Guild.name}** - No permission`);
          continue;
        }

        const Invite = await Channel.createInvite({
          maxAge: 0,
          maxUses: 0,
          unique: false
        });

        Results.push(`✅ **${Guild.name}** → https://discord.gg/${Invite.code}`);

      } catch {
        Results.push(`❌ **${Guild.name}** - Failed`);
      }

    }

    const Chunks = [];
    const Size = 10;

    for (let i = 0; i < Results.length; i += Size) {
      Chunks.push(Results.slice(i, i + Size));
    }

    const Embed = new EmbedBuilder()
      .setTitle(`Bot Guild Invites`)
      .setDescription(Chunks[0].join('\n'))
      .setColor(0x00AE86)
      .setFooter({ text: `Total Guilds: ${Client.guilds.cache.size}` });

    await Interaction.reply({ embeds: [Embed], ephemeral: true });

  }
};