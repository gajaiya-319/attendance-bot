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

console.log('command-definitions tests passed');
