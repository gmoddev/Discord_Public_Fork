require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { CanRunCommand, registerCommand } = require('./helpers/RankChecker');

// ─── Target Bot To Check ─────────────────────────────────────────────────────
const TargetBotId = '443510365280534548';

// ─── Create Client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.GuildMember],
});

client.Cogs = new Collection();
client.Commands = new Collection();
client.CanTakeOverGuild = new Map(); // GuildId -> boolean

const slashCommandData = [];

// ─── Load Commands (same as before) ──────────────────────────────────────────
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const filePath = path.join(commandsPath, file);
    try {
      const command = require(filePath);
      if (!command.data || !command.execute) continue;
      client.Commands.set(command.data.name, command);
      slashCommandData.push(command.data.toJSON());
      registerCommand(command.data.name);
    } catch (err) {
      console.error(`❌ Failed to load command ${file}:`, err);
    }
  }
}

// ─── Load Cogs (same as before) ─────────────────────────────────────────────
const cogPath = path.join(__dirname, 'cogs');
for (const file of fs.readdirSync(cogPath).filter(f => f.endsWith('.js'))) {
  const filePath = path.join(cogPath, file);
  const Cog = require(filePath);

  if (Cog.events && typeof Cog.events === 'object') {
    for (const [eventName, handler] of Object.entries(Cog.events)) {
      if (typeof handler === 'function') {
        client.on(eventName, (...args) => {
          const guild = args[0]?.guild || args[0]?.guildId ? args[0].guild || args[0] : null;
          if (!guild || client.CanTakeOverGuild.get(guild.id)) {
            handler(client, ...args);
          }
        });
      }
    }
  } else if (Cog.event && Cog.onEvent) {
    client.on(Cog.event, (...args) => {
      const guild = args[0]?.guild || args[0]?.guildId ? args[0].guild || args[0] : null;
      if (!guild || client.CanTakeOverGuild.get(guild.id)) {
        Cog.onEvent(client, ...args);
      }
    });
  }

  if (Array.isArray(Cog.commands)) {
    for (const command of Cog.commands) {
      if (command.data && command.execute) {
        client.Commands.set(command.data.name, command);
        slashCommandData.push(command.data.toJSON());
        registerCommand(command.data.name);
      }
    }
  } else if (Cog.data && Cog.execute) {
    client.Commands.set(Cog.data.name, Cog);
    slashCommandData.push(Cog.data.toJSON());
    registerCommand(Cog.data.name);
  }
}

// ─── Ready & Slash Registration ─────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`🤖 Online as ${client.user.tag}`);

  // Fetch guilds and determine takeover
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const member = await guild.members.fetch(TargetBotId).catch(() => null);
      let allow = true;
      if (member && member.presence && member.presence.status !== 'offline') {
        allow = false; // target bot is in guild and online
      }
      client.CanTakeOverGuild.set(guild.id, allow);
      console.log(`Guild ${guild.name}: CanTakeOver = ${allow}`);
    } catch {
      client.CanTakeOverGuild.set(guild.id, true); // target bot not found
    }
  }

  try {
    await client.application.commands.set(slashCommandData);
    console.log(`🚀 Registered ${slashCommandData.length} slash commands`);
  } catch (err) {
    console.error('❌ Command registration failed:', err);
  }
});

// ─── Interaction Handler ─────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  const guild = interaction.guild;
  if (guild && !client.CanTakeOverGuild.get(guild.id)) return;

  if (interaction.isAutocomplete()) {
    const command = client.Commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (err) {
      console.error(`❌ Autocomplete error in '${interaction.commandName}':`, err);
    }
    return;
  }

  if (!interaction.isCommand()) return;

  const command = client.Commands.get(interaction.commandName);
  if (!command) return;

  if (!CanRunCommand(interaction, interaction.commandName)) {
    await interaction.reply({
      content: '❌ You do not have permission to use this command.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`❌ Error executing command '${interaction.commandName}':`, err);
    const replyPayload = {
      content: '⚠️ There was an error executing that command.',
      flags: MessageFlags.Ephemeral
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(replyPayload).catch(console.error);
    } else {
      await interaction.reply(replyPayload).catch(console.error);
    }
  }
});

// ─── Errors ──────────────────────────────────────────────────────────────────
client.on('error', err => console.error('Client Error:', err));
client.on('warn', info => console.warn('Client Warning:', info));
process.on('unhandledRejection', (reason, promise) => {
  console.error('❗ Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', err => {
  console.error('❗ Uncaught Exception thrown:', err);
});
process.on('uncaughtExceptionMonitor', err => {
  console.warn('Monitor caught exception:', err);
});

// ─── Login ───────────────────────────────────────────────────────────────────
console.log('🔑 Logging in...');
client.login(process.env.TOKEN)
  .then(() => console.log('🔑 Login successful'))
  .catch(err => console.error('❌ Login failed:', err));
