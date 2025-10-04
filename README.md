# README

1. Install NodeJS and NPM
2. Clone the repo (<https://github.com/humanat/takBot>)
3. Run `npm i`
4. Run `git submodule init && git submodule sync && git submodule update`
5. Run `pushd TPS-Ninja && npm i && popd`
6. Run `cp config.json.template config.json; cp results.db.template results.db`
7. Make your own application through Discord (<https://discord.com/developers/applications>)
8. Copy the token from the Bot page and paste it in `config.json` after `token`.
9. Copy the Application ID from the General Information page and paste it in `auth.json` after `clientId`.
10. Choose the default settings for your server if desired
11. Run `node deploy-commands`
12. Run `node bot` (`Ctrl+C` to end)
13. Invite your bot to your own Discord server by generating an invite link from the OAuth2 page of the Discord portal
    1. Add redirect URL `https://discordapp.com/oauth2/authorize?&client_id=<ClientID>&scope=bot` with your client ID.
    2. Select scopes `bot` and `messages.read`
    3. Add the `Message Content Intent` in the Bot tab
    4. Select the appropriate permissions
    5. Press the Copy button in the Scopes section
    6. Paste into a new browser tab
