const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require('discord.js');

const fs = require('fs');
require('dotenv').config();

const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = '1348347939474374786';
const LOG_CHANNEL_ID = '1574910439111008286';

const BL_FILE = './blacklist.json';
const RESTORE_FILE = './restore_pending.json';

const LOG_COLOR = 0x5865F2; // Bleu Discord de base

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.User],
});

const spamMap = new Map();
const SPAM_LIMIT = 5;
const SPAM_WINDOW = 5000;
const giveaways = new Map();

// =====================================
// FICHIERS
// =====================================

function loadBL() {
  try { return JSON.parse(fs.readFileSync(BL_FILE, 'utf8')); }
  catch { return {}; }
}
function saveBL(data) { fs.writeFileSync(BL_FILE, JSON.stringify(data, null, 2)); }
function loadRestore() {
  try { return JSON.parse(fs.readFileSync(RESTORE_FILE, 'utf8')); }
  catch { return {}; }
}
function saveRestore(data) { fs.writeFileSync(RESTORE_FILE, JSON.stringify(data, null, 2)); }

// =====================================
// LOGS DES COMMANDES
// =====================================

async function sendCommandLog(interaction, extraFields = []) {
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return null;

    const details = interaction.options.data.map(option => {
      let value = option.value;
      if (option.type === 6) value = `<@${option.value}>`;
      if (option.name === 'duree' && value) {
        const labels = {
          60: '60 secondes', 300: '5 minutes', 600: '10 minutes',
          1800: '30 minutes', 3600: '1 heure', 21600: '6 heures',
          43200: '12 heures', 86400: '1 jour', 604800: '1 semaine',
        };
        value = labels[parseInt(value)] || `${value} secondes`;
      }
      return { name: option.name.charAt(0).toUpperCase() + option.name.slice(1), value: String(value), inline: true };
    });

    const embed = new EmbedBuilder()
      .setTitle(`${interaction.commandName} utilisé`)
      .setColor(LOG_COLOR)
      .addFields(
        { name: 'Auteur', value: `<@${interaction.user.id}>`, inline: true },
        ...details,
        ...extraFields,
      )
      .setTimestamp();

    const msg = await channel.send({ embeds: [embed] });
    return msg;

  } catch (error) {
    console.error('Erreur logs commandes :', error);
    return null;
  }
}

// =====================================
// LOGS DES MESSAGES SUPPRIMES (embed)
// =====================================

client.on('messageDelete', async message => {
  if (!message.guild) return;
  if (message.author?.bot) return;

  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    const author = message.author ? `<@${message.author.id}>` : 'Utilisateur inconnu';
    let content = message.partial ? 'Contenu indisponible' : (message.content || 'Contenu indisponible');
    if (content.length > 1024) content = content.slice(0, 1021) + '...';

    const embed = new EmbedBuilder()
      .setTitle('Message supprimé')
      .setColor(LOG_COLOR)
      .addFields(
        { name: 'Auteur', value: author, inline: true },
        { name: 'Salon', value: `<#${message.channelId}>`, inline: true },
        { name: 'Message', value: content },
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });

  } catch (error) {
    console.error('Erreur logs suppression :', error);
  }
});

// Suppression en masse (/clear) — répond au log clear
client.on('messageDeleteBulk', async messages => {
  if (messages.size === 0) return;
  const firstMessage = messages.first();
  if (!firstMessage.guild) return;

  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!logChannel || !logChannel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(`${messages.size} messages supprimés en masse`)
      .setColor(LOG_COLOR)
      .addFields({ name: 'Salon', value: `<#${firstMessage.channelId}>`, inline: true })
      .setTimestamp();

    // Trouver le dernier log "clear utilisé" pour y répondre
    const logs = await logChannel.messages.fetch({ limit: 10 });
    const clearLog = logs.find(m =>
      m.author.id === client.user.id &&
      m.embeds[0]?.title?.includes('clear')
    );

    if (clearLog) {
      await clearLog.reply({ embeds: [embed] });
    } else {
      await logChannel.send({ embeds: [embed] });
    }

  } catch (error) {
    console.error('Erreur logs bulk delete :', error);
  }
});

// =====================================
// COMMANDES
// =====================================

const commands = [
  {
    name: 'clear',
    description: 'Supprime des messages dans ce salon',
    options: [{ name: 'nombre', description: 'Nombre de messages (1-100)', type: 4, required: true }],
  },
  { name: 'lock', description: 'Verrouille le salon' },
  { name: 'unlock', description: 'Deverrouille le salon' },
  {
    name: 'to',
    description: 'Exclure temporairement un membre',
    options: [
      { name: 'membre', description: 'Membre a exclure', type: 6, required: true },
      {
        name: 'duree', description: 'Duree', type: 3, required: true,
        choices: [
          { name: '60 secondes', value: '60' }, { name: '5 minutes', value: '300' },
          { name: '10 minutes', value: '600' }, { name: '1 heure', value: '3600' },
          { name: '1 jour', value: '86400' }, { name: '1 semaine', value: '604800' },
        ],
      },
      { name: 'raison', description: 'Raison', type: 3, required: false },
    ],
  },
  {
    name: 'giveaway',
    description: 'Lancer un giveaway',
    options: [
      { name: 'prix', description: 'Prix du giveaway', type: 3, required: true },
      {
        name: 'duree', description: 'Duree', type: 3, required: true,
        choices: [
          { name: '1 minute', value: '60' }, { name: '5 minutes', value: '300' },
          { name: '10 minutes', value: '600' }, { name: '30 minutes', value: '1800' },
          { name: '1 heure', value: '3600' }, { name: '6 heures', value: '21600' },
          { name: '12 heures', value: '43200' }, { name: '1 jour', value: '86400' },
        ],
      },
    ],
  },
  {
    name: 'dmall',
    description: 'Envoie un DM a tous les membres',
    options: [
      { name: 'message', description: 'Contenu du DM', type: 3, required: true },
      {
        name: 'ping', description: 'Mentionner le membre ?', type: 3, required: true,
        choices: [{ name: 'Oui', value: 'oui' }, { name: 'Non', value: 'non' }],
      },
    ],
  },
  { name: 'renew', description: "Recree ce salon a l'identique" },
  {
    name: 'bl',
    description: 'Blacklist et ban un membre du serveur',
    options: [
      { name: 'membre', description: 'Membre a blacklist', type: 6, required: true },
      { name: 'raison', description: 'Raison', type: 3, required: false },
    ],
  },
  {
    name: 'restaurer',
    description: 'Retire un utilisateur de la blacklist',
    options: [{ name: 'userid', description: "ID de l'utilisateur a restaurer", type: 3, required: true }],
  },
];

// =====================================
// READY
// =====================================

client.once('ready', async () => {
  console.log(`Connecte : ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Commandes enregistrees.');
  } catch (error) { console.error(error); }
});

// =====================================
// INTERACTIONS
// =====================================

client.on('interactionCreate', async interaction => {

  // ===================================
  // BOUTON GIVEAWAY
  // ===================================

  if (interaction.isButton() && interaction.customId === 'giveaway_join') {
    const gw = giveaways.get(interaction.message.id);
    if (!gw) return interaction.reply({ content: 'Ce giveaway est terminé.', ephemeral: true });
    if (gw.participants.has(interaction.user.id)) return interaction.reply({ content: 'Tu participes déjà !', ephemeral: true });
    gw.participants.add(interaction.user.id);
    await updateGiveawayMessage(interaction.message, gw);
    return interaction.reply({ content: 'Tu participes au giveaway !', ephemeral: true });
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.user.id !== OWNER_ID) return;

  const commandName = interaction.commandName;
  const executor = interaction.user;

  // ===================================
  // /CLEAR
  // ===================================

  if (commandName === 'clear') {
    await interaction.deferReply({ ephemeral: true });

    // Log AVANT la suppression pour y répondre ensuite via messageDeleteBulk
    await sendCommandLog(interaction);

    const nombre = Math.min(Math.max(interaction.options.getInteger('nombre'), 1), 100);
    let totalDeleted = 0;

    try {
      const deleted = await interaction.channel.bulkDelete(nombre, true);
      totalDeleted = deleted.size;
    } catch (error) { console.error(error); }

    await interaction.deleteReply().catch(() => {});

    const confirmation = await interaction.channel.send({
      content: `**${totalDeleted}** message(s) supprimé(s) par ${executor}.`,
    });
    setTimeout(() => confirmation.delete().catch(() => {}), 3000);
    return;
  }

  // /renew gère ses propres logs (besoin du nom de l'ancien salon)
  if (commandName !== 'renew') {
    await sendCommandLog(interaction);
  }

  // ===================================
  // /LOCK
  // ===================================

  if (commandName === 'lock') {
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: false, AddReactions: false,
        SendMessagesInThreads: false, CreatePublicThreads: false,
        CreatePrivateThreads: false, UseApplicationCommands: false,
      });
      await interaction.reply({ content: `Ce salon a été **fermé** par ${executor}.` });
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: 'Permission insuffisante.' });
    }
  }

  // ===================================
  // /UNLOCK
  // ===================================

  if (commandName === 'unlock') {
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: true, AddReactions: true,
        SendMessagesInThreads: true, CreatePublicThreads: true,
        CreatePrivateThreads: true, UseApplicationCommands: true,
      });
      await interaction.reply({ content: `Ce salon a été **ouvert** par ${executor}.` });
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: 'Permission insuffisante.' });
    }
  }

  // ===================================
  // /TO
  // ===================================

  if (commandName === 'to') {
    const member = interaction.options.getMember('membre');
    const seconds = parseInt(interaction.options.getString('duree'));
    const raison = interaction.options.getString('raison') || null;
    const labels = { 60: '60 secondes', 300: '5 minutes', 600: '10 minutes', 3600: '1 heure', 86400: '1 jour', 604800: '1 semaine' };

    try {
      if (!member) return interaction.reply({ content: 'Membre introuvable.' });
      await member.timeout(seconds * 1000, raison || 'Aucune raison');
      const txt = raison
        ? `${member} a été **TO** ${labels[seconds] || seconds + 's'} par ${executor} *(${raison})*`
        : `${member} a été **TO** ${labels[seconds] || seconds + 's'} par ${executor}`;
      await interaction.reply({ content: txt });
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: 'Impossible de timeout ce membre.' });
    }
  }

  // ===================================
  // /GIVEAWAY
  // ===================================

  if (commandName === 'giveaway') {
    const prix = interaction.options.getString('prix');
    const seconds = parseInt(interaction.options.getString('duree'));
    const endTime = Date.now() + seconds * 1000;

    const btn = new ButtonBuilder().setCustomId('giveaway_join').setLabel('Participer').setEmoji('🎉').setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(btn);

    const embed = new EmbedBuilder()
      .setTitle('🎊 GIVEAWAY')
      .setDescription(`**Prix :** ${prix}\n**Fin :** <t:${Math.floor(endTime / 1000)}:R>\n**Participants :** 0`)
      .setColor(0x2b2d31);

    await interaction.reply({ embeds: [embed], components: [row] });
    const msg = await interaction.fetchReply();
    giveaways.set(msg.id, { channelId: interaction.channel.id, prize: prix, endTime, participants: new Set() });
    setTimeout(() => endGiveaway(msg.id, interaction.guild), seconds * 1000);
  }

  // ===================================
  // /DMALL
  // ===================================

  if (commandName === 'dmall') {
    await interaction.deferReply();
    const message = interaction.options.getString('message');
    const ping = interaction.options.getString('ping') === 'oui';

    // Affiche "Envoi en cours..." en éditant la réponse initiale
    await interaction.editReply({ content: 'Envoi en cours...' });

    let members;
    try { members = await interaction.guild.members.fetch(); }
    catch (error) { console.error(error); return; }

    const targets = members.filter(m => !m.user.bot);
    let sent = 0, failed = 0;

    for (const [, member] of targets) {
      try { await member.send({ content: ping ? `${member} ${message}` : message }); sent++; }
      catch { failed++; }
      await sleep(1100);
    }

    // Modifie le même message au lieu d'en envoyer un nouveau
    await interaction.editReply({ content: `Envoyés : **${sent}** | Échecs : **${failed}**` });
  }

  // ===================================
  // /BL
  // ===================================

  if (commandName === 'bl') {
    await interaction.deferReply();

    const member = interaction.options.getMember('membre');
    const raison = interaction.options.getString('raison') || 'Aucune raison';

    if (!member) return interaction.editReply({ content: 'Membre introuvable.' });

    const roles = member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.id);
    const bl = loadBL();
    bl[member.id] = { roles, tag: member.user.tag };
    saveBL(bl);

    try { await member.send(`Vous avez été blacklist du serveur **${interaction.guild.name}**.`); } catch {}

    try {
      await member.ban({ reason: raison });
      await interaction.editReply({ content: `${member} a été blacklist et banni par ${executor}.` });
    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: `Impossible de bannir ce membre : ${error.message}` });
    }
  }

  // ===================================
  // /RESTAURER
  // ===================================

  if (commandName === 'restaurer') {
    await interaction.deferReply();

    const userId = interaction.options.getString('userid').trim();
    const bl = loadBL();

    if (!bl[userId]) return interaction.editReply({ content: "Cet utilisateur n'est pas dans la blacklist." });

    try { await interaction.guild.members.unban(userId, `Restauré par ${executor.username}`); }
    catch (error) { console.error('Unban:', error.message); }

    const entry = bl[userId];
    delete bl[userId];
    saveBL(bl);

    const pending = loadRestore();
    pending[userId] = { roles: entry.roles, tag: entry.tag };
    saveRestore(pending);

    await interaction.editReply({
      content: `**${entry.tag}** a été retiré de la blacklist par ${executor}. Ses rôles seront restaurés automatiquement à son retour sur le serveur.`,
    });
  }

  // ===================================
  // /RENEW
  // ===================================

  if (commandName === 'renew') {
    await interaction.deferReply();

    const ch = interaction.channel;
    const oldChannelName = ch.name;

    try {
      const name = ch.name;
      const topic = ch.topic || null;
      const nsfw = ch.nsfw;
      const position = ch.position;
      const rateLimitPerUser = ch.rateLimitPerUser;
      const parent = ch.parent;

      const permOverwrites = ch.permissionOverwrites.cache.map(ow => ({
        id: ow.id, type: ow.type, allow: ow.allow, deny: ow.deny,
      }));

      // Log avec le nom de l'ancien salon AVANT suppression
      const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (logChannel && logChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('renew utilisé')
          .setColor(LOG_COLOR)
          .addFields(
            { name: 'Auteur', value: `<@${executor.id}>`, inline: true },
            { name: 'Salon recréé', value: `#${oldChannelName}`, inline: true },
          )
          .setTimestamp();
        await logChannel.send({ embeds: [embed] });
      }

      await ch.delete('renew command');

      const newChannel = await interaction.guild.channels.create({
        name, type: ch.type, topic, nsfw, rateLimitPerUser,
        parent, permissionOverwrites: permOverwrites, reason: 'renew command',
      });

      await newChannel.setPosition(position).catch(() => {});
      await newChannel.send(`Ce salon a été **recréé** par ${executor}.`);

    } catch (error) {
      console.error(error);
      try { await interaction.followUp({ content: `Erreur : ${error.message}` }); } catch {}
    }
  }
});

// =====================================
// MISE A JOUR GIVEAWAY
// =====================================

async function updateGiveawayMessage(message, gw) {
  const embed = new EmbedBuilder()
    .setTitle('🎊 GIVEAWAY')
    .setDescription(`**Prix :** ${gw.prize}\n**Fin :** <t:${Math.floor(gw.endTime / 1000)}:R>\n**Participants :** ${gw.participants.size}`)
    .setColor(0x2b2d31);
  await message.edit({ embeds: [embed] }).catch(() => {});
}

// =====================================
// FIN GIVEAWAY
// =====================================

async function endGiveaway(messageId, guild) {
  const gw = giveaways.get(messageId);
  if (!gw) return;

  const channel = guild.channels.cache.get(gw.channelId);
  if (!channel) return;

  const participants = [...gw.participants];
  giveaways.delete(messageId);

  let msgObj;
  try { msgObj = await channel.messages.fetch(messageId); } catch { return; }

  const disabledBtn = new ButtonBuilder()
    .setCustomId('giveaway_join').setLabel('Participer').setStyle(ButtonStyle.Secondary).setDisabled(true);
  const row = new ActionRowBuilder().addComponents(disabledBtn);

  if (participants.length === 0) {
    const embedFin = new EmbedBuilder()
      .setTitle('🎊 GIVEAWAY')
      .setDescription(`**Prix :** ${gw.prize}\n**Résultat :** Aucun participant.`)
      .setColor(0x2b2d31);
    await msgObj.edit({ embeds: [embedFin], components: [row] }).catch(() => {});
    return;
  }

  const winnerId = participants[Math.floor(Math.random() * participants.length)];

  const embedFin = new EmbedBuilder()
    .setTitle('🎊 GIVEAWAY')
    .setDescription(`**Prix :** ${gw.prize}\n**Gagnant :** <@${winnerId}>\n**Participants :** ${participants.length}`)
    .setColor(0x2b2d31);

  await msgObj.edit({ embeds: [embedFin], components: [row] }).catch(() => {});
  await channel.send(`Félicitations <@${winnerId}> ! Tu remportes **${gw.prize}** !`);
}

// =====================================
// ARRIVEE MEMBRE
// =====================================

client.on('guildMemberAdd', async member => {
  const bl = loadBL();

  if (bl[member.id]) {
    try { await member.send(`Vous avez été blacklist du serveur **${member.guild.name}**.`); } catch {}
    await member.ban({ reason: 'Blacklist toujours active' }).catch(() => {});
    return;
  }

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

// =====================================
// ANTI-SPAM
// =====================================

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

// =====================================
// SLEEP
// =====================================

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// =====================================
// CONNEXION
// =====================================

client.login(process.env.TOKEN);
