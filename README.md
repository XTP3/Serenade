# Serenade
A self-hosted Discord music bot for YouTube made using Node.js.  
After repeatedly dealing with unstable, broken, generally dysfunctional, and paywalled Discord bots just to be able to play YouTube audio in Discord, I decided to just make my own by using ffmpeg and youtube-dl. Ideally, this choice of technology should make it both easier to maintain as well as less likely to frequently break.

## Usage
Playing/Enqueueing: ```!play <youtubeURL>```  
Skipping Queue: ```!skip```  
Disconnecting/Stopping: ```!stop```

## Config
To use the bot, simply add your Discord bot token, located in the ```Config.json``` file under the key ```TOKEN```.
Additionally, you can customize your command prefix character by modifying the value associated with the key ```PREFIX``` (set to '!' by default).

## Requirements
- Node.js v16.9.0 (v18.x+ recommended)
