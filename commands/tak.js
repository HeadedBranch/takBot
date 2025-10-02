const { SlashCommandBuilder } = require("discord.js");
const { parseTPS, parseTheme } = require("../TPS-Ninja/src");
const config = require("../config.json");
const {
  clearDeleteTimer,
  createPtnFile,
  drawBoard,
  getTheme,
  getTurnMessage,
  isGameChannel,
  isGameOngoing,
  saveGameData,
  sendMessage,
  sendPngToDiscord,
  setInactiveTimer,
  setTheme
} = require("../util");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tak")
    .setDescription("Begin a game of Tak against the specified opponent.")
    .addUserOption((option) =>
      option
        .setName("opponent")
        .setDescription("Your opponent")
        .setRequired(true)
    )
    .addIntegerOption((option) => {
        return option
          .setName("size")
          .setDescription("Board size")
          .addChoices(
            [3, 4, 5, 6, 7, 8].map(size => ({
              name: `${size}x${size}${config.defaults.size === size ? " (default)" : ""}`,
              value: size
            }))
          );
      }
    )
    .addNumberOption((option) =>
      option
        .setName("komi")
        .setDescription("Komi")
        .addChoices(
          Array.from({ length: 18 },
            (_, i) => (i - 9) / 2).map(komi => ({
            name: `${komi}${config.defaults.komi === komi ? " (default)" : ""}`,
            value: komi
          }))
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("color")
        .setDescription("Choose your color")
        .addChoices(
          { name: "White (Player 1)", value: 1 },
          { name: "Black (Player 2)", value: 2 }
        )
    )
    .addStringOption((option) =>
      option.setName("tps").setDescription("Initial TPS")
    )
    .addStringOption((option) =>
      option
        .setName("opening")
        .setDescription("Opening variation")
        .addChoices(
          { name: "Swap", value: "swap" },
          { name: "No Swap", value: "no-swap" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("caps")
        .setDescription("Cap stones per player")
        .setMinValue(0)
    )
    .addIntegerOption((option) =>
      option
        .setName("flats")
        .setDescription("Flat stones per player")
        .setMinValue(3)
    )
    .addIntegerOption((option) =>
      option
        .setName("caps1")
        .setDescription("Cap stones for Player 1")
        .setMinValue(0)
    )
    .addIntegerOption((option) =>
      option
        .setName("flats1")
        .setDescription("Flat stones for Player 1")
        .setMinValue(3)
    )
    .addIntegerOption((option) =>
      option
        .setName("caps2")
        .setDescription("Cap stones for Player 2")
        .setMinValue(0)
    )
    .addIntegerOption((option) =>
      option
        .setName("flats2")
        .setDescription("Flat stones for Player 2")
        .setMinValue(3)
    )
    .addIntegerOption((option) =>
      option
        .setName("inactive-interval")
        .setDescription("Configure inactivity reminders")
        .addChoices(
          { name: "1 Day (default)", value: 864e5 },
          { name: "2 Days", value: 1728e5 },
          { name: "3 Days", value: 2592e5 },
          { name: "1 Week", value: 6048e5 },
          { name: "Disabled", value: -1 }
        )
    )
    .addStringOption((option) =>
      option
        .setName("theme")
        .setDescription("Theme name or JSON")
        .setAutocomplete(true)
    )
    .addBooleanOption((option) =>
      option.setName("flat-counts").setDescription("Show flat counts (default)")
    )
    .addBooleanOption((option) =>
      option
        .setName("stack-counts")
        .setDescription("Show stack counts (default)")
    )
    .addBooleanOption((option) =>
      option
        .setName("road-connections")
        .setDescription("Show road connections (default)")
    )
    .addBooleanOption((option) =>
      option.setName("allow-links").setDescription("Allow links (default)")
    )
    .addBooleanOption((option) =>
      option.setName("blind").setDescription("Never show the board")
    ),
  async execute(interaction, client) {
    const options = interaction.options;
    const opponent = options.getUser("opponent");
    if (!opponent) {
      return sendMessage(interaction, "Invalid opponent", true);
    }
    if (isGameOngoing(interaction)) {
      return sendMessage(interaction, "There's a game in progress!", true);
    }
    if (client.user.id === opponent.id) {
      return sendMessage(
        interaction,
        "Sorry, I don't know how to play yet. I just facilitate games. Challenge someone else!",
        true
      );
    }
    let player1;
    let displayName1;
    let player2;
    let displayName2;
    let thisPlayer =
      options.getInteger("color") || 1 + Math.round(Math.random());
    if (thisPlayer === 1) {
      player1 = interaction.member;
      displayName1 = interaction.member.displayName;
      player2 = opponent;
      displayName2 = opponent.displayName;
    } else {
      player1 = opponent;
      displayName1 = opponent.displayName;
      player2 = interaction.member;
      displayName2 = interaction.member.displayName;
    }

    let tps = options.getString("tps");
    let tpsParsed;
    let size;
    if (tps) {
      // TPS
      tpsParsed = parseTPS(tps);
      if (tpsParsed.error) {
        return sendMessage(interaction, tpsParsed.error, true);
      }
      size = tpsParsed.size;
    } else {
      // Size
      size = options.getInteger("size") || config.defaults.size;
      tps = size;
      if (size < 3 || size > 8) {
        return sendMessage(interaction, "Invalid board size.", true);
      }
    }

    // Komi
    let komi = options.getNumber("komi") || config.defaults.komi;
    if (komi < -4.5 || komi > 4.5) {
      return sendMessage(interaction, "Invalid komi.", true);
    }

    // Opening
    let opening = options.getString("opening") || config.defaults.opening;
    if (opening != "swap" && opening != "no-swap") {
      return sendMessage(interaction, "Invalid opening.", true);
    }

    // Piece counts
    const caps = options.getInteger("caps");
    const flats = options.getInteger("flats");
    const caps1 = options.getInteger("caps1");
    const flats1 = options.getInteger("flats1");
    const caps2 = options.getInteger("caps2");
    const flats2 = options.getInteger("flats2");

    // Inactivity Reminder Interval
    const inactiveInterval = options.getInteger("inactive-interval") || 864e5;

    // Theme
    let theme = options.getString("theme");
    if (theme) {
      try {
        theme = parseTheme(theme);
      } catch (err) {
        return sendMessage(interaction, "Invalid theme", true);
      }
    } else {
      theme = getTheme(interaction);
    }

    // Toggles
    const flatCounts = options.getBoolean("flat-counts") || config.defaults.flatCounts;
    const stackCounts = options.getBoolean("stack-counts") || config.defaults.stackCounts;
    const showRoads = options.getBoolean("road-connections") || config.defaults.roadConnections;
    const allowLinks = options.getBoolean("allow-links") || config.defaults.allowLinks;
    const blind = options.getBoolean("blind") || config.defaults.blind;

    // Create game data
    const gameData = {
      player1Id: player1.id,
      player2Id: player2.id,
      player1: displayName1,
      player2: displayName2,
      size,
      komi,
      opening,
      inactiveInterval
    };
    if (tpsParsed) {
      gameData.initialTPS = tps;
      gameData.moveNumber = Number(tpsParsed.linenum);
    }
    gameData.gameId = createPtnFile(gameData);

    if (caps !== null) gameData.caps = caps;
    if (flats !== null) gameData.flats = flats;
    if (caps1 !== null) gameData.caps1 = caps1;
    if (flats1 !== null) gameData.flats1 = flats1;
    if (caps2 !== null) gameData.caps2 = caps2;
    if (flats2 !== null) gameData.flats2 = flats2;
    if (flatCounts === false) gameData.flatCounts = false;
    if (stackCounts === false) gameData.stackCounts = false;
    if (showRoads === false) gameData.showRoads = false;
    if (allowLinks === false) gameData.allowLinks = false;
    if (blind) gameData.blind = true;

    let destination = interaction;
    let channelName = `${gameData.player1}-🆚-${gameData.player2}`;
    if (!isGameChannel(interaction)) {
      // Make a new thread (which is a type of channel)
      try {
        let channel = await interaction.channel.threads.create({
          name: channelName
        });
        destination = { channel };
        await sendMessage(interaction, `<#${channel.id}>`);
        await channel.members.add(player1.id);
        await channel.members.add(player2.id);
      } catch (err) {
        console.error(err);
        return sendMessage(
          interaction,
          "I wasn't able to create a new channel.",
          true
        );
      }
    } else {
      // Use existing channel
      interaction.channel.setName(channelName);
    }

    let canvas;
    try {
      canvas = drawBoard({ ...gameData, tps }, theme);
    } catch (err) {
      console.error(err);
      return sendMessage(
        interaction,
        "Something went wrong when I tried to draw the board.",
        true
      );
    }

    saveGameData(destination, { tps: canvas.id, gameData });
    if (options.getString("theme")) {
      setTheme(destination, theme);
    }
    const message = getTurnMessage(gameData, canvas);
    sendPngToDiscord(destination, canvas, message);

    clearDeleteTimer(interaction);
    setInactiveTimer(destination, gameData, canvas);
  }
};
