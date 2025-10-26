// Discord Private Welcome Bot (discord.js v14)
import 'dotenv/config';
import {
  Client, GatewayIntentBits, ChannelType,
  PermissionFlagsBits, Partials
} from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

const settings = {}; // per-guild, simple in-memory

const getGuildSettings = (gid) =>
  (settings[gid] ??= { trustedRoleId: null, categoryId: null, deleteOnLeave: true });

client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

const findExistingMemberChannel = (guild, memberId) =>
  guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText &&
      typeof ch.topic === 'string' &&
      ch.topic.includes(`UID:${memberId}`)
  );

async function ensureCategory(guild, categoryId) {
  if (categoryId) {
    const c = guild.channels.cache.get(categoryId);
    if (c?.type === ChannelType.GuildCategory) return c;
  }
  const byName = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && /welcome|intake|onboard/i.test(c.name)
  );
  if (byName) return byName;
  return guild.channels.create({ name: '👋 welcome-chats', type: ChannelType.GuildCategory });
}

async function createPrivateChannelFor(member) {
  const guild = member.guild;
  const gset = getGuildSettings(guild.id);
  const category = await ensureCategory(guild, gset.categoryId);

  const existing = findExistingMemberChannel(guild, member.id);
  if (existing) return existing;

  const channelName = `welcome-${member.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 90);
  const topic = `Private welcome for ${member.user.tag} | UID:${member.id}`;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: member.id, allow: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks
    ]},
    { id: client.user.id, allow: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageMessages
    ]},
  ];
  if (gset.trustedRoleId) {
    overwrites.push({
      id: gset.trustedRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks
      ],
    });
  }

  const ch = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,
    topic,
    permissionOverwrites: overwrites,
  });

  await ch.send(`Welcome <@${member.id}>! This private channel is just for you and our trusted team. 🎉`);
  return ch;
}

client.on('guildMemberAdd', (m) => createPrivateChannelFor(m).catch(console.error));
client.on('guildMemberRemove', async (m) => {
  try {
    const gset = getGuildSettings(m.guild.id);
    if (!gset.deleteOnLeave) return;
    const ch = findExistingMemberChannel(m.guild, m.id);
    if (ch) await ch.delete('Member left; cleanup');
  } catch (e) { console.error(e); }
});

// Simple admin commands (!)
const PREFIX = '!';
const hasManageServer = (member) =>
  member.permissions.has(PermissionFlagsBits.ManageGuild) ||
  member.permissions.has(PermissionFlagsBits.Administrator);

client.on('messageCreate', async (msg) => {
  if (!msg.guild || msg.author.bot || !msg.content.startsWith(PREFIX)) return;
  if (!hasManageServer(msg.member)) return;

  const [cmd, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const gset = getGuildSettings(msg.guild.id);

  if (cmd === 'help') {
    return msg.reply([
      '**Commands:**',
      '`!settrusted @Role` — who can see all private channels',
      '`!setcategory #Category` — parent category for new channels',
      '`!deleteonleave on|off` — auto-delete when member leaves',
      '`!spawnfor @User` — create/find a private channel manually',
      '`!showconfig` — show current settings',
    ].join('\n'));
  }

  if (cmd === 'settrusted') {
    const role = msg.mentions.roles.first() || (args[0] ? msg.guild.roles.cache.get(args[0]) : null);
    if (!role) return msg.reply('Mention a role or provide a role ID.');
    gset.trustedRoleId = role.id;
    return msg.reply(`Trusted role set to **${role.name}**.`);
  }

  if (cmd === 'setcategory') {
    const cat = msg.mentions.channels.first() || (args[0] ? msg.guild.channels.cache.get(args[0]) : null);
    if (!cat || cat.type !== ChannelType.GuildCategory) return msg.reply('Mention a **category** or provide a category ID.');
    gset.categoryId = cat.id;
    return msg.reply(`Category set to **${cat.name}**.`);
  }

  if (cmd === 'deleteonleave') {
    const val = String(args[0] || '').toLowerCase();
    if (!['on','off','true','false','yes','no'].includes(val)) return msg.reply('Use: !deleteonleave on|off');
    gset.deleteOnLeave = ['on','true','yes'].includes(val);
    return msg.reply(`Delete-on-leave is now **${gset.deleteOnLeave ? 'ON' : 'OFF'}**.`);
  }

  if (cmd === 'spawnfor') {
    const user = msg.mentions.users.first();
    if (!user) return msg.reply('Mention a user.');
    const member = await msg.guild.members.fetch(user.id).catch(() => null);
    if (!member) return msg.reply('User is not in this server.');
    const ch = await createPrivateChannelFor(member);
    return msg.reply(`Channel ready: <#${ch.id}>`);
  }

  if (cmd === 'showconfig') {
    const role = gset.trustedRoleId ? msg.guild.roles.cache.get(gset.trustedRoleId) : null;
    const cat = gset.categoryId ? msg.guild.channels.cache.get(gset.categoryId) : null;
    return msg.reply(
      `Trusted role: ${role ? role.name : 'not set'}\n` +
      `Category: ${cat ? cat.name : 'auto (will create/find)'}\n` +
      `Delete on leave: ${gset.deleteOnLeave !== false ? 'ON' : 'OFF'}`
    );
  }
});

client.login(process.env.TOKEN);
