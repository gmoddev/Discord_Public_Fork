require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
// isAdmin: Internal command, not needed anymore // CanRunCommand: Used for checking perms // RegisterCommand: Registers command to be used with commands/commandperm.js
const {CanRunCommand, registerCommand } = require('./helpers/RankChecker'); // ✅

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

const slashCommandData = [];

// ─── Load Slash Commands ───────────────────────────────────────────────────────
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  console.log('🔍 Loading commands from:', commandsPath);
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const filePath = path.join(commandsPath, file);
    try {
      const command = require(filePath);
      if (!command.data || !command.execute) {
        console.warn(`⚠️ Skipping command ${file}: missing data or execute.`);
        continue;
      }
      client.Commands.set(command.data.name, command);
      slashCommandData.push(command.data.toJSON()); 
      registerCommand(command.data.name); 
      console.log(`✅ Loaded command: ${command.data.name}`);
    } catch (err) {
      console.error(`❌ Failed to load command ${file}:`, err);
    }
  }
} else {
  console.warn(`⚠️ Commands directory not found at ${commandsPath}`);
}

// ─── Load Cogs ─────────────────────────────────────────────────────────────────
const cogPath = path.join(__dirname, 'cogs');

for (const file of fs.readdirSync(cogPath).filter(f => f.endsWith('.js'))) {
  const filePath = path.join(cogPath, file);
  const Cog = require(filePath);

  // Multi-event support
  if (Cog.events && typeof Cog.events === 'object') {
    for (const [eventName, handler] of Object.entries(Cog.events)) {
      if (typeof handler === 'function') {
        client.on(eventName, (...args) => handler(client, ...args));
        console.log(`✅ Loaded event cog: ${Cog.name || file} → ${eventName}`);
      }
    }
  }

  // Single-event fallback (legacy support)
  else if (Cog.event && Cog.onEvent) {
    client.on(Cog.event, (...args) => Cog.onEvent(client, ...args));
    console.log(`✅ Loaded event cog: ${Cog.name || file} → ${Cog.event}`);
  }

  // Multi-command support
  if (Array.isArray(Cog.commands)) {
    for (const command of Cog.commands) {
      if (command.data && command.execute) {
        client.Commands.set(command.data.name, command);
        slashCommandData.push(command.data.toJSON());
        registerCommand(command.data.name);
        console.log(`✅ Loaded slash-command: ${command.data.name} (from ${file})`);
      }
    }
  }

  // Single-command fallback (legacy support)
  else if (Cog.data && Cog.execute) {
    client.Commands.set(Cog.data.name, Cog);
    slashCommandData.push(Cog.data.toJSON());
    registerCommand(Cog.data.name);
    console.log(`✅ Loaded slash-command cog: ${Cog.data.name}`);
  }
}


// ─── Ready & Slash Registration ──────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`🤖 Online as ${client.user.tag}`);
  try {
    await client.application.commands.set(slashCommandData);
    console.log(`🚀 Registered ${slashCommandData.length} slash commands`);
  } catch (err) {
    console.error('❌ Command registration failed:', err);
  }
});

// ─── Interaction Handler ─────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
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


// ─── Global Discord.js Client Error/Warning ─────────────────────────────────
client.on('error', err => console.error('Client Error:', err));
client.on('warn', info => console.warn('Client Warning:', info));

// ─── Process-Level Safety Nets ────────────────────────────────────────────────
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
