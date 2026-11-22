const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
  AttachmentBuilder, PermissionsBitField,
} = require('discord.js');
const path = require('path');
require('dotenv').config();

// ─── Images So La Lune par commande ─────────────────────────────────────────
// Mets les fichiers PNG dans un dossier "images/" à côté de index.js
const IMG_DIR = path.join(__dirname, 'images');
function slmAttachment(cmd) {
  return new AttachmentBuilder(path.join(IMG_DIR, `${cmd}.png`), { name: `${cmd}.png` });
}

// Couleurs embeds (gris sombre style Offshore)
const COLOR_MAIN    = 0x2B2D31;
const COLOR_SUCCESS = 0x3A3D42;
const COLOR_END     = 0x1E2024;

const GUILD_ID = process.env.GUILD_ID;

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

// ─── Helper embed So La Lune ────────────────────────────────────────────────
function slmEmbed(title, description, cmd, color = COLOR_MAIN) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setImage(`attachment://${cmd}.png`)
    .setFooter({ text: 'So La Lune — Offshore' });
}

const commands = [
  {
    name: 'clear',
    description: 'Supprime des messages dans ce salon',
    default_member_permissions: '8',
    options: [{ name: 'nombre', description: 'Nombre de messages (1-100)', type: 4, required: true }],
  },
  {
    name: 'lock',
    description: 'Verrouille le salon',
    default_member_permissions: '8',
  },
  {
    name: 'unlock',
    description: 'Déverrouille le salon',
    default_member_permissions: '8',
  },
  {
    name: 'to',
    description: 'Exclure temporairement un membre',
    default_member_permissions: '8',
    options: [
      { name: 'membre', description: 'Membre à exclure', type: 6, required: true },
      {
        name: 'duree', description: 'Durée', type: 3, required: true,
        choices: [
          { name: '60 secondes', value: '60' },
          { name: '5 minutes',   value: '300' },
          { name: '10 minutes',  value: '600' },
          { name: '1 heure',     value: '3600' },
          { name: '1 jour',      value: '86400' },
          { name: '1 semaine',   value: '604800' },
        ],
      },
      { name: 'raison', description: 'Raison (logs uniquement)', type: 3, required: false },
    ],
  },
  {
    name: 'giveaway',
    description: 'Lancer un giveaway 🎉',
    default_member_permissions: '8',
    options: [
      { name: 'prix', description: 'Prix du giveaway', type: 3, required: true },
      {
        name: 'duree', description: 'Durée', type: 3, required: true,
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
    description: 'Envoie un DM embed a tous les membres',
    default_member_permissions: '8',
    options: [
      { name: 'message', description: 'Contenu du DM', type: 3, required: true },
      {
        name: 'ping', description: 'Mentionner le membre ?', type: 3, required: true,
        choices: [
          { name: 'Oui', value: 'oui' },
          { name: 'Non', value: 'non' },
        ],
      },
    ],
  },
  {
    name: 'renew',
    description: "Recrée ce salon à l'identique (positions, permissions, topic...)",
    default_member_permissions: '8',
  },
];

client.once('ready', async () => {
  console.log(`Connecte : ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
    console.log('Commandes globales supprimees.');
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: [] });
    console.log('Commandes guild supprimees.');
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Commandes guild enregistrees.');
  } catch (e) { console.error(e); }
});

client.on('interactionCreate', async interaction => {

  // ─── Bouton giveaway ────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'giveaway_join') {
    const gw = giveaways.get(interaction.message.id);
    if (!gw) return interaction.reply({ content: 'Ce giveaway est terminé.', ephemeral: true });
    if (gw.participants.has(interaction.user.id))
      return interaction.reply({ content: 'Tu participes déjà ! 🎉', ephemeral: true });
    gw.participants.add(interaction.user.id);
    await updateGiveawayEmbed(interaction.message, gw);
    return interaction.reply({ content: '🎉 Tu participes au giveaway !', ephemeral: true });
  }

  if (!interaction.isChatInputCommand()) return;
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) return;

  const { commandName } = interaction;

  // ─── /clear ─────────────────────────────────────────────────────────────
  if (commandName === 'clear') {
    await interaction.deferReply({ ephemeral: false });
    const nombre = Math.min(Math.max(interaction.options.getInteger('nombre'), 1), 100);
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    let totalDeleted = 0;
    try {
      const fetched = await interaction.channel.messages.fetch({ limit: nombre });
      const recent  = fetched.filter(m => m.createdTimestamp > twoWeeksAgo);
      const old     = fetched.filter(m => m.createdTimestamp <= twoWeeksAgo);
      if (recent.size > 0) {
        const deleted = await interaction.channel.bulkDelete(recent, true);
        totalDeleted += deleted.size;
      }
      for (const msg of old.values()) {
        await msg.delete().catch(() => {});
        totalDeleted++;
      }
    } catch (e) { console.error(e); }

    const att = slmAttachment('clear');
    await interaction.editReply({
      files: [att],
      embeds: [slmEmbed('🗑️ Clear', `**${totalDeleted}** message(s) supprimé(s) dans <#${interaction.channel.id}>.`, 'clear')],
    });
  }

  // ─── /lock ───────────────────────────────────────────────────────────────
  if (commandName === 'lock') {
    await interaction.deferReply({ ephemeral: false });
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: false, AddReactions: false,
        SendMessagesInThreads: false, CreatePublicThreads: false,
        CreatePrivateThreads: false, UseApplicationCommands: false,
      });
      const att = slmAttachment('lock');
      await interaction.editReply({
        files: [att],
        embeds: [slmEmbed('🔒 Salon verrouillé', `<#${interaction.channel.id}> est maintenant fermé.`, 'lock')],
      });
    } catch (e) {
      console.error(e);
      const att = slmAttachment('lock');
      await interaction.editReply({ files: [att], embeds: [slmEmbed('❌ Erreur', 'Permission insuffisante.', 'lock')] });
    }
  }

  // ─── /unlock ─────────────────────────────────────────────────────────────
  if (commandName === 'unlock') {
    await interaction.deferReply({ ephemeral: false });
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: true, AddReactions: true,
        SendMessagesInThreads: true, CreatePublicThreads: true,
        CreatePrivateThreads: true, UseApplicationCommands: true,
      });
      const att = slmAttachment('unlock');
      await interaction.editReply({
        files: [att],
        embeds: [slmEmbed('🔓 Salon déverrouillé', `<#${interaction.channel.id}> est maintenant ouvert.`, 'unlock')],
      });
    } catch (e) {
      console.error(e);
      const att = slmAttachment('unlock');
      await interaction.editReply({ files: [att], embeds: [slmEmbed('❌ Erreur', 'Permission insuffisante.', 'unlock')] });
    }
  }

  // ─── /to ─────────────────────────────────────────────────────────────────
  if (commandName === 'to') {
    await interaction.deferReply({ ephemeral: false });
    const member  = interaction.options.getMember('membre');
    const seconds = parseInt(interaction.options.getString('duree'));
    const raison  = interaction.options.getString('raison') || 'Aucune raison';
    const labels  = { 60:'60 secondes', 300:'5 minutes', 600:'10 minutes', 3600:'1 heure', 86400:'1 jour', 604800:'1 semaine' };
    try {
      await member.timeout(seconds * 1000, raison);
      const att = slmAttachment('to');
      await interaction.editReply({
        files: [att],
        embeds: [slmEmbed(
          '⏱️ Timeout',
          `${member} a été exclu temporairement pendant **${labels[seconds] || seconds + 's'}**.\n> Raison : ${raison}`,
          'to',
        )],
      });
    } catch (e) {
      console.error(e);
      const att = slmAttachment('to');
      await interaction.editReply({ files: [att], embeds: [slmEmbed('❌ Erreur', 'Impossible de timeout ce membre.', 'to')] });
    }
  }

  // ─── /giveaway ───────────────────────────────────────────────────────────
  if (commandName === 'giveaway') {
    await interaction.deferReply({ ephemeral: false });
    const prix    = interaction.options.getString('prix');
    const seconds = parseInt(interaction.options.getString('duree'));
    const endTime = Date.now() + seconds * 1000;

    const btn = new ButtonBuilder()
      .setCustomId('giveaway_join')
      .setLabel('🎉 Participer')
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(btn);

    const confirmAtt = slmAttachment('giveaway');
    await interaction.editReply({
      files: [confirmAtt],
      embeds: [slmEmbed('🎉 Giveaway lancé !', `Le giveaway pour **${prix}** vient de démarrer.`, 'giveaway')],
    });

    // Message principal du giveaway
    const gwAtt = slmAttachment('giveaway');
    const msg = await interaction.channel.send({
      files: [gwAtt],
      embeds: [buildGiveawayEmbed(prix, endTime, 0)],
      components: [row],
    });

    giveaways.set(msg.id, { channelId: interaction.channel.id, prize: prix, endTime, participants: new Set() });
    setTimeout(() => endGiveaway(msg.id, interaction.guild), seconds * 1000);
  }

  // ─── /dmall ──────────────────────────────────────────────────────────────
  if (commandName === 'dmall') {
    await interaction.deferReply({ ephemeral: true });
    const message = interaction.options.getString('message');
    const ping    = interaction.options.getString('ping') === 'oui';

    const previewAtt = slmAttachment('dmall');
    await interaction.editReply({
      files: [previewAtt],
      embeds: [slmEmbed('📨 DM — Aperçu', `**Ping :** ${ping ? 'Oui' : 'Non'}\n\n${message}\n\n*Envoi en cours...*`, 'dmall')],
    });

    let members;
    try { members = await interaction.guild.members.fetch(); } catch (e) { console.error(e); return; }

    const targets = members.filter(m => !m.user.bot);
    let sent = 0, failed = 0;

    for (const [, member] of targets) {
      try {
        const dmAtt = slmAttachment('dmall');
        await member.send({
          content: ping ? `${member}` : undefined,
          files: [dmAtt],
          embeds: [slmEmbed('📨 Message', message, 'dmall')],
        });
        sent++;
      } catch { failed++; }
      await sleep(1100);
    }

    const doneAtt = slmAttachment('dmall');
    await interaction.followUp({
      files: [doneAtt],
      embeds: [slmEmbed('✅ Terminé', `**Envoyés :** ${sent}\n**Échecs :** ${failed}`, 'dmall')],
      ephemeral: true,
    });
  }

  // ─── /renew ──────────────────────────────────────────────────────────────
  if (commandName === 'renew') {
    await interaction.deferReply({ ephemeral: true });
    const ch = interaction.channel;

    try {
      const name       = ch.name;
      const topic      = ch.topic || null;
      const nsfw       = ch.nsfw;
      const position   = ch.position;
      const rateLimitPerUser = ch.rateLimitPerUser;
      const parent     = ch.parent;
      const permOverwrites = ch.permissionOverwrites.cache.map(ow => ({
        id: ow.id, type: ow.type, allow: ow.allow, deny: ow.deny,
      }));

      await ch.delete('renew command');

      const newChannel = await interaction.guild.channels.create({
        name, type: ch.type, topic, nsfw, rateLimitPerUser, parent,
        permissionOverwrites: permOverwrites,
        reason: 'renew command',
      });

      await newChannel.setPosition(position).catch(() => {});

      const att = slmAttachment('renew');
      await newChannel.send({
        files: [att],
        embeds: [slmEmbed('♻️ Salon recréé', `Ce salon a été recréé à l'identique.`, 'renew')],
      });
    } catch (e) {
      console.error(e);
      try {
        const att = slmAttachment('renew');
        await interaction.followUp({
          files: [att],
          embeds: [slmEmbed('❌ Erreur', `Impossible de recréer le salon : ${e.message}`, 'renew')],
          ephemeral: true,
        });
      } catch {}
    }
  }
});

// ─── Giveaway helpers ────────────────────────────────────────────────────────
function buildGiveawayEmbed(prize, endTime, count) {
  return new EmbedBuilder()
    .setColor(COLOR_MAIN)
    .setTitle('🎉 GIVEAWAY')
    .setDescription(
      `**Prix :** ${prize}\n**Fin :** <t:${Math.floor(endTime / 1000)}:R>\n\n**Participants :** ${count}`,
    )
    .setImage('attachment://giveaway.png')
    .setFooter({ text: 'So La Lune — Offshore' });
}

async function updateGiveawayEmbed(message, gw) {
  // On ne peut pas re-upload un attachment sur un edit, on garde juste le texte à jour
  const embed = new EmbedBuilder()
    .setColor(COLOR_MAIN)
    .setTitle('🎉 GIVEAWAY')
    .setDescription(
      `**Prix :** ${gw.prize}\n**Fin :** <t:${Math.floor(gw.endTime / 1000)}:R>\n\n**Participants :** ${gw.participants.size}`,
    )
    .setFooter({ text: 'So La Lune — Offshore' });
  await message.edit({ embeds: [embed] }).catch(() => {});
}

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
    .setCustomId('giveaway_join')
    .setLabel('🎉 Participer')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);
  const row = new ActionRowBuilder().addComponents(disabledBtn);

  if (participants.length === 0) {
    await msgObj.edit({
      embeds: [new EmbedBuilder()
        .setColor(COLOR_END)
        .setTitle('🎉 GIVEAWAY TERMINÉ')
        .setDescription(`**Prix :** ${gw.prize}\n\n*Aucun participant.*`)
        .setFooter({ text: 'So La Lune — Offshore' })],
      components: [row],
    }).catch(() => {});
    return;
  }

  const winnerId = participants[Math.floor(Math.random() * participants.length)];
  await msgObj.edit({
    embeds: [new EmbedBuilder()
      .setColor(COLOR_SUCCESS)
      .setTitle('🎉 GIVEAWAY TERMINÉ')
      .setDescription(`**Prix :** ${gw.prize}\n**Gagnant :** <@${winnerId}>\n\n**Participants :** ${participants.length}`)
      .setFooter({ text: 'So La Lune — Offshore' })],
    components: [row],
  }).catch(() => {});
  await channel.send(`🎉 Félicitations <@${winnerId}> ! Tu remportes **${gw.prize}** !`);
}

// ─── Anti-spam (s'applique à TOUT le monde) ──────────────────────────────────
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const now  = Date.now();
  const prev = (spamMap.get(message.author.id) || []).filter(t => now - t < SPAM_WINDOW);
  prev.push(now);
  spamMap.set(message.author.id, prev);

  if (prev.length >= SPAM_LIMIT) {
    spamMap.set(message.author.id, []);
    try {
      const warn = await message.channel.send({
        embeds: [new EmbedBuilder()
          .setColor(COLOR_MAIN)
          .setDescription(`${message.author} ✋ Tu envoies des messages trop rapidement.`)
          .setFooter({ text: 'So La Lune — Offshore' })],
      });
      setTimeout(() => warn.delete().catch(() => {}), 4000);
    } catch {}
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

client.login(process.env.TOKEN);
