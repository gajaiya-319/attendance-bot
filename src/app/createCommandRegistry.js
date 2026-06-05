'use strict';

const { createSlashCommands } = require('./createSlashCommands');
const { createInteractionHandlers } = require('./createInteractionHandlers');

function createCommandRegistry(ctx) {
    const slash = createSlashCommands(ctx);
    const interactions = createInteractionHandlers({ ...ctx, slash });

    return {
        ...slash,
        ...interactions,
        dayOffRequestInteractions: ctx.services.dayOffRequestInteractions
    };
}

module.exports = { createCommandRegistry };
