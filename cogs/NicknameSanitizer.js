const { Events } = require('discord.js');

function isInvalidName(name) {
  if (!name) return true;
  const stripped = name.replace(/[\p{C}\p{Z}]/gu, '');
  return stripped.length === 0;
}

function sanitizeName(name) {
  const safe = name.replace(/[^a-zA-Z0-9 _-]/g, '');
  return safe.length > 0 ? safe : 'EmptyNickname';
}

async function checkAndFix(member, reason) {
  if (!member || member.user.bot) return;

  const currentName = member.displayName;
  if (isInvalidName(currentName)) {
    const newNick = sanitizeName(member.user.username);

    try {
      await member.setNickname(newNick, `Auto-fix invalid nickname (${reason})`);
      console.log(`[NicknameSanitizer] Fixed nickname for ${member.user.tag} → ${newNick}`);
    } catch (err) {
      console.error(`[NicknameSanitizer] Failed to set nickname for ${member.user.tag}:`, err.message);
    }
  }
}

module.exports = {
  name: 'NicknameSanitizer',
  events: {
    [Events.PresenceUpdate]: async (client, oldPresence, newPresence) => {
      if (!newPresence?.guild) return;
      if (newPresence.status !== 'online') return;
      await checkAndFix(newPresence.member, 'presence update');
    },

    [Events.GuildMemberUpdate]: async (client, oldMember, newMember) => {
      if (!newMember.guild) return;
      if (oldMember.displayName !== newMember.displayName) {
        await checkAndFix(newMember, 'nickname change');
      }
    }
  },
  commands: []
};
