const assert = require('assert');
const {
    buildCommandDefinitions,
    hiddenCommandAliases
} = require('../src/commands/definitions');

const commands = buildCommandDefinitions();
const commandNames = commands.map(command => command.name);
const visibleNames = commandNames.filter(name => !hiddenCommandAliases.has(name));

assert(commandNames.includes('라이브예외'));
assert(commandNames.includes('live-exception'));
assert(hiddenCommandAliases.has('live-exception'));
assert(!visibleNames.includes('live-exception'));
assert(visibleNames.includes('라이브예외'));
assert(commandNames.includes('통합랭킹'));
assert(commandNames.includes('combined-ranking'));
assert(hiddenCommandAliases.has('combined-ranking'));
assert(visibleNames.includes('통합랭킹'));
assert(!visibleNames.includes('combined-ranking'));
assert(!commandNames.includes('랭킹'));
assert(!commandNames.includes('ranking'));

const setAnnounce = commands.find(command => command.name === '공지설정').toJSON();
assert.deepStrictEqual(setAnnounce.options.map(option => option.name), ['slot', 'target', 'time', 'content', 'target2']);

const cancelAnnounce = commands.find(command => command.name === '공지취소').toJSON();
assert.deepStrictEqual(cancelAnnounce.options.map(option => option.name), ['slot']);

console.log('command-definitions tests passed');
