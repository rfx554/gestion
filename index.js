const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
  EmbedBuilder, PermissionsBitField,
} = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const GUILD_ID = process.env.GUILD_ID;
const BL_FILE  = './blacklist.json'; // { userId: { roles: [roleId, ...] } }

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel],
});

const spamMap    = new Map();
const SPAM_LIMIT  = 5;
const SPAM_WINDOW = 5000;
const giveaways  = new Map();

// --- Blacklist helpers ---
function loadBL() {
  try { return JSON.parse(fs.readFileSync(BL_FILE, 'utf8')); } catch { return {}; }
}
function saveBL(data) {
  fs.writeFileSync(BL_FILE, JSON.stringify(data, null, 2));
}

const commands = [
  {
    name: 'clear',
    description: 'Supprime des messages dans ce salon',
    default_member_permissions: '8',
    options: [{ name: 'nombre', description: 'Nombre de messages (1-100)', type: 4, required: true }],
  },
  { name: 'lock',   description: 'Verrouille le salon',   default_member_permissions: '8' },
  { name: 'unlock', description: 'Deverrouille le salon', default_member_permissions: '8' },
  {
    name: 'to',
    description: 'Exclure temporairement un membre',
    default_member_permissions: '8',
    options: [
      { name: 'membre', description: 'Membre a exclure', type: 6, required: true },
      {
        name: 'duree', description: 'Duree', type: 3, required: true,
        choices: [
          { name: '60 secondes', value: '60' },
          { name: '5 minutes',   value: '300' },
          { name: '10 minutes',  value: '600' },
          { name: '1 heure',     value: '3600' },
          { name: '1 jour',      value: '86400' },
          { name: '1 semaine',   value: '604800' },
        ],
      },
      { name: 'raison', description: 'Raison', type: 3, required: false },
    ],
  },
  {
    name: 'giveaway',
    description: 'Lancer un giveaway',
    default_member_permissions: '8',
    options: [
      { name: 'prix', description: 'Prix du giveaway', type: 3, required: true },
      {
        name: 'duree', description: 'Duree', type: 3, required: true,
        choices: [
          { name: '1 minute',   value: '60' },
          { name: '5 minutes',  value: '300' },
          { name: '10 minutes', value: '600' },
          { name: '30 minutes', value: '1800' },
          { name: '1 heure',    value: '3600' },
          { name: '6 heures',   value: '21600' },
          { name: '12 heures',  value: '43200' },
          { name: '1 jour',     value: '86400' },
        ],
      },
    ],
  },
  {
    name: 'dmall',
    description: 'Envoie un DM a tous les membres',
    default_member_permissions: '8',
    options: [
      { name: 'message', description: 'Contenu du DM', type: 3, required: true },
      {
        name: 'ping', description: 'Mentionner le membre ?', type: 3, required: true,
        choices: [{ name: 'Oui', value: 'oui' }, { name: 'Non', value: 'non' }],
      },
    ],
  },
  { name: 'renew', description: "Recree ce salon a l'identique", default_member_permissions: '8' },
  {
    name: 'bl',
    description: 'Blacklist et ban un membre du serveur',
    default_member_permissions: '8',
    options: [
      { name: 'membre', description: 'Membre a blacklist', type: 6, required: true },
      { name: 'raison', description: 'Raison', type: 3, required: false },
    ],
  },
  {
    name: 'restaurer',
    description: 'Retire un utilisateur de la blacklist et restaure ses roles a son retour',
    default_member_permissions: '8',
    options: [
      { name: 'userid', description: 'ID de l\'utilisateur a restaurer', type: 3, required: true },
    ],
  },
];

client.once('ready', async () => {
  console.log(`Connecte : ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: [] });
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Commandes enregistrees.');
  } catch (e) { console.error(e); }
});

client.on('interactionCreate', async interaction => {

  // Bouton participer au giveaway
  if (interaction.isButton() && interaction.customId === 'giveaway_join') {
    const gw = giveaways.get(interaction.message.id);
    if (!gw) return interaction.reply({ content: 'Ce giveaway est termine.', ephemeral: true });
    if (gw.participants.has(interaction.user.id))
      return interaction.reply({ content: 'Tu participes deja !', ephemeral: true });
    gw.participants.add(interaction.user.id);
    await updateGiveawayMessage(interaction.message, gw);
    return interaction.reply({ content: 'Tu participes au giveaway !', ephemeral: true });
  }

  if (!interaction.isChatInputCommand()) return;
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) return;

  const { commandName } = interaction;
  const executor = interaction.user;

  // /clear
  if (commandName === 'clear') {
    await interaction.deferReply({ ephemeral: true });
    const nombre = Math.min(Math.max(interaction.options.getInteger('nombre'), 1), 100);
    let totalDeleted = 0;
    try {
      // bulkDelete avec filterOld:true gere automatiquement les messages >14j
      const deleted = await interaction.channel.bulkDelete(nombre, true);
      totalDeleted = deleted.size;
    } catch (e) { console.error(e); }
    await interaction.editReply({
      content: `**${totalDeleted}** message(s) supprime(s) par ${executor}.`,
    });
  }

  // /lock
  if (commandName === 'lock') {
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: false, AddReactions: false,
        SendMessagesInThreads: false, CreatePublicThreads: false,
        CreatePrivateThreads: false, UseApplicationCommands: false,
      });
      await interaction.reply({
        content: `Ce salon a ete **ferme** par **${executor.username}**.`,
      });
    } catch (e) {
      console.error(e);
      await interaction.reply({ content: 'Permission insuffisante.', ephemeral: true });
    }
  }

  // /unlock
  if (commandName === 'unlock') {
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: true, AddReactions: true,
        SendMessagesInThreads: true, CreatePublicThreads: true,
        CreatePrivateThreads: true, UseApplicationCommands: true,
      });
      await interaction.reply({
        content: `Ce salon a ete **ouvert** par **${executor.username}**.`,
      });
    } catch (e) {
      console.error(e);
      await interaction.reply({ content: 'Permission insuffisante.', ephemeral: true });
    }
  }

  // /to
  if (commandName === 'to') {
    const member  = interaction.options.getMember('membre');
    const seconds = parseInt(interaction.options.getString('duree'));
    const raison  = interaction.options.getString('raison') || null;
    const labels  = { 60:'60 secondes', 300:'5 minutes', 600:'10 minutes', 3600:'1 heure', 86400:'1 jour', 604800:'1 semaine' };
    try {
      await member.timeout(seconds * 1000, raison || 'Aucune raison');
      const txt = raison
        ? `${member} a ete **TO** ${labels[seconds] || seconds + 's'} par ${executor} *(${raison})*`
        : `${member} a ete **TO** ${labels[seconds] || seconds + 's'} par ${executor}`;
      await interaction.reply({ content: txt });
    } catch (e) {
      console.error(e);
      await interaction.reply({ content: 'Impossible de timeout ce membre.', ephemeral: true });
    }
  }

  // /giveaway
  if (commandName === 'giveaway') {
    const prix    = interaction.options.getString('prix');
    const seconds = parseInt(interaction.options.getString('duree'));
    const endTime = Date.now() + seconds * 1000;

    const btn = new ButtonBuilder()
      .setCustomId('giveaway_join')
      .setLabel('Participer')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(btn);

    const embed = new EmbedBuilder()
      .setTitle('🎊 GIVEAWAY')
      .setDescription(
        `**Prix :** ${prix}\n` +
        `**Fin :** <t:${Math.floor(endTime / 1000)}:R>\n` +
        `**Participants :** 0`
      )
      .setColor(0x2b2d31);

    await interaction.reply({
      embeds: [embed],
      components: [row],
    });

    const msg = await interaction.fetchReply();
    giveaways.set(msg.id, {
      channelId: interaction.channel.id,
      prize: prix,
      endTime,
      participants: new Set(),
    });
    setTimeout(() => endGiveaway(msg.id, interaction.guild), seconds * 1000);
  }

  // /dmall
  if (commandName === 'dmall') {
    await interaction.deferReply({ ephemeral: true });
    const message = interaction.options.getString('message');
    const ping    = interaction.options.getString('ping') === 'oui';
    await interaction.editReply({ content: 'Envoi en cours...' });

    let members;
    try { members = await interaction.guild.members.fetch(); } catch (e) { console.error(e); return; }

    const targets = members.filter(m => !m.user.bot);
    let sent = 0, failed = 0;
    for (const [, member] of targets) {
      try {
        await member.send({ content: ping ? `${member} ${message}` : message });
        sent++;
      } catch { failed++; }
      await sleep(1100);
    }
    await interaction.followUp({ content: `Envoyes : **${sent}** | Echecs : **${failed}**`, ephemeral: true });
  }

  // /bl
  if (commandName === 'bl') {
    await interaction.deferReply({ ephemeral: true });
    const member = interaction.options.getMember('membre');
    const raison = interaction.options.getString('raison') || 'Aucune raison';

    if (!member) {
      return interaction.editReply({ content: 'Membre introuvable.' });
    }

    // Sauvegarder les roles (sauf @everyone)
    const roles = member.roles.cache
      .filter(r => r.id !== interaction.guild.id)
      .map(r => r.id);

    const bl = loadBL();
    bl[member.id] = { roles, tag: member.user.tag };
    saveBL(bl);

    // Envoyer le DM avant le ban
    try {
      await member.send(`Vous avez ete blacklist du serveur **${interaction.guild.name}**.`);
    } catch {}

    // Ban
    try {
      await member.ban({ reason: raison });
      await interaction.editReply({
        content: `**${member.user.tag}** a ete blacklist et banni par **${executor.username}**.`,
      });
    } catch (e) {
      console.error(e);
      await interaction.editReply({ content: `Impossible de bannir ce membre : ${e.message}` });
    }
  }

  // /restaurer
  if (commandName === 'restaurer') {
    await interaction.deferReply({ ephemeral: true });
    const userId = interaction.options.getString('userid').trim();
    const bl = loadBL();

    if (!bl[userId]) {
      return interaction.editReply({ content: 'Cet utilisateur n\'est pas dans la blacklist.' });
    }

    // Unban
    try {
      await interaction.guild.members.unban(userId, `Restaure par ${executor.username}`);
    } catch (e) {
      // Peut etre deja unban manuellement, on continue quand meme
      console.error('Unban:', e.message);
    }

    const entry = bl[userId];
    delete bl[userId];
    saveBL(bl);

    // Mettre les roles en attente de restauration
    const pending = loadRestore();
    pending[userId] = { roles: entry.roles, tag: entry.tag };
    saveRestore(pending);

    await interaction.editReply({
      content: `**${entry.tag}** a ete retire de la blacklist par **${executor.username}**. Ses roles seront restaures automatiquement a son retour sur le serveur.`,
    });
  }

  // /renew
  if (commandName === 'renew') {
    await interaction.deferReply({ ephemeral: true });
    const ch = interaction.channel;
    try {
      const name = ch.name, topic = ch.topic || null, nsfw = ch.nsfw;
      const position = ch.position, rateLimitPerUser = ch.rateLimitPerUser, parent = ch.parent;
      const permOverwrites = ch.permissionOverwrites.cache.map(ow => ({
        id: ow.id, type: ow.type, allow: ow.allow, deny: ow.deny,
      }));
      await ch.delete('renew command');
      const newChannel = await interaction.guild.channels.create({
        name, type: ch.type, topic, nsfw, rateLimitPerUser, parent,
        permissionOverwrites: permOverwrites, reason: 'renew command',
      });
      await newChannel.setPosition(position).catch(() => {});
      await newChannel.send(`Ce salon a ete **recree** par ${executor}.`);
    } catch (e) {
      console.error(e);
      try { await interaction.followUp({ content: `Erreur : ${e.message}`, ephemeral: true }); } catch {}
    }
  }
});

// Mise a jour de l'embed giveaway en cours
async function updateGiveawayMessage(message, gw) {
  const embed = new EmbedBuilder()
    .setTitle('🎊 GIVEAWAY')
    .setDescription(
      `**Prix :** ${gw.prize}\n` +
      `**Fin :** <t:${Math.floor(gw.endTime / 1000)}:R>\n` +
      `**Participants :** ${gw.participants.size}`
    )
    .setColor(0x2b2d31);
  await message.edit({ embeds: [embed] }).catch(() => {});
}

// Fin du giveaway : tirage au sort + annonce
async function endGiveaway(messageId, guild) {
  const gw = giveaways.get(messageId);
  if (!gw) return;
  const channel = guild.channels.cache.get(gw.channelId);
  if (!channel) return;
  const participants = [...gw.participants];
  giveaways.delete(messageId);

  let msgObj;
  try { msgObj = await channel.messages.fetch(messageId); } catch { return; }

  // Desactiver le bouton
  const disabledBtn = new ButtonBuilder()
    .setCustomId('giveaway_join')
    .setLabel('Participer')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);
  const row = new ActionRowBuilder().addComponents(disabledBtn);

  if (participants.length === 0) {
    const embedFin = new EmbedBuilder()
      .setTitle('🎊 GIVEAWAY')
      .setDescription(
        `**Prix :** ${gw.prize}\n` +
        `**Resultat :** Aucun participant.`
      )
      .setColor(0x2b2d31);
    await msgObj.edit({ embeds: [embedFin], components: [row] }).catch(() => {});
    return;
  }

  const winnerId = participants[Math.floor(Math.random() * participants.length)];

  const embedFin = new EmbedBuilder()
    .setTitle('🎊 GIVEAWAY')
    .setDescription(
      `**Prix :** ${gw.prize}\n` +
      `**Gagnant :** <@${winnerId}>\n` +
      `**Participants :** ${participants.length}`
    )
    .setColor(0x2b2d31);

  await msgObj.edit({ embeds: [embedFin], components: [row] }).catch(() => {});

  // Message d'annonce separe
  await channel.send(`Felicitations <@${winnerId}> ! Tu remportes **${gw.prize}** !`);
}

const RESTORE_FILE = './restore_pending.json';

function loadRestore() {
  try { return JSON.parse(fs.readFileSync(RESTORE_FILE, 'utf8')); } catch { return {}; }
}
function saveRestore(data) {
  fs.writeFileSync(RESTORE_FILE, JSON.stringify(data, null, 2));
}

client.on('guildMemberAdd', async member => {
  const bl = loadBL();

  // Toujours blacklist : re-ban immediatement
  if (bl[member.id]) {
    try { await member.send(`Vous avez ete blacklist du serveur **${member.guild.name}**.`); } catch {}
    await member.ban({ reason: 'Blacklist toujours active' }).catch(() => {});
    return;
  }

  // Restauration en attente : redonner les roles
  const pending = loadRestore();
  if (!pending[member.id]) return;

  const roleIds = pending[member.id].roles;
  delete pending[member.id];
  saveRestore(pending);

  for (const roleId of roleIds) {
    const role = member.guild.roles.cache.get(roleId);
    if (role) await member.roles.add(role).catch(() => {});
  }
});

// Anti-spam
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  const now = Date.now();
  const prev = (spamMap.get(message.author.id) || []).filter(t => now - t < SPAM_WINDOW);
  prev.push(now);
  spamMap.set(message.author.id, prev);
  if (prev.length >= SPAM_LIMIT) {
    spamMap.set(message.author.id, []);
    try {
      const warn = await message.channel.send(`${message.author} Tu envoies des messages trop rapidement.`);
      setTimeout(() => warn.delete().catch(() => {}), 4000);
    } catch {}
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

client.login(process.env.TOKEN);
