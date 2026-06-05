'use strict';

const { wireWorkflowRuntimeForApp } = require('./wireWorkflowRuntime');
const { registerDiscordHandlers } = require('./registerDiscordHandlers');

function finalizeBotApp({ wireCtx, discordCtx }) {
    wireWorkflowRuntimeForApp(wireCtx);
    return registerDiscordHandlers(discordCtx);
}

module.exports = { finalizeBotApp };
