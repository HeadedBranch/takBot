const Discord = require('discord.js');
const fs = require('fs');
const crypto = require('crypto');
const auth = require('./auth.json');
const parser = require('minimist');
const {TPStoCanvas, parseTPS, parseTheme} = require('./TPS-Ninja/src');
const {themes} = require('./TPS-Ninja/src/themes');
const {compressToEncodedURIComponent} = require('lz-string');
const {Permissions} = require('discord.js');
const timestring = require('timestring');
const chrono = require('chrono-node');

const client = new Discord.Client();
const defaultTheme = 'discord';



// Persisting variables

let deleteTimers = [];
let reminderTimers = [];



// Helper functions

function validPly(cmd) {
    return /^(\d)?([CcSs])?([a-hA-H])([1-8])(([<>+-])([1-8]+)?\*?)?['"’”?!]*$/i.test(cmd);
}

function getLastFilename(msg) {
    let dirname = `data/${msg.channel.id}/tps/`;
    if (!fs.existsSync(dirname)) {
        return false;
    }
    let files = fs.readdirSync(dirname);
    files.sort();
    return files && files.length ? dirname + files[files.length-1] : false;
}

function getGameData(msg) {
    const channelDir = `data/${msg.channel.id}/`;
    const metaDir = channelDir + 'meta/';
    const tpsDir = channelDir + 'tps/';

    try {
        // Get meta info
        let data = JSON.parse(fs.readFileSync(metaDir + 'game.json', 'utf8'));

        // Get the latest board state
        if (fs.existsSync(tpsDir)) {
            let filename = getLastFilename(msg);
            [data.tps, data.hl] = fs.readFileSync(filename, 'utf8').split('\n');
            let parsedTPS = parseTPS(data.tps);
            data.turnMarker = String(parsedTPS.player);
            data.moveNumber = Number(parsedTPS.linenum);
        }
        return data;
    } catch (err) {
        // On error we assume that the file doesn't exist
    }
}

function isPlayer(msg, gameData) {
    return msg.author.id == gameData.player1Id || msg.author.id == gameData.player2Id;
}

function saveGameData(msg, { gameData, tps, ply }) {
    const channelDir = `data/${msg.channel.id}/`;
    const metaDir = channelDir + 'meta/';
    const tpsDir = channelDir + 'tps/';

    // Meta data
    if (gameData) {
        try {
            fs.mkdirSync(metaDir, {recursive:true});
            fs.writeFileSync(metaDir + 'game.json', JSON.stringify(gameData));
        } catch (err) {
            console.error(err);
        }
    }

    // Board state
    let filename = Date.now() + crypto.randomBytes(2).toString('hex');
    while (filename.length < 19) {
        filename = '0' + filename;
    }
    if (ply) {
        tps += '\n' + ply;
    }
    try {
        fs.mkdirSync(tpsDir, {recursive:true});
        fs.writeFileSync(tpsDir + filename + '.tps', tps);
    } catch (err) {
        console.error(err);
    }
}

function drawBoard(gameData, theme, ply) {
    let moveNumber = gameData.moveNumber;
    if (!ply && gameData.hl && gameData.turnMarker === '1') {
        moveNumber -= 1;
    }
    let options = {
        ...gameData,
        moveNumber,
        theme,
        bgAlpha: 0,
        padding: false
    }
    if (ply) {
        options.ply = ply;
    }
    return TPStoCanvas(options);
}

function getTurnMessage(gameData, canvas, ply=gameData.hl) {
    const nextPlayer = gameData[`player${canvas.player}Id`];
    let message = `Your turn ${canvas.linenum}, <@${nextPlayer}>.`;
    if (ply) {
        const lastPlayer = canvas.player == 1 ? 2 : 1;
        message = ply + ' | ' + message;
        if (/''|"/.test(ply)) {
            message += '\n*' + gameData[`player${lastPlayer}`];
            message += ply.includes('?') ? ' thinks that might be' : ' is pretty sure that\'s';
            message += ' Tinuë.*';
        } else if (/'/.test(ply)) {
            message += '\n*Tak!*';
        }
    } else {
        message += '\nType a valid move in PTN to play.\n(<https://ustak.org/portable-tak-notation/>)'
    }
    return message;
}

function getReminderMessage(gameData, canvas) {
    const nextPlayer = gameData[`player${canvas.player}Id`];
    return `It's been a while since your last move. Please take your turn soon, <@${nextPlayer}>.`;
}

function deleteLastTurn(msg, gameData) {
    try {
        fs.unlinkSync(getLastFilename(msg));
        if (gameData.gameId) {
            removeLastPlyFromPtnFile(gameData.gameId);
        }
    } catch (err) {
        console.error(err);
    }
}

function isGameChannel(msg) {
    return fs.existsSync(`data/${msg.channel.id}/meta/game.json`);
}

function isGameOngoing(msg) {
    return fs.existsSync(`data/${msg.channel.id}/tps`);
}

function cleanupFiles(msg, channelDeleted=false) {
    let dirname = `data/${msg.channel.id}/`;
    try {
        if (channelDeleted) {
            fs.rmSync(dirname, {recursive:true, force:true});
        } else {
            if (!fs.existsSync(dirname)) {
                return false;
            } else {
                return fs.rmSync(dirname + 'tps', {recursive:true, force:true});
            }
        }
    } catch (err) {
        console.error(err);
    }
}

function tagDateTime() {
    const pad = (num) => {
        return (num < 9 ? '0' : '') + num;
    };
    const now = new Date();
    return (
        `[Date "${now.getUTCFullYear()}.${pad(now.getUTCMonth()+1)}.${pad(now.getUTCDate())}"]`+
        `[Time "${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}"]`
    );
};

function createPtnFile(gameData) {
    try {
        fs.mkdirSync('ptn', {recursive:true});
    } catch (err) {
        console.error(err);
    }

    let gameId = Date.now() + crypto.randomBytes(2).toString('hex');
    let filename = `ptn/${gameId}.ptn`;
    let data = tagDateTime()
        + `[Site "https://github.com/humanat/takBot"]`
        + `[Player1 "${gameData.player1}"]`
        + `[Player2 "${gameData.player2}"]`
        + `[Size "${gameData.size}"]`
        + `[Komi "${gameData.komi}"]`
    if (gameData.opening != 'swap') {
        data += `[Opening "${gameData.opening}"]`;
    }
    if (gameData.initialTPS) {
        data = `[TPS "${gameData.initialTPS}"]` + data;
    }
    try {
        fs.writeFileSync(filename, data);
    } catch (err) {
        console.error(err);
    }
    return gameId;
}

function deletePtnFile(gameData) {
    if (!gameData || !gameData.gameId) {
        return false;
    }
    try {
        fs.unlinkSync(`ptn/${gameData.gameId}.ptn`);
    } catch (err) {
        console.error(err);
    }
    return true;
}

function addPlyToPtnFile(gameId, ply) {
    const filename = `ptn/${gameId}.ptn`;
    try {
        let data = fs.readFileSync(filename, 'utf8');
        data += ' ' + ply;
        fs.writeFileSync(filename, data);
    } catch (err) {
        console.error(err);
    }
}

function removeLastPlyFromPtnFile(gameId) {
    let filename = `ptn/${gameId}.ptn`;
    try {
        let data = fs.readFileSync(filename, 'utf8');
        data = data.substr(0, data.lastIndexOf(' '));
        fs.writeFileSync(filename, data);
    } catch (err) {
        console.error(err);
    }
}

function getPtnFromFile(gameId) {
    let filename = `ptn/${gameId}.ptn`;
    try {
        return fs.readFileSync(filename, 'utf8');
    } catch (err) {
        if (!err.message.includes('no such file or directory')) {
            console.error(err);
        }
    }
}

function addToHistoryFile({gameId, player1, player2, komi, opening, result}) {
    let historyFilename = 'results.db';
    let ptnFilename = `ptn/${gameId}.ptn`;
    let resultString = `${gameId}, ${player1}, ${player2}, ${komi}, ${opening}, ${result}\n`;
    try {
        fs.appendFileSync(historyFilename, resultString);
        // Update PTN
        let data = fs.readFileSync(ptnFilename, 'utf8');
        let lastTag = data.indexOf('] ') + 1;
        data = data.substr(0, lastTag)
            + tagDateTime()
            + `[Result "${result}"]`
            + data.substr(lastTag)
            + ' ' + result;
        fs.writeFileSync(ptnFilename, data);
    } catch (err) {
        console.error(err);
    }
}

function getHistoryFromFile(page) {
    try {
        if (isNaN(page) || page < 1) { return; }
        let filename = 'results.db';
        let gamesPerPage = 10;
        let history = fs.readFileSync(filename, 'utf8');
        let historyArray = history.split('\n');
        let header = historyArray[0];
        historyArray.shift();
        while (historyArray[historyArray.length-1] == '') { historyArray.pop(); }
        let numPages = Math.ceil(historyArray.length/gamesPerPage);
        if (page > numPages) { return; }
        historyArray = historyArray.reverse();
        historyArray = historyArray.slice((page-1)*gamesPerPage, page*gamesPerPage);
        history = `Page ${page} of ${numPages}\n\n${header}\n` + historyArray.join('\n');
        return history;
    } catch (err) {
        console.error(err);
    }
}

async function setDeleteTimer(msg) {
    await sendMessage(msg, 'This channel will self destruct in approximately 24 hours unless a new game is started.');
    let timerId = setTimeout(handleDelete, 86400000, msg);
    deleteTimers[msg.channel.id] = timerId;
}

async function clearDeleteTimer(msg) {
    let timerId = deleteTimers[msg.channel.id];
    if (timerId) {
        clearTimeout(timerId);
        deleteTimers.splice(deleteTimers.indexOf(timerId), 1);
    }
}

async function setReminderTimer(msg, gameData, canvas) {
    let message = getReminderMessage(gameData, canvas);
    let timerId = setInterval(sendMessage, 86400000, msg, message);
    reminderTimers[msg.channel.id] = timerId;
}

async function clearReminderTimer(msg) {
    let timerId = reminderTimers[msg.channel.id];
    if (timerId) {
        clearInterval(timerId);
        reminderTimers.splice(reminderTimers.indexOf(timerId), 1);
    }
}



// Functions to send to Discord

async function sendPngToDiscord(msg, canvas, message) {
    const filename = canvas.id + '.png';
    const attachment = new Discord.MessageAttachment(canvas.toBuffer(), filename);

    try {
        await msg.channel.send(message, {
            files: [attachment]
        });
    } catch (err) {
        console.error(err);
    }
}

async function sendMessage(msg, content) {
    try {
        if (typeof content == 'string' && content.length <= 2000) {
            await msg.channel.send(content);
        } else {
            await msg.channel.send('I wanted to send a message but it was too long 😢');
        }
    } catch (err) {
        console.error(err);
    }
}



// Major handler methods

async function handleNew(msg, options) {
    if (msg.mentions.users.array().length != 1) {
        return sendMessage(msg, 'I didn\'t understand. See `!tak help` for example commands.');
    } else if (isGameOngoing(msg)) {
        return sendMessage(msg, 'There\'s a game in progress! Use `!tak end` if you\'re sure no one is using this channel.');
    } else if (client.user.id === msg.mentions.users.first().id) {
        return sendMessage(msg, 'Sorry, I don\'t know how to play yet. I just facilitate games. Challenge someone else!');
    } else {
        let player1;
        let displayName1;
        let player2;
        let displayName2;
        let thisPlayer = options.white ? 1 : options.black ? 2 : 1 + Math.round(Math.random());
        if (thisPlayer == 1) {
            player1 = msg.author;
            displayName1 = msg.member.displayName;
            player2 = msg.mentions.users.first();
            displayName2 = msg.mentions.members.first().displayName;
        } else {
            player1 = msg.mentions.users.first();
            displayName1 = msg.mentions.members.first().displayName;
            player2 = msg.author;
            displayName2 = msg.member.displayName;
        }

        let tps = options.tps || options.size || 6;
        let tpsParsed;
        let size;
        if (options.tps) {
            // TPS
            tps += ` ${options._[0]} ${options._[1]}`;
            tpsParsed = parseTPS(tps);
            if (tpsParsed.error) {
                return sendMessage(msg, tpsParsed.error);
            }
            size = tpsParsed.size;
        } else {
            // Size
            size = tps;
            if (size < 3 || size > 8) {
                return sendMessage(msg, 'Invalid board size.');
            }
        }

        // Komi
        let komi = options.komi || 0;
        if (komi < -4.5 || komi > 4.5) {
            return sendMessage(msg, 'Invalid komi.');
        }

        // Opening
        let opening = options.opening || 'swap';
        if (opening != 'swap' && opening != 'no-swap') {
            return sendMessage(msg, 'Invalid opening.');
        }

        // Theme
        let theme;
        if (options.theme) {
            try {
                theme = parseTheme(options.theme);
            } catch(err) {
                return sendMessage(msg, 'Invalid theme');
            }
        } else {
            theme = getTheme(msg);
        }

        // Create game data
        const gameData = {
            player1Id: player1.id,
            player2Id: player2.id,
            player1: displayName1,
            player2: displayName2,
            size,
            komi,
            opening
        };
        let nextPlayer = player1.id;
        if (options.tps) {
            gameData.initialTPS = tps;
            gameData.moveNumber = Number(tpsParsed.linenum);
            if (tpsParsed.player != 1) nextPlayer = player2.id;
        }
        const gameId = createPtnFile(gameData);
        gameData.gameId = gameId;

        let channel = msg.channel;
        let channelName = `${gameData.player1}-🆚-${gameData.player2}`;
        if (!isGameChannel(msg)) {
            // Make a new channel
            try {
                channel = await msg.guild.channels.create(channelName, {
                    parent: msg.channel.parent,
                    // permissionOverwrites: [{
                        //     id: player1.id,
                        //     allow: [Permissions.FLAGS.VIEW_CHANNEL, Permissions.FLAGS.SEND_MESSAGES]
                    // },{
                        //     id: player2.id,
                        //     allow: [Permissions.FLAGS.VIEW_CHANNEL, Permissions.FLAGS.SEND_MESSAGES]
                    // }]
                });
                await sendMessage(msg, `<#${channel.id}>`);
            } catch (err) {
                console.error(err);
                return sendMessage(msg, 'I wasn\'t able to create a new channel.');
            }
        } else {
            // Use existing channel
            msg.channel.setName(channelName);
        }

        let canvas;
        try {
            canvas = drawBoard({ ...gameData, tps }, theme);
        } catch (err) {
            console.error(err);
            return sendMessage(msg, 'Something went wrong when I tried to draw the board.');
        }

        saveGameData({ channel }, { tps: canvas.id, gameData });
        if (options.theme) {
            setTheme({ channel }, options.theme);
        }
        const message = getTurnMessage(gameData, canvas);
        sendPngToDiscord({ channel }, canvas, message);

        clearDeleteTimer(msg);
    }
}

function renameChannel(msg, inProgress) {
    return msg.channel.setName(
        inProgress
            ? msg.channel.name.replace('-vs-', '-🆚-')
            : msg.channel.name.replace('-🆚-', '-vs-')
    ).catch(err => console.error(err));
}

async function handleResign(msg) {
    let gameData = getGameData(msg);

    if (gameData) {
        let result;
        if (msg.author.id === gameData.player1Id) {
            result = "0-1";
        } else if (msg.author.id === gameData.player2Id) {
            result = "1-0";
        } else {
            return sendMessage(msg, "You are not an active player.");
        };

        let nextPlayer = gameData.player1Id;
        if (gameData.turnMarker === '1') nextPlayer = gameData.player2Id;
        addPlyToPtnFile(gameData.gameId, result);
        cleanupFiles(msg);
        if (gameData.gameId) {
            addToHistoryFile({
                'gameId': gameData.gameId,
                'player1': gameData.player1,
                'player2': gameData.player2,
                'komi': gameData.komi,
                'opening': gameData.opening,
                'result': result
            });
        }
        await sendMessage(msg, `GG <@${nextPlayer}>! Game Ended ${result}`);
        await sendMessage(msg, `Here's a link to the completed game:\nID: ${gameData.gameId}`);
        await handleLink(msg, gameData.gameId);
        clearReminderTimer(msg);
        setDeleteTimer(msg);
        return renameChannel(msg, false);
    } else {
        return sendMessage(msg, 'There is no ongoing game in this channel.');
    }
}

async function handleEnd(msg) {
    if (isGameOngoing(msg)) {
        let gameData = getGameData(msg);
        if (gameData.hl) {
            await sendMessage(msg, 'Here\'s a link to the game:');
            await handleLink(msg);
        }
        cleanupFiles(msg);
        deletePtnFile(gameData);
        clearReminderTimer(msg);
        setDeleteTimer(msg);
        await sendMessage(msg, 'Ongoing game in this channel has been removed.');
        return renameChannel(msg, false);
    } else {
        return sendMessage(msg, 'There is no ongoing game in this channel.');
    }
}

async function handleDelete(msg) {
    if (isGameOngoing(msg)) {
        return sendMessage(msg, 'There is an ongoing game in this channel! If you\'re sure you about this, please say `!tak end` and try again.');
    } else {
        if (!isGameChannel(msg)) {
            return sendMessage(msg, 'I can\'t delete this channel.');
        } else {
            const gameData = getGameData(msg);
            if(!isPlayer(msg, gameData)) {
                return sendMessage(msg, 'Only the previous players may delete the channel.');
            } else {
                try {
                    await sendMessage(msg, 'Deleting channel. Please be patient, as this sometimes takes a while.');
                    return msg.channel.delete();
                } catch (err) {
                    console.error(err);
                    return sendMessage(msg, 'I wasn\'t able to delete the channel.');
                }
            }
        }
    }
}

async function handleMove(msg, ply) {
    if (!isGameOngoing(msg)) return;

    let gameData = getGameData(msg);
    if (!gameData) return;

    if (!isPlayer(msg, gameData)) {
        return;
    }

    if ((gameData.turnMarker === '1' && msg.author.id != gameData.player1Id)
            || (gameData.turnMarker === '2' && msg.author.id != gameData.player2Id)) {
        return sendMessage(msg, 'You are not the active player.');
    }

    let canvas;
    try {
        ply = ply.replace('’', '\'').replace('”', '"');
        canvas = drawBoard(gameData, getTheme(msg), ply);
    } catch (err) {
        if (!/^Invalid|stones remaining$/.test(err.message)) {
            console.error(err);
        }
        return sendMessage(msg, 'Invalid move.');
    }

    if (gameData.gameId) {
        addPlyToPtnFile(gameData.gameId, ply);
    }

    let nextPlayer = gameData.player1Id;
    if (gameData.turnMarker === '1') nextPlayer = gameData.player2Id;

    if (!canvas.isGameEnd) {
        // Game is still in progress
        saveGameData(msg, { tps: canvas.id, ply });
        if (!msg.channel.name.includes('🆚')) {
            renameChannel(msg, true);
        }
        const message = getTurnMessage(gameData, canvas, ply);
        await sendPngToDiscord(msg, canvas, message);

        clearReminderTimer(msg);
        setReminderTimer(msg, gameData, canvas);
    } else {
        // Game is over
        const result = canvas.id;
        cleanupFiles(msg);
        if (gameData.gameId) {
            addToHistoryFile({
                'gameId': gameData.gameId,
                'player1': gameData.player1,
                'player2': gameData.player2,
                'komi': gameData.komi,
                'opening': gameData.opening,
                'result': result
            });
        }
        await sendPngToDiscord(msg, canvas, `${ply} | GG <@${nextPlayer}>! Game Ended ${result}`);
        await sendMessage(msg, `Here's a link to the completed game:\nID: ${gameData.gameId}`);
        await handleLink(msg, gameData.gameId);
        clearReminderTimer(msg);
        setDeleteTimer(msg);
        return renameChannel(msg, false);
    }
}

async function handleUndo(msg) {
    let gameData = getGameData(msg);
    if (!gameData) {
        return sendMessage(msg, 'This isn\'t a game channel.');
    }

    if (!gameData.hl) {
        return sendMessage(msg, 'There\'s nothing to undo.');
    }

    if (!isGameOngoing(msg)) {
        return sendMessage(msg, 'The game is over, but you can start a new game using the --tps flag!');
    }

    if (!isPlayer(msg, gameData)) {
        return;
    }

    if (
        (gameData.turnMarker === '1' && msg.author.id != gameData.player2Id) ||
        (gameData.turnMarker === '2' && msg.author.id != gameData.player1Id)
    ) {
        return sendMessage(msg, 'You cannot undo a move that is not your own.');
    }

    deleteLastTurn(msg, gameData);
    gameData = getGameData(msg);
    const canvas = drawBoard(gameData, getTheme(msg));
    const message = 'Undo complete!\n' + getTurnMessage(gameData, canvas);

    clearReminderTimer(msg);
    setReminderTimer(msg, gameData, canvas);

    return sendPngToDiscord(msg, canvas, message);
}

async function handleLink(msg, gameId) {
    if (!gameId) {
        let gameData = getGameData(msg);
        if (!gameData) {
            return sendMessage(msg, 'You must use the game ID to get a link for a completed game. See `!tak history` to get the game ID.');
        }
        gameId = gameData.gameId;
    }

    let ptn = getPtnFromFile(gameId);
    if (!ptn) {
        return sendMessage(msg, 'I couldn\'t find a game with that ID.');
    } else {
        return sendMessage(msg, `<https://ptn.ninja/${compressToEncodedURIComponent(ptn)}>`);
    }
}

async function handleRedraw(msg) {
    if (!isGameOngoing(msg)) {
        return sendMessage(msg, 'I couldn\'t find an ongoing game in this channel.');
    }
    const gameData = getGameData(msg);
    const canvas = drawBoard(gameData, getTheme(msg));
    const message = getTurnMessage(gameData, canvas);
    return sendPngToDiscord(msg, canvas, message);
}

async function handleRematch(msg) {
    const gameData = getGameData(msg);
    if (!gameData) {
        return sendMessage(msg, 'I couldn\'t find a previous game in this channel.');
    } else if (gameData.tps) {
        return sendMessage(msg, 'There\'s still a game in progress!');
    } else if (!isPlayer(msg, gameData)) {
        return sendMessage(msg, 'Only the previous players can rematch.');
    }

    // Swap players
    [gameData.player1, gameData.player1Id, gameData.player2, gameData.player2Id] =
        [gameData.player2, gameData.player2Id, gameData.player1, gameData.player1Id];

    // Generate new game ID
    const gameId = createPtnFile(gameData);
    gameData.gameId = gameId;

    let nextPlayer = gameData.player1Id;
    if (gameData.initialTPS) {
        let tpsParsed = parseTPS(gameData.initialTPS);
        if (tpsParsed.player != 1) {
            nextPlayer = gameData.player2Id;
        }
    }

    msg.channel.setName(`${gameData.player1}-🆚-${gameData.player2}`);
    let canvas;
    try {
        canvas = drawBoard({ ...gameData, tps: gameData.initialTPS || gameData.size }, getTheme(msg));
    } catch (err) {
        console.error(err);
        return sendMessage(msg, 'Something went wrong when I tried to draw the board.');
    }

    saveGameData(msg, { tps: canvas.id, gameData });
    const message = getTurnMessage(gameData, canvas);
    sendPngToDiscord(msg, canvas, message);

    clearDeleteTimer(msg);
    setReminderTimer(msg, gameData, canvas);
}

function handleHistory(msg, page='1') {
    try {
        let historyData = getHistoryFromFile(parseInt(page));
        if (historyData) {
            return sendMessage(msg, '```\n' + historyData + '\n```');
        } else {
            return sendMessage(msg, 'Not a valid page number');
        }
    } catch (err) {
        console.error(err);
    }
}

function getTheme(msg) {
    try {
        return fs.readFileSync(`data/${msg.channel.id}/meta/theme`, 'utf8') || defaultTheme;
    } catch (err) {
        if (!err.message.includes('no such file or directory')) {
            console.error(err);
        }
    }
    return defaultTheme;
}

function setTheme(msg, theme) {
    try {
        fs.mkdirSync(`data/${msg.channel.id}/meta`, {recursive:true});
        fs.writeFileSync(`data/${msg.channel.id}/meta/theme`, theme);
        return true;
    } catch (err) {
        sendMessage(msg, 'Something went wrong when I tried to save the theme.');
        console.error(err);
        return false;
    }
}

async function handleTheme(msg, theme) {
    if (!isGameChannel(msg)) {
        return sendMessage(msg, 'This isn\'t a game channel.');
    } else if (theme) {
        const gameData = getGameData(msg);
        const isOngoing = isGameOngoing(msg);
        if (!isPlayer(msg, gameData)) {
            return sendMessage(msg, `Only the ${isOngoing ? 'current' : 'previous'} players may change the theme.`);
        }

        try {
            parseTheme(theme);
        } catch(err) {
            return sendMessage(msg, 'Invalid theme');
        }
        if (setTheme(msg, theme)) {
            if (!isGameOngoing(msg)) {
                return sendMessage(msg, 'Theme set.');
            } else {
                handleRedraw(msg);
            }
        }
    } else {
        theme = getTheme(msg);

        return sendMessage(msg, theme[0] === '{' ? `\`\`\`\n${theme}\n\`\`\`` : `\`${theme}\``);
    }
}

function handleHelp(msg) {
    let help = fs.readFileSync('USAGE.md', 'utf8');
    help = help.substr(help.indexOf('\n')+1);
    return sendMessage(msg, help);
}

function handleRandom(msg, arg) {
    let rand = 1+Math.floor(Math.random()*arg);
    if (isNaN(rand)) return;
    return sendMessage(msg, ''+rand);
}

function handleReminder(msg, arg) {
    try {
        let time = timestring(arg);
        let msUntilReminder = time*1000;
        sendMessage(msg, 'OK, I will ping you in this channel after ' + time + ' seconds.');
        setTimeout(sendMessage, msUntilReminder, msg, 'Hey <@'+msg.author.id+'>, you wanted me to remind you about this channel.');
    } catch(err) {
        sendMessage(msg, 'I did not understand how long you wanted me to wait before reminding you.');
    }
}

function handleDate(msg, arg) {
    try {
        let time = Math.round(Date.parse(chrono.parseDate(arg))/1000);
        sendMessage(msg, '<t:'+time+'>');
    } catch(err) {
        sendMessage(msg, 'I\'m sorry, I couldn\'t convert that date.');
    }
}



// Main code

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('message', msg => {
    let message = msg.content.trim();
    if (message.length >= 4 && message.substring(0, 4).toLowerCase() === '!tak') {
        let args = message.substring(5).split(' ');
        args = args.filter(arg => arg && arg.length !== 0);
        let cmd = args[0];
        switch(cmd) {
            case 'help':
                return handleHelp(msg);
            case 'undo':
                return handleUndo(msg);
            case 'link':
                return handleLink(msg, args[1]);
            case 'redraw':
                return handleRedraw(msg);
            case 'rematch':
                return handleRematch(msg);
            case 'history':
                return handleHistory(msg, args[1]);
            case 'theme':
                return handleTheme(msg, args.slice(1).join(' '));
            case 'themes':
                return sendMessage(msg, themes.map(t => t.id).join('\n'));
            case 'resign':
                return handleResign(msg);
            case 'end':
                return handleEnd(msg);
            case 'delete':
                return handleDelete(msg);
            case 'reminder':
                return handleReminder(msg, args[1]);
            case 'date':
                return handleDate(msg, message.substring(10));
            default:
                args.shift();
                let options = parser(
                  args.map(arg => arg.toLowerCase().replace(/[—–]+/g, "--"))
                );
                return handleNew(msg, options);
        }
    } else if (message.length >= 4 && message.substring(0,4).toLowerCase() === '!rng') {
        let args = message.substring(5).split(' ');
        args = args.filter(arg => arg && arg.length);
        if (args.length != 1) return;
        return handleRandom(msg, args[0]);
    } else {
        let args = message.split(' ');
        args = args.filter(arg => arg && arg.length !== 0);
        if (args.length != 1) return;
        if (!validPly(args[0])) return;
        return handleMove(msg, args[0]);
    }
});

client.on('channelDelete', function(channel){
    return cleanupFiles({ channel }, true);
});

client.login(auth.token);

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});
