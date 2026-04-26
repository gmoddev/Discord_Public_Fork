

require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, MessageFlags, Events, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { CanRunCommand, registerCommand } = require('./helpers/RankChecker');

// ──────────────────────────────────────────────────────────────────────────────
// Environment Validation
// ──────────────────────────────────────────────────────────────────────────────
function AssertEnv(...Keys) {
  const Missing = Keys.filter(k => !process.env[k]);
  if (Missing.length) {
    console.error(`❌ Missing env vars: ${Missing.join(', ')}`);
    process.exit(1);
  }
}
AssertEnv('TOKEN');

// ──────────────────────────────────────────────────────────────────────────────
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
client.ComponentHandlers = new Map(); 

let slashCommandData = [];
let LastDeployedHash = null;

// ──────────────────────────────────────────────────────────────────────────────
// Utility: Safe Require + Validation
// ──────────────────────────────────────────────────────────────────────────────
function SafeRequire(FilePath) {
  delete require.cache[require.resolve(FilePath)];
  return require(FilePath);
}

function ValidateCog(Cog, FileName) {
  if (!Cog || typeof Cog !== 'object') throw new Error(`Invalid export from ${FileName}`);
  if (Cog.name && typeof Cog.name !== 'string') throw new Error(`Cog ${FileName} has non-string name`);
  if (Cog.events && typeof Cog.events !== 'object') throw new Error(`Cog ${FileName} invalid events map`);
  if (Cog.event && typeof Cog.onEvent !== 'function') throw new Error(`Cog ${FileName} legacy event missing onEvent`);
  if (Cog.commands && !Array.isArray(Cog.commands)) throw new Error(`Cog ${FileName} commands must be an array`);
  if (Cog.components && typeof Cog.components !== 'object') throw new Error(`Cog ${FileName} invalid components map`);
}

function ValidateCommand(Mod, FileName) {
  if (!Mod || typeof Mod !== 'object') throw new Error(`Invalid command export from ${FileName}`);
  if (!Mod.data || !Mod.execute) throw new Error(`Command ${FileName} missing data or execute`);
}

// ──────────────────────────────────────────────────────────────────────────────
const CogRegistry = new Map();      // filePath -> { listeners: [], commands: [], components: [] }
const CommandRegistry = new Map();  // filePath -> commandName

function AssertIntent(EventName) {
  const Missing = (Name, Intent) => console.warn(`⚠️ Event '${Name}' may require missing intent: ${Intent}`);
  switch (EventName) {
    case 'messageCreate':
      if (!client.options.intents.has(GatewayIntentBits.GuildMessages)) Missing('messageCreate','GuildMessages');
      break;
    case 'guildMemberAdd':
      if (!client.options.intents.has(GatewayIntentBits.GuildMembers)) Missing('guildMemberAdd','GuildMembers');
      break;
    case 'presenceUpdate':
      if (!client.options.intents.has(GatewayIntentBits.GuildPresences)) Missing('presenceUpdate','GuildPresences');
      break;
  }
}

function RegisterEvent(CogName, EventName, Spec, Registry) {
  AssertIntent(EventName);
  const Handler = typeof Spec === 'function' ? Spec : Spec.handler;
  const Once = typeof Spec === 'object' && !!Spec.once;
  if (typeof Handler !== 'function') return;

  const Wrapped = (...Args) => Handler(client, ...Args);
  (Once ? client.once.bind(client) : client.on.bind(client))(EventName, Wrapped);

  Registry.listeners.push({ event: EventName, fn: Wrapped });
  console.log(`✅ Loaded event cog: ${CogName} → ${EventName}${Once ? ' (once)' : ''}`);
}

function UnregisterCog(FilePath) {
  const Reg = CogRegistry.get(FilePath);
  if (!Reg) return;
  for (const { event, fn } of Reg.listeners) client.removeListener(event, fn);
  for (const name of Reg.commands) client.Commands.delete(name);
  for (const id of Reg.components) client.ComponentHandlers.delete(id);
  CogRegistry.delete(FilePath);
}

function LoadCogFile(FilePath, FileName) {
  const Reg = { listeners: [], commands: [], components: [] };
  const Cog = SafeRequire(FilePath);
  ValidateCog(Cog, FileName);
  const CogName = Cog.name || FileName;

  // Multi-event
  if (Cog.events && typeof Cog.events === 'object') {
    for (const [eventName, handler] of Object.entries(Cog.events)) {
      RegisterEvent(CogName, eventName, handler, Reg);
    }
  }
  // Single-event (legacy)
  else if (Cog.event && Cog.onEvent) {
    RegisterEvent(CogName, Cog.event, { handler: Cog.onEvent }, Reg);
  }

  // Multi-command
  if (Array.isArray(Cog.commands)) {
    for (const command of Cog.commands) {
      if (command.data && command.execute) {
        const name = command.data.name;
        console.log("Registering command", name)
        if (client.Commands.has(name)) console.warn(`⚠️ Overwriting command: ${name}`);
        client.Commands.set(name, command);
        slashCommandData.push(command.data.toJSON());
        registerCommand(name);
        Reg.commands.push(name);
        console.log(`✅ Loaded slash-command: ${name} (from ${FileName})`);
      }
    }
  }
  // Single-command (legacy)
  else if (Cog.data && Cog.execute) {
    const name = Cog.data.name;
    console.log("Registering command", name)
    if (client.Commands.has(name)) console.warn(`⚠️ Overwriting command: ${name}`);
    client.Commands.set(name, Cog);
    slashCommandData.push(Cog.data.toJSON());
    registerCommand(name);
    Reg.commands.push(name);
    console.log(`✅ Loaded slash-command cog: ${name}`);
  }

  // Components/Modals
  if (Cog.components && typeof Cog.components === 'object') {
    for (const [Id, Fn] of Object.entries(Cog.components)) {
      if (typeof Fn !== 'function') continue;
      if (client.ComponentHandlers.has(Id)) console.warn(`⚠️ Overwriting component id: ${Id}`);
      client.ComponentHandlers.set(Id, Fn);
      Reg.components.push(Id);
      console.log(`✅ Component handler: ${CogName} → ${Id}`);
    }
  }

  CogRegistry.set(FilePath, Reg);
}

// Commands loader with hot-reload registry tracking
function UnregisterCommand(FilePath) {
  const Name = CommandRegistry.get(FilePath);
  if (!Name) return;
  client.Commands.delete(Name);
  CommandRegistry.delete(FilePath);
}

function LoadCommandFile(FilePath, FileName) {
  const Cmd = SafeRequire(FilePath);
  ValidateCommand(Cmd, FileName);
  const name = Cmd.data.name;
  if (client.Commands.has(name)) console.warn(`⚠️ Overwriting command: ${name}`);
  client.Commands.set(name, Cmd);
  slashCommandData.push(Cmd.data.toJSON());
  registerCommand(name);
  CommandRegistry.set(FilePath, name);
  console.log(`✅ Loaded command: ${name}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Hot Reloaders
// ──────────────────────────────────────────────────────────────────────────────
function StartHotReload(DirPath, LoaderFn, UnloaderFn, Filter = f => f.endsWith('.js')) {
  if (!fs.existsSync(DirPath)) return;
  fs.watch(DirPath, { persistent: true }, (EventType, FileName) => {
    if (!FileName || !Filter(FileName)) return;
    const FilePath = path.join(DirPath, FileName);
    try {
      UnloaderFn(FilePath);
      LoaderFn(FilePath, FileName);
      console.log(`♻️ Reloaded: ${FileName}`);
    } catch (Err) {
      console.error(`❌ Hot-reload failed for ${FileName}:`, Err);
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Hash-Based Slash Deployment
// ──────────────────────────────────────────────────────────────────────────────
function HashCommands(JsonArray) {
  const Sorted = [...JsonArray].sort((a, b) => (a.name > b.name ? 1 : -1));
  return crypto.createHash('sha256').update(JSON.stringify(Sorted)).digest('hex');
}

// ──────────────────────────────────────────────────────────────────────────────
// Safe Reply Helper (Uses MessageFlags.Ephemeral As Requested)
// ──────────────────────────────────────────────────────────────────────────────
async function SafeReply(Interaction, Options) {
  const Payload = { ...Options };
  // Force ephemeral via flags bit (1 << 6) using MessageFlags.Ephemeral
  if (!('flags' in Payload)) Payload.flags = MessageFlags.Ephemeral;
  try {
    if (Interaction.deferred || Interaction.replied) {
      return await Interaction.followUp(Payload);
    }
    return await Interaction.reply(Payload);
  } catch {
    // No-op
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Cooldowns + Guards
// ──────────────────────────────────────────────────────────────────────────────
const Cooldowns = new Map(); // commandName -> Map(userId, ts)
const DefaultCooldownMs = 3000;

function CheckCooldown(UserId, CommandName, Ms = DefaultCooldownMs) {
  if (!Cooldowns.has(CommandName)) Cooldowns.set(CommandName, new Map());
  const M = Cooldowns.get(CommandName);
  const Now = Date.now();
  const Last = M.get(UserId) || 0;
  if (Now - Last < Ms) return Ms - (Now - Last);
  M.set(UserId, Now);
  return 0;
}

async function RunGuards(Interaction, CommandName) {
  if (!CanRunCommand(Interaction, CommandName)) {
    await SafeReply(Interaction, { content: '❌ You do not have permission to use this command.' });
    return false;
  }
  const Wait = CheckCooldown(Interaction.user.id, CommandName);
  if (Wait > 0) {
    await SafeReply(Interaction, { content: `⏳ Slow down. Try again in ${(Wait / 1000).toFixed(1)}s.` });
    return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Initial Load: Commands
// ──────────────────────────────────────────────────────────────────────────────
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  console.log('🔍 Loading commands from:', commandsPath);
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const filePath = path.join(commandsPath, file);
    try {
      LoadCommandFile(filePath, file);
    } catch (err) {
      console.error(`❌ Failed to load command ${file}:`, err);
    }
  }
  StartHotReload(commandsPath, LoadCommandFile, UnregisterCommand);
} else {
  console.warn(`⚠️ Commands directory not found at ${commandsPath}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Initial Load: Cogs
// ──────────────────────────────────────────────────────────────────────────────
const cogPath = path.join(__dirname, 'cogs');

if (fs.existsSync(cogPath)) {
  const CogFiles = fs.readdirSync(cogPath)
    .filter(File => File.endsWith('.js'))
    .map(File => {
      const FilePath = path.join(cogPath, File);

      let Priority = 1000;

      try {
        const PreviewCog = SafeRequire(FilePath);

        if (
          PreviewCog &&
          typeof PreviewCog === 'object' &&
          typeof PreviewCog.priority === 'number'
        ) {
          Priority = PreviewCog.priority;
        }
      } catch (Err) {
        console.error(`❌ Failed reading priority for ${File}:`, Err);
      }

      return {
        File,
        FilePath,
        Priority
      };
    })
    .sort((A, B) => A.Priority - B.Priority);

  for (const Entry of CogFiles) {
    try {
      console.log(
        `📦 Loading cog ${Entry.File} (priority: ${Entry.Priority})`
      );

      LoadCogFile(Entry.FilePath, Entry.File);
    } catch (Err) {
      console.error(`❌ Failed to load cog ${Entry.File}:`, Err);
    }
  }

  StartHotReload(cogPath, LoadCogFile, UnregisterCog);
} else {
  console.warn(`⚠️ Cogs directory not found at ${cogPath}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Ready & Slash Registration (Hash-Gated)
// ──────────────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`🤖 Online as ${client.user.tag}`);
  try {
    //slashCommandData = [];

    const Hash = HashCommands(slashCommandData);
    if (Hash !== LastDeployedHash) {
      await client.application.commands.set(slashCommandData);
      LastDeployedHash = Hash;
      console.log(`🚀 Registered ${slashCommandData.length} slash commands (hash ${Hash.slice(0, 8)}…)`);
    } else {
      console.log('✔️ Slash commands unchanged. Skipping registration.');
    }
  } catch (err) {
    console.error('❌ Command registration failed:', err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Central Interaction Router (Commands, Autocomplete, Components, Modals)
// ──────────────────────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      const command = client.Commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      await command.autocomplete(interaction);
      return;
    }

    if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
      const Fn = client.ComponentHandlers.get(interaction.customId);
      if (!Fn) return;
      try {
        await Fn(client, interaction);
      } catch (Err) {
        console.error('❌ Component error:', Err);
        await SafeReply(interaction, { content: '⚠️ Error handling component.' });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.Commands.get(interaction.commandName);
    if (!command) return;

    if (!(await RunGuards(interaction, interaction.commandName))) return;

    const Started = performance.now();
    try {
      await command.execute(interaction);
    } catch (Err) {
      console.error(`❌ Error executing command '${interaction.commandName}':`, Err);
      await SafeReply(interaction, { content: '⚠️ There was an error executing that command.' });
    } finally {
      const Ms = Math.round(performance.now() - Started);
      console.log(`🧭 ${interaction.commandName} took ${Ms}ms`);
    }
  } catch (OuterErr) {
    console.error('❌ Interaction pipeline error:', OuterErr);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Global Discord.js Client Error/Warning
// ──────────────────────────────────────────────────────────────────────────────
client.on('error', err => console.error('Client Error:', err));
client.on('warn', info => console.warn('Client Warning:', info));

// ──────────────────────────────────────────────────────────────────────────────
// Process-Level Safety Nets
// ──────────────────────────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('❗ Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', err => {
  console.error('❗ Uncaught Exception thrown:', err);
});
process.on('uncaughtExceptionMonitor', err => {
  console.warn('Monitor caught exception:', err);
});

// ──────────────────────────────────────────────────────────────────────────────
async function Shutdown() {
  console.log('🛑 Shutting down…');
  // Unregister everything so hot-reload state is clean on next boot
  for (const [fp] of CogRegistry) UnregisterCog(fp);
  for (const [fp] of CommandRegistry) UnregisterCommand(fp);
  await client.destroy();
  process.exit(0);
}
process.on('SIGINT', Shutdown);
process.on('SIGTERM', Shutdown);

// ──────────────────────────────────────────────────────────────────────────────
// Login
// ──────────────────────────────────────────────────────────────────────────────
console.log('🔑 Logging in…');
client.login(process.env.TOKEN)
  .then(() => console.log('🔑 Login successful'))
  .catch(err => console.error('❌ Login failed:', err));
