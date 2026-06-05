'use strict';

const assert = require('assert');

assert.strictEqual(typeof require('../src/app/appDependencies').CONFIG, 'object');
assert.strictEqual(typeof require('../src/app/createBotState').createBotState, 'function');
assert.strictEqual(typeof require('../src/app/createCoreHelpers').createCoreHelpers, 'function');
assert.strictEqual(typeof require('../src/app/createCommandRegistry').createCommandRegistry, 'function');
assert.strictEqual(typeof require('../src/app/wireWorkflowRuntime').wireWorkflowRuntimeForApp, 'function');
assert.strictEqual(typeof require('../src/app/registerDiscordHandlers').registerDiscordHandlers, 'function');
assert.strictEqual(typeof require('../src/app/createReportContext').createReportContext, 'function');
assert.strictEqual(typeof require('../src/app/createServiceLayer').createServiceLayer, 'function');
assert.strictEqual(typeof require('../src/app/createSlashCommands').createSlashCommands, 'function');
assert.strictEqual(typeof require('../src/app/createInteractionHandlers').createInteractionHandlers, 'function');
assert.strictEqual(typeof require('../src/app/finalizeBotApp').finalizeBotApp, 'function');

console.log('app-phase6-modules tests passed');
