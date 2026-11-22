const { Client, GatewayIntentBits, Partials, Collection, REST, Routes, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField } = require('discord.js');
require('dotenv').config();

const OWNER_ID = '1348347939474374786';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// Anti-spam: { userId: [timestamps] }
const messageCooldowns = new Map();
const SPAM_LIMIT = 5;      // messages
const SPAM_WINDOW = 4000;  // ms

// Giveaways actifs: { messageId: { channelId, prize, endTime, participants: Set } }
const giveaways = new Map();

// ─── Slash commands ───────────────────────────────────────────────────────────
const commands = [
  {
    name: 'clear',
    description: 'Supprime des messages',
    options: [{
      name: 'nombre',
      description: 'Nombre de messages à supprimer (1-100)',
      type: 4,
      required: true,
    }],
  },
  {
    name: 'lock',
    description: 'Lock / Unlock un salon',
    options: [{
      name: 'action',
      description: 'lock ou unlock',
      type: 3,
      required: true,
      choices: [
        { name: 'lock', value: 'lock' },
        { name: 'unlock', value: 'unlock' },
      ],
    }],
  },
  {
    name: 'to',
    description: 'Exclure temporairement un membre',
    options: [
      {
        name: 'membre',
        description: 'Membre à exclure',
        type: 6,
        required: true,
      },
      {
        name: 'durée',
        description: 'Durée du timeout',
        type: 3,
        required: true,
        choices: [
          { name: '60 secondes', value: '60' },
          { name: '5 minutes',   value: '300' },
          { name: '10 minutes',  value: '600' },
          { name: '1 heure',     value: '3600' },
          { name: '1 jour',      value: '86400' },
          { name: '1 semaine',   value: '604800' },
        ],
      },
      {
        name: 'raison',
        description: 'Raison (visible uniquement dans les logs)',
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: 'giveaway',
    description: 'Lancer un giveaway',
    options: [
      {
        name: 'prix',
        description: 'Ce que le gagnant remporte',
        type: 3,
        required: true,
      },
      {
        name: 'durée',
        description: 'Durée du giveaway',
        type: 3,
        required: true,
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
];

// ─── Register commands ─────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commandes slash enregistrées');
  } catch (err) {
    console.error('Erreur enregistrement commandes:', err);
  }

  // Reprendre les giveaways persistants si nécessaire (redémarrage)
  // (ici on repart à zéro, ajoute une DB si tu veux la persistance)
});

// ─── Interaction handler ───────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  // Seul l'owner peut utiliser les commandes
  if (interaction.user.id !== OWNER_ID) return;

  // ── Slash commands ──
  if (interaction.isChatInputCommand()) {
    await interaction.deferReply({ ephemeral: true });

    const { commandName } = interaction;

    // /clear
    if (commandName === 'clear') {
      const nombre = Math.min(Math.max(interaction.options.getInteger('nombre'), 1), 100);
      let deleted = 0;
      try {
        // Bulk delete par lots de 100
        const fetched = await interaction.channel.messages.fetch({ limit: nombre });
        const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const recent = fetched.filter(m => m.createdTimestamp > twoWeeksAgo);
        const old    = fetched.filter(m => m.createdTimestamp <= twoWeeksAgo);

        if (recent.size > 0) await interaction.channel.bulkDelete(recent, true);
        // Messages >14j : suppression un par un (limite Discord)
        for (const msg of old.values()) { await msg.delete().catch(() => {}); }

        deleted = fetched.size;
      } catch (e) { console.error(e); }
      await interaction.editReply({ content: `✅ ${deleted} message(s) supprimé(s).` });
    }

    // /lock
    if (commandName === 'lock') {
      const action = interaction.options.getString('action');
      const channel = interaction.channel;
      const everyone = interaction.guild.roles.everyone;
      try {
        if (action === 'lock') {
          await channel.permissionOverwrites.edit(everyone, {
            SendMessages:       false,
            AddReactions:       false,
            SendMessagesInThreads: false,
            CreatePublicThreads:   false,
            CreatePrivateThreads:  false,
          });
          await interaction.editReply({ content: '🔒 Salon verrouillé.' });
        } else {
          await channel.permissionOverwrites.edit(everyone, {
            SendMessages:       null,
            AddReactions:       null,
            SendMessagesInThreads: null,
            CreatePublicThreads:   null,
            CreatePrivateThreads:  null,
          });
          await interaction.editReply({ content: '🔓 Salon déverrouillé.' });
        }
      } catch (e) {
        console.error(e);
        await interaction.editReply({ content: '❌ Permission insuffisante.' });
      }
    }

    // /to
    if (commandName === 'to') {
      const member  = interaction.options.getMember('membre');
      const seconds = parseInt(interaction.options.getString('durée'));
      const raison  = interaction.options.getString('raison') || 'Aucune raison fournie';
      try {
        await member.timeout(seconds * 1000, raison);
        const labels = { 60:'60 secondes', 300:'5 minutes', 600:'10 minutes', 3600:'1 heure', 86400:'1 jour', 604800:'1 semaine' };
        await interaction.editReply({ content: `✅ ${member.user.tag} exclu pendant **${labels[seconds] || seconds+'s'}**.` });
      } catch (e) {
        console.error(e);
        await interaction.editReply({ content: '❌ Impossible d\'exclure ce membre.' });
      }
    }

    // /giveaway
    if (commandName === 'giveaway') {
      const prix    = interaction.options.getString('prix');
      const seconds = parseInt(interaction.options.getString('durée'));
      const endTime = Date.now() + seconds * 1000;

      const endDate = new Date(endTime);
      const embed = new EmbedBuilder()
        .setTitle('🎉 GIVEAWAY')
        .setDescription(`**Prix :** ${prix}\n**Fin :** <t:${Math.floor(endTime / 1000)}:R>\n\nClique sur le bouton pour participer !`)
        .setColor(0x5865F2)
        .setFooter({ text: `Se termine le ${endDate.toLocaleString('fr-FR')}` });

      const btn = new ButtonBuilder()
        .setCustomId('giveaway_join')
        .setLabel('🎉 Participer')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(btn);

      // Répondre en ephemeral puis envoyer le vrai message
      await interaction.editReply({ content: '✅ Giveaway lancé !' });
      const msg = await interaction.channel.send({ embeds: [embed], components: [row] });

      giveaways.set(msg.id, {
        channelId:    interaction.channel.id,
        prize:        prix,
        endTime,
        participants: new Set(),
      });

      // Timer pour tirer au sort
      setTimeout(() => endGiveaway(msg.id, interaction.guild), seconds * 1000);
    }
  }

  // ── Bouton giveaway ──
  if (interaction.isButton() && interaction.customId === 'giveaway_join') {
    const gw = giveaways.get(interaction.message.id);
    if (!gw) return interaction.reply({ content: '❌ Ce giveaway est terminé.', ephemeral: true });
    if (gw.participants.has(interaction.user.id)) {
      return interaction.reply({ content: '✅ Tu participes déjà !', ephemeral: true });
    }
    gw.participants.add(interaction.user.id);
    await interaction.reply({ content: '🎉 Tu participes au giveaway !', ephemeral: true });
  }
});

// ─── End giveaway ─────────────────────────────────────────────────────────────
async function endGiveaway(messageId, guild) {
  const gw = giveaways.get(messageId);
  if (!gw) return;

  const channel = guild.channels.cache.get(gw.channelId);
  if (!channel) return;

  const participants = [...gw.participants];
  giveaways.delete(messageId);

  let msgObj;
  try { msgObj = await channel.messages.fetch(messageId); } catch { return; }

  // Désactiver le bouton
  const disabledBtn = new ButtonBuilder()
    .setCustomId('giveaway_join')
    .setLabel('🎉 Participer')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(true);
  const row = new ActionRowBuilder().addComponents(disabledBtn);

  if (participants.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('🎉 GIVEAWAY TERMINÉ')
      .setDescription(`**Prix :** ${gw.prize}\n\n*Aucun participant.*`)
      .setColor(0x2B2D31);
    await msgObj.edit({ embeds: [embed], components: [row] }).catch(() => {});
    return;
  }

  const winnerId = participants[Math.floor(Math.random() * participants.length)];
  const embed = new EmbedBuilder()
    .setTitle('🎉 GIVEAWAY TERMINÉ')
    .setDescription(`**Prix :** ${gw.prize}\n**Gagnant :** <@${winnerId}>\n\nFélicitations !`)
    .setColor(0x57F287);

  await msgObj.edit({ embeds: [embed], components: [row] }).catch(() => {});
  await channel.send(`🎉 Félicitations <@${winnerId}> ! Tu remportes **${gw.prize}** !`);
}

// ─── Anti-spam ─────────────────────────────────────────────────────────────────
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.author.id === OWNER_ID) return;

  const userId = message.author.id;
  const now    = Date.now();

  if (!messageCooldowns.has(userId)) messageCooldowns.set(userId, []);
  const timestamps = messageCooldowns.get(userId).filter(t => now - t < SPAM_WINDOW);
  timestamps.push(now);
  messageCooldowns.set(userId, timestamps);

  if (timestamps.length >= SPAM_LIMIT) {
    messageCooldowns.set(userId, []); // reset
    try {
      const warn = await message.channel.send(`${message.author} Vous écrivez des messages trop rapidement.`);
      setTimeout(() => warn.delete().catch(() => {}), 3000);
    } catch {}
  }
});

client.login(process.env.TOKEN);
