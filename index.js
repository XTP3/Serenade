const Config = require("./Config.json");
const pkg = require("./package.json");
const { Client, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioResource,
    createAudioPlayer,
    NoSubscriberBehavior,
    StreamType,
    AudioPlayerStatus
} = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');

const TOKEN = Config.TOKEN;
const PREFIX = Config.PREFIX;

// We'll use a Map to store music subscriptions per guild.
// Key = guildId, Value = { connection, audioPlayer, queue: [...], ytdlProcess: ChildProcess | null }
const subscriptions = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

client.on('ready', () => {
    console.log("Serenade v" + pkg.version);
    console.log("Logged in as", client.user.tag);
});

/**
 * Helper function that plays the next track in the queue for a given subscription.
 * If the queue is empty, auto-disconnect.
 */
function playNext(guildId) {
    const subscription = subscriptions.get(guildId);
    if(!subscription) return;

    // If nothing in queue, disconnect and remove subscription.
    if(subscription.queue.length === 0) {
        subscription.connection.destroy();
        subscriptions.delete(guildId);
        return;
    }

    // Otherwise, dequeue the next URL and stream it.
    const nextUrl = subscription.queue.shift();

    // Create the ytdl process
    const ytdlProcess = youtubedl.exec(nextUrl, {
        format: 'bestaudio',
        noPlaylist: true,
        output: '-'
    });

    // Optional logging
    ytdlProcess.on('close', (code, signal) => {
        console.log(`ytdlProcess closed. code=${code}, signal=${signal}`);
    });

    // Store the current ytdlProcess in the subscription
    subscription.ytdlProcess = ytdlProcess;

    // Create an audio resource
    const resource = createAudioResource(ytdlProcess.stdout, {
        inputType: StreamType.Arbitrary
    });

    subscription.audioPlayer.play(resource);
    console.log("Now streaming:", nextUrl);
}

/**
 * On the message, parse the prefix and command.
 */
client.on('messageCreate', async (message) => {
    if(!message.guild || message.author.bot) return;
    if(!message.content.startsWith(PREFIX)) return;

    const [command, ...args] = message.content.slice(PREFIX.length).split(' ');

    // === PLAY COMMAND ===
    if(command === 'play') {
        const url = args[0];
        if(!url) {
            message.reply('Please provide a YouTube URL.');
            return;
        }

        const voiceChannel = message.member?.voice.channel;
        if(!voiceChannel) {
            message.reply('You must be in a voice channel!');
            return;
        }

        // Check if we already have a subscription for this guild
        let subscription = subscriptions.get(message.guild.id);

        // If no subscription, create one
        if(!subscription) {
            // Create a connection
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
                selfDeaf: true
            });

            // Create an audio player
            const audioPlayer = createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Stop
                }
            });

            // Listen for the AudioPlayer status changes
            audioPlayer.on('stateChange', (oldState, newState) => {
                // When the player goes from "playing" to "idle",
                // it means it finished the current track
                if(oldState.status === AudioPlayerStatus.Playing && newState.status === AudioPlayerStatus.Idle) {
                    playNext(message.guild.id);
                }
            });

            // Subscribe the connection to the audio player
            connection.subscribe(audioPlayer);

            // Initialize the subscription
            subscription = {
                connection,
                audioPlayer,
                queue: [],
                ytdlProcess: null
            };
            subscriptions.set(message.guild.id, subscription);
        }

        // Add the track to the queue
        subscription.queue.push(url);

        // If the player is idle (nothing is playing), start immediately.
        if(subscription.audioPlayer.state.status === AudioPlayerStatus.Idle) {
            playNext(message.guild.id);
            message.reply(`Now streaming: ${url}`);
        }else {
            // Otherwise, let the user know it's queued
            message.reply(`Added to queue: ${url}`);
        }

    // === STOP COMMAND ===
    }else if(command === 'stop') {
        const subscription = subscriptions.get(message.guild.id);
        if(!subscription) {
            message.reply('I am not playing in this server!');
            return;
        }

        // We can try a graceful stop
        if(subscription.ytdlProcess && !subscription.ytdlProcess.killed) {
            // Feel free to use 'SIGTERM' or 'SIGKILL' - the global handler below will catch it
            subscription.ytdlProcess.kill('SIGTERM');
            subscription.ytdlProcess = null;
        }

        // Stop the audio and disconnect
        subscription.audioPlayer.stop();
        subscription.connection.destroy();
        subscriptions.delete(message.guild.id);

        message.reply('Playback stopped and disconnected.');

    // === SKIP COMMAND ===
    }else if(command === 'skip') {
        const subscription = subscriptions.get(message.guild.id);
        if(!subscription) {
            message.reply('Nothing is playing right now!');
            return;
        }

        // Stopping the AudioPlayer will trigger playNext() in the stateChange
        subscription.audioPlayer.stop();
        message.reply('Skipping the current track...');
    }
});

/**
 * Fix for bot crashing if manually disconnected:
 * If the bot is in a voice channel and someone disconnects it,
 * this event handler will remove its subscription to avoid crashes.
 */
client.on('voiceStateUpdate', (oldState, newState) => {
    // Check if the bot itself was disconnected
    if(oldState.member && oldState.member.id === client.user.id && !newState.channelId) {
        // Bot got disconnected
        const subscription = subscriptions.get(oldState.guild.id);
        if(subscription) {
            subscription.audioPlayer.stop();

            if(subscription.ytdlProcess && !subscription.ytdlProcess.killed) {
                subscription.ytdlProcess.kill('SIGTERM');
            }

            subscriptions.delete(oldState.guild.id);
        }
    }
});

/**
 * GLOBAL EXCEPTION HANDLER
 * 
 * tinyspawn (used internally by youtube-dl-exec) throws a ChildProcessError
 * if the process is ended by a signal (SIGTERM, SIGKILL, etc.). We intercept
 * that error here to prevent the entire bot from crashing.
 */
process.on('uncaughtException', (err) => {
    // Check if it's a ChildProcessError from tinyspawn
    if(err && err.name === 'ChildProcessError' && err.signalCode) {
        // It's from forcibly killing the child process (SIGTERM, SIGKILL, etc.)
        // We'll log and ignore so the bot won't crash
        console.log(`[tinyspawn ChildProcessError] Ignoring error due to signal=${err.signalCode}`);
    }else {
        // Otherwise, let it bubble up (or handle it as you wish)
        console.error('Uncaught Exception:', err);
        process.exit(1);
    }
});

client.login(TOKEN);
