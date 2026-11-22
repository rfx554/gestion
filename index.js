const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
  EmbedBuilder, PermissionsBitField,
} = require('discord.js');
require('dotenv').config();

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
      const fetched = await interaction.channel.messages.fetch({ limit: 100 });
      const sorted  = fetched.sort((a, b) => b.createdTimestamp - a.createdTimestamp).first(nombre);
      const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const recent  = sorted.filter(m => m.createdTimestamp > twoWeeksAgo);
      const old     = sorted.filter(m => m.createdTimestamp <= twoWeeksAgo);
      if (recent.length > 0) {
        const deleted = await interaction.channel.bulkDelete(recent, true);
        totalDeleted += deleted.size;
      }
      for (const msg of old) {
        await msg.delete().catch(() => {});
        totalDeleted++;
      }
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
        content: `Ce salon a ete **ferme** par ${executor}.`,
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
        content: `Ce salon a ete **ouvert** par ${executor}.`,
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
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(btn);

    const embed = new EmbedBuilder()
      .setTitle(`Giveaway: ${prix}`)
      .addFields(
        { name: 'Fin',          value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true },
        { name: 'Participants', value: '0',                                    inline: true },
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
        await member.send({ content: ping ? `${member}\n${message}` : message });
        sent++;
      } catch { failed++; }
      await sleep(1100);
    }
    await interaction.followUp({ content: `Envoyes : **${sent}** | Echecs : **${failed}**`, ephemeral: true });
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
    .setTitle(`Giveaway: ${gw.prize}`)
    .addFields(
      { name: 'Fin',          value: `<t:${Math.floor(gw.endTime / 1000)}:R>`, inline: true },
      { name: 'Participants', value: `${gw.participants.size}`,                 inline: true },
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
      .setTitle(`Giveaway: ${gw.prize}`)
      .addFields({ name: 'Resultat', value: 'Aucun participant.' })
      .setColor(0x2b2d31);
    await msgObj.edit({ embeds: [embedFin], components: [row] }).catch(() => {});
    return;
  }

  const winnerId = participants[Math.floor(Math.random() * participants.length)];

  // Mettre a jour l'embed avec le gagnant (comme dans la capture)
  const embedFin = new EmbedBuilder()
    .setTitle(`Giveaway: ${gw.prize}`)
    .addFields(
      { name: 'Gagnant',      value: `<@${winnerId}>`,        inline: true },
      { name: 'Participants', value: `${participants.length}`, inline: true },
    )
    .setColor(0x2b2d31);

  await msgObj.edit({ embeds: [embedFin], components: [row] }).catch(() => {});

  // Message d'annonce separe
  await channel.send(`Felicitations <@${winnerId}> ! Tu remportes **${gw.prize}** !`);
}

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
