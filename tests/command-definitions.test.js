const assert = require('assert');
const {
    buildCommandDefinitions,
    hiddenCommandAliases
} = require('../src/commands/definitions');

const commands = buildCommandDefinitions();
const commandNames = commands.map(command => command.name);
const visibleNames = commandNames.filter(name => !hiddenCommandAliases.has(name));
const visibleCommands = commands.filter(command => !hiddenCommandAliases.has(command.name)).map(command => command.toJSON());

function assertUnique(values, label) {
    const seen = new Set();
    for (const value of values) {
        assert(!seen.has(value), `${label} must be unique: ${value}`);
        seen.add(value);
    }
}

function validateOption(option, path) {
    assert(option.name, `${path} option name is required`);
    assert(option.description, `${path}.${option.name} option description is required`);
    assert(option.name.length <= 32, `${path}.${option.name} option name too long`);
    assert(option.description.length <= 100, `${path}.${option.name} option description too long`);
    assert(!Array.isArray(option.choices) || option.choices.length <= 25, `${path}.${option.name} has too many choices`);

    if (Array.isArray(option.choices)) {
        assertUnique(option.choices.map(choice => choice.name), `${path}.${option.name} choice names`);
        assertUnique(option.choices.map(choice => String(choice.value)), `${path}.${option.name} choice values`);
        for (const choice of option.choices) {
            assert(choice.name.length <= 100, `${path}.${option.name} choice name too long`);
            assert(String(choice.value).length <= 100, `${path}.${option.name} choice value too long`);
        }
    }
}

assert(commands.length <= 100, 'total command definitions must fit Discord limit');
assert(visibleCommands.length <= 100, 'visible guild commands must fit Discord limit');
assertUnique(commandNames, 'command names');
assertUnique(visibleNames, 'visible command names');

for (const command of visibleCommands) {
    assert(command.name.length >= 1 && command.name.length <= 32, `${command.name} command name length invalid`);
    assert(command.description.length >= 1 && command.description.length <= 100, `${command.name} description length invalid`);
    assert(!Array.isArray(command.options) || command.options.length <= 25, `${command.name} has too many options`);
    assertUnique((command.options || []).map(option => option.name), `${command.name} option names`);
    for (const option of command.options || []) {
        validateOption(option, command.name);
    }
}

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
assert(commandNames.includes('운영점검'));
assert(commandNames.includes('ops-check'));
assert(hiddenCommandAliases.has('ops-check'));
assert(visibleNames.includes('운영점검'));
assert(!visibleNames.includes('ops-check'));
assert(commandNames.includes('상태추적'));
assert(commandNames.includes('status-trace'));
assert(hiddenCommandAliases.has('status-trace'));
assert(visibleNames.includes('상태추적'));
assert(!visibleNames.includes('status-trace'));
assert(commandNames.includes('상태동기화'));
assert(commandNames.includes('status-sync'));
assert(hiddenCommandAliases.has('status-sync'));
assert(visibleNames.includes('상태동기화'));
assert(!visibleNames.includes('status-sync'));
assert(!commandNames.includes('랭킹'));
assert(!commandNames.includes('ranking'));

const setAnnounce = commands.find(command => command.name === '공지설정').toJSON();
assert.deepStrictEqual(setAnnounce.options.map(option => option.name), ['slot', 'target', 'time', 'content', 'target2']);

const cancelAnnounce = commands.find(command => command.name === '공지취소').toJSON();
assert.deepStrictEqual(cancelAnnounce.options.map(option => option.name), ['slot']);

console.log('command-definitions tests passed');
