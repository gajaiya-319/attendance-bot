const assert = require('assert');
const {
    buildCommandDefinitions,
    hiddenCommandAliases
} = require('../src/commands/definitions');
const {
    validateCommandPayloads,
    formatDiscordRestError
} = require('../src/utils/commandValidation');

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
    for (const option of command.options || []) validateOption(option, command.name);
}

assert.deepStrictEqual(validateCommandPayloads(visibleCommands), [], 'visible command payloads must pass preflight validation');

{
    const invalid = [{
        name: 'BadName',
        description: 'Invalid uppercase command',
        options: [
            { name: 'optional', description: 'Optional first', required: false },
            { name: 'required', description: 'Required second', required: true }
        ]
    }];
    const issues = validateCommandPayloads(invalid);
    assert(issues.some(issue => issue.includes('ASCII command names must be lowercase')), 'validation catches uppercase command names');
    assert(issues.some(issue => issue.includes('required options must appear before optional options')), 'validation catches required option order');
}

{
    const formatted = formatDiscordRestError({
        name: 'DiscordAPIError',
        code: 50035,
        status: 400,
        message: 'Invalid Form Body',
        rawError: { errors: { 0: { name: { _errors: [{ message: 'Invalid command name' }] } } } }
    }, [{ name: 'bad-command' }]);
    assert(formatted.includes('bad-command'), 'REST formatter annotates failing command index');
    assert(formatted.includes('Invalid command name'), 'REST formatter includes Discord validation message');
}

const opsCheckKo = '\uc6b4\uc601\uc810\uac80';
const pendingKo = '\uc791\uc5c5\ub300\uae30';
const retryKo = '\uc791\uc5c5\uc7ac\uc2dc\ub3c4';
const payrollRecordKo = '\uae09\uc5ec\uae30\ub85d';
const forceEarlyOutKo = '\uac15\uc81c\uc870\uae30\ud1f4\uadfc';

assert(commandNames.includes(opsCheckKo));
assert(commandNames.includes('ops-check'));
assert(hiddenCommandAliases.has('ops-check'));
assert(visibleNames.includes(opsCheckKo));
assert(!visibleNames.includes('ops-check'));

assert(commandNames.includes(pendingKo));
assert(commandNames.includes('ops-pending'));
assert(hiddenCommandAliases.has('ops-pending'));
assert(visibleNames.includes(pendingKo));
assert(!visibleNames.includes('ops-pending'));

assert(commandNames.includes(retryKo));
assert(commandNames.includes('ops-retry'));
assert(hiddenCommandAliases.has('ops-retry'));
assert(visibleNames.includes(retryKo));
assert(!visibleNames.includes('ops-retry'));

assert(commandNames.includes(payrollRecordKo));
assert(!hiddenCommandAliases.has(payrollRecordKo));
assert(visibleNames.includes(payrollRecordKo));
assert(!commandNames.includes('ranking'));

assert(commandNames.includes(forceEarlyOutKo));
assert(visibleNames.includes(forceEarlyOutKo));
assert(commandNames.includes('dayoff-panel'));
assert(visibleNames.includes('dayoff-panel'));
for (const alias of ['force-in', 'force-out', 'force-early-out', 'force-off', 'force-ot']) {
    assert(commandNames.includes(alias), `${alias} hidden command definition is present`);
    assert(hiddenCommandAliases.has(alias), `${alias} is hidden from visible registration`);
    assert(!visibleNames.includes(alias), `${alias} is not registered as a visible command`);
}

const setAnnounce = commands.find(command => command.name === '\uacf5\uc9c0\uc124\uc815')?.toJSON();
if (setAnnounce) assert.deepStrictEqual(setAnnounce.options.map(option => option.name), ['slot', 'target', 'time', 'content', 'target2']);

const cancelAnnounce = commands.find(command => command.name === '\uacf5\uc9c0\ucde8\uc18c')?.toJSON();
if (cancelAnnounce) assert.deepStrictEqual(cancelAnnounce.options.map(option => option.name), ['slot']);

console.log('command-definitions tests passed');
