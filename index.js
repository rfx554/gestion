const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
} = require('discord.js');
require('dotenv').config();

const OWNER_ID  = '1348347939474374786';
const GUILD_ID  = process.env.GUILD_ID;

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

// Anti-spam
const spamMap   = new Map();
const SPAM_LIMIT  = 5;
const SPAM_WINDOW = 5000;

// Giveaways actifs
const giveaways = new Map();

// ─── Commandes ────────────────────────────────────────────────────────────────
const commands = [
  {
    name: 'clear',
    description: 'Supprime des messages dans ce salon',
    options: [{ name: 'nombre', description: 'Nombre de messages (1-100)', type: 4, required: true }],
  },
  { name: 'lock',   description: 'Verrouille le salon' },
  { name: 'unlock', description: 'Déverrouille le salon' },
  {
    name: 'to',
    description: 'Exclure temporairement un membre',
    options: [
      { name: 'membre', description: 'Membre à exclure', type: 6, required: true },
      {
        name: 'durée', description: 'Durée', type: 3, required: true,
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
    description: 'Lancer un giveaway',
    options: [
      { name: 'prix', description: 'Prix du giveaway', type: 3, required: true },
      {
        name: 'durée', description: 'Durée', type: 3, required: true,
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
    description: 'Envoie un DM embed à tous les membres',
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
];

// ─── Ready ────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`Connecté : ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    // Guild commands = instantané
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands }
    );
    console.log('Commandes enregistrées instantanément.');
  } catch (e) { console.error(e); }
});

// ─── Interactions ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

  // Bouton giveaway : tout le monde peut participer
  if (interaction.isButton() && interaction.customId === 'giveaway_join') {
    const gw = giveaways.get(interaction.message.id);
    if (!gw) return interaction.reply({ content: 'Ce giveaway est terminé.', ephemeral: true });
    if (gw.participants.has(interaction.user.id))
      return interaction.reply({ content: 'Tu participes déjà.', ephemeral: true });

    gw.participants.add(interaction.user.id);
    await updateGiveawayEmbed(interaction.message, gw);
    return interaction.reply({ content: 'Tu participes au giveaway !', ephemeral: true });
  }

  // Slash commands : owner uniquement, silence total sinon
  if (!interaction.isChatInputCommand()) return;
  if (interaction.user.id !== OWNER_ID) return;

  const { commandName } = interaction;

  // /clear
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
    await interaction.editReply({ content: `${totalDeleted} message(s) supprimé(s).` });
  }

  // /lock
  if (commandName === 'lock') {
    await interaction.deferReply({ ephemeral: false });
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: false, AddReactions: false,
        SendMessagesInThreads: false, CreatePublicThreads: false,
        CreatePrivateThreads: false, UseApplicationCommands: false,
      });
      await interaction.editReply({ content: 'Salon verrouillé.' });
    } catch (e) {
      console.error(e);
      await interaction.editReply({ content: 'Permission insuffisante.' });
    }
  }

  // /unlock
  if (commandName === 'unlock') {
    await interaction.deferReply({ ephemeral: false });
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: true, AddReactions: true,
        SendMessagesInThreads: true, CreatePublicThreads: true,
        CreatePrivateThreads: true, UseApplicationCommands: true,
      });
      await interaction.editReply({ content: 'Salon déverrouillé.' });
    } catch (e) {
      console.error(e);
      await interaction.editReply({ content: 'Permission insuffisante.' });
    }
  }

  // /to
  if (commandName === 'to') {
    await interaction.deferReply({ ephemeral: false });
    const member  = interaction.options.getMember('membre');
    const seconds = parseInt(interaction.options.getString('durée'));
    const raison  = interaction.options.getString('raison') || 'Aucune raison';
    const labels  = { 60:'60 secondes', 300:'5 minutes', 600:'10 minutes', 3600:'1 heure', 86400:'1 jour', 604800:'1 semaine' };
    try {
      await member.timeout(seconds * 1000, raison);
      await interaction.editReply({ content: `${member} a été to ${labels[seconds] || seconds + 's'}` });
    } catch (e) {
      console.error(e);
      await interaction.editReply({ content: 'Impossible de timeout ce membre.' });
    }
  }

  // /giveaway
  if (commandName === 'giveaway') {
    await interaction.deferReply({ ephemeral: false });
    const prix    = interaction.options.getString('prix');
    const seconds = parseInt(interaction.options.getString('durée'));
    const endTime = Date.now() + seconds * 1000;

    const btn = new ButtonBuilder().setCustomId('giveaway_join').setLabel('Participer').setStyle(ButtonStyle.Primary);
    const row = new ActionRowBuilder().addComponents(btn);

    await interaction.editReply({ content: 'Giveaway lancé.' });
    const msg = await interaction.channel.send({ embeds: [buildGiveawayEmbed(prix, endTime, 0)], components: [row] });

    giveaways.set(msg.id, { channelId: interaction.channel.id, prize: prix, endTime, participants: new Set() });
    setTimeout(() => endGiveaway(msg.id, interaction.guild), seconds * 1000);
  }

  // /dmall
  if (commandName === 'dmall') {
    await interaction.deferReply({ ephemeral: true });
    const message = interaction.options.getString('message');
    const ping    = interaction.options.getString('ping') === 'oui';

    await interaction.editReply({
      content: `Aperçu (ping: ${ping ? 'oui' : 'non'}) — envoi en cours...`,
      embeds: [new EmbedBuilder().setDescription(message).setColor(0x5865F2)],
    });

    let members;
    try { members = await interaction.guild.members.fetch(); } catch (e) { console.error(e); return; }

    const targets = members.filter(m => !m.user.bot && m.id !== OWNER_ID);
    let sent = 0, failed = 0;

    for (const [, member] of targets) {
      try {
        await member.send({
          content: ping ? `${member}` : undefined,
          embeds: [new EmbedBuilder().setDescription(message).setColor(0x5865F2)],
        });
        sent++;
      } catch { failed++; }
      await sleep(1100); // anti-ratelimit
    }

    await interaction.followUp({ content: `Terminé. Envoyés : ${sent} | Echecs : ${failed}`, ephemeral: true });
  }
});

// ─── Giveaway helpers ─────────────────────────────────────────────────────────
function buildGiveawayEmbed(prize, endTime, count) {
  return new EmbedBuilder()
    .setTitle('GIVEAWAY')
    .setDescription(`Prix : ${prize}\nFin : <t:${Math.floor(endTime / 1000)}:R>\n\nParticipants : ${count}`)
    .setColor(0x5865F2);
}

async function updateGiveawayEmbed(message, gw) {
  await message.edit({ embeds: [buildGiveawayEmbed(gw.prize, gw.endTime, gw.participants.size)] }).catch(() => {});
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

  const disabledBtn = new ButtonBuilder().setCustomId('giveaway_join').setLabel('Participer').setStyle(ButtonStyle.Primary).setDisabled(true);
  const row = new ActionRowBuilder().addComponents(disabledBtn);

  if (participants.length === 0) {
    await msgObj.edit({ embeds: [new EmbedBuilder().setTitle('GIVEAWAY TERMINE').setDescription(`Prix : ${gw.prize}\n\nAucun participant.`).setColor(0x2B2D31)], components: [row] }).catch(() => {});
    return;
  }

  const winnerId = participants[Math.floor(Math.random() * participants.length)];
  await msgObj.edit({
    embeds: [new EmbedBuilder().setTitle('GIVEAWAY TERMINE').setDescription(`Prix : ${gw.prize}\nGagnant : <@${winnerId}>\n\nParticipants : ${participants.length}`).setColor(0x57F287)],
    components: [row],
  }).catch(() => {});
  await channel.send(`Felicitations <@${winnerId}> ! Tu remportes **${gw.prize}** !`);
}

// ─── Anti-spam ────────────────────────────────────────────────────────────────
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.author.id === OWNER_ID) return;
  if (!message.guild) return;

  const now  = Date.now();
  const prev = (spamMap.get(message.author.id) || []).filter(t => now - t < SPAM_WINDOW);
  prev.push(now);
  spamMap.set(message.author.id, prev);

  if (prev.length >= SPAM_LIMIT) {
    spamMap.set(message.author.id, []);
    try {
      const warn = await message.channel.send(`${message.author} Vous écrivez des messages trop rapidement.`);
      setTimeout(() => warn.delete().catch(() => {}), 3000);
    } catch {}
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

client.login(process.env.TOKEN);
