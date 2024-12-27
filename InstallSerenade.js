const { execSync } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const https = require('https');
const path = require('path');

const repoBaseUrl = 'https://raw.githubusercontent.com/XTP3/Serenade/main'; // Base URL for raw GitHub files
const filesToDownload = [
    'package.json',
    'package-lock.json',
    'Config.json',
    'index.js'
];
const configPath = './Serenade/Config.json';

// Helper function to download a file
function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(outputPath);
        https.get(url, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close(resolve);
                });
            } else {
                reject(new Error(`Failed to download file: ${response.statusCode}`));
            }
        }).on('error', (err) => {
            fs.unlink(outputPath, () => reject(err));
        });
    });
}

// Prompt function
function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
    }));
}

(async () => {
    try {
        console.log('Creating project directory...');
        if (!fs.existsSync('./Serenade')) {
            fs.mkdirSync('./Serenade');
        }

        console.log('Downloading project files...');
        for (const file of filesToDownload) {
            const fileUrl = `${repoBaseUrl}/${file}`;
            const outputPath = path.join('./Serenade', file);
            console.log(`Downloading ${file}...`);
            await downloadFile(fileUrl, outputPath);
        }

        console.log('Installing dependencies...');
        execSync('cd Serenade && npm install', { stdio: 'inherit' });

        // Prompt for Discord bot token and prefix
        const botToken = await prompt('Enter your Discord bot token (leave blank for default): ');
        const prefix = await prompt('Enter your desired command prefix (default is "!"): ');

        // Update Config.json
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (botToken) config.TOKEN = botToken;
        if (prefix) config.PREFIX = prefix;

        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        console.log('Config.json updated successfully.');

        console.log('Setup complete. You can now run your bot with "node index.js" inside the Serenade directory.');
    } catch (error) {
        console.error('An error occurred:', error.message);
    }
})();
