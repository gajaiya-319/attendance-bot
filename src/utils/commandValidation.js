'use strict';

const COMMAND_NAME_PATTERN = /^[-_\p{L}\p{N}]{1,32}$/u;
const ASCII_UPPERCASE_PATTERN = /[A-Z]/;

function commandLabel(command, index) {
    return `${index}:${command?.name || '<missing-name>'}`;
}

function validateOption(option, path, issues) {
    if (!option || typeof option !== 'object') {
        issues.push(`${path}: option must be an object`);
        return;
    }
    if (!option.name) issues.push(`${path}: option name is required`);
    if (!option.description) issues.push(`${path}.${option.name || '<missing-name>'}: option description is required`);
    if (option.name && !COMMAND_NAME_PATTERN.test(option.name)) issues.push(`${path}.${option.name}: option name has invalid characters`);
    if (ASCII_UPPERCASE_PATTERN.test(option.name || '')) issues.push(`${path}.${option.name}: ASCII option names must be lowercase`);
    if ((option.name || '').length > 32) issues.push(`${path}.${option.name}: option name is longer than 32 characters`);
    if ((option.description || '').length > 100) issues.push(`${path}.${option.name}: option description is longer than 100 characters`);
    if (Array.isArray(option.choices) && option.choices.length > 25) issues.push(`${path}.${option.name}: too many choices`);

    if (Array.isArray(option.options)) validateOptions(option.options, `${path}.${option.name}`, issues);
}

function validateOptions(options, path, issues) {
    const seen = new Set();
    let seenOptional = false;
    for (const option of options || []) {
        if (option?.name) {
            if (seen.has(option.name)) issues.push(`${path}: duplicate option name "${option.name}"`);
            seen.add(option.name);
        }
        if (option?.required && seenOptional) {
            issues.push(`${path}.${option.name}: required options must appear before optional options`);
        }
        if (!option?.required) seenOptional = true;
        validateOption(option, path, issues);
    }
}

function validateCommandPayloads(commands) {
    const issues = [];
    const seen = new Set();
    if (!Array.isArray(commands)) return ['commands payload must be an array'];
    if (commands.length > 100) issues.push(`too many guild commands: ${commands.length}/100`);

    commands.forEach((command, index) => {
        const label = commandLabel(command, index);
        if (!command?.name) issues.push(`${label}: command name is required`);
        if (command?.name && seen.has(command.name)) issues.push(`${label}: duplicate command name`);
        if (command?.name) seen.add(command.name);
        if (command?.name && !COMMAND_NAME_PATTERN.test(command.name)) issues.push(`${label}: command name has invalid characters`);
        if (ASCII_UPPERCASE_PATTERN.test(command?.name || '')) issues.push(`${label}: ASCII command names must be lowercase`);
        if ((command?.name || '').length > 32) issues.push(`${label}: command name is longer than 32 characters`);
        if (!command?.description) issues.push(`${label}: command description is required`);
        if ((command?.description || '').length > 100) issues.push(`${label}: command description is longer than 100 characters`);
        if (Array.isArray(command?.options) && command.options.length > 25) issues.push(`${label}: too many options`);
        validateOptions(command?.options || [], label, issues);
    });

    return issues;
}

function flattenDiscordErrors(errors, prefix = '') {
    const lines = [];
    if (!errors || typeof errors !== 'object') return lines;
    for (const [key, value] of Object.entries(errors)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value?._errors) {
            for (const detail of value._errors) {
                lines.push(`${path}: ${detail.message || detail.code || 'Invalid value'}`);
            }
        }
        lines.push(...flattenDiscordErrors(value, path));
    }
    return lines;
}

function formatDiscordRestError(error, commands = []) {
    const lines = [
        `${error?.name || 'DiscordRESTError'} ${error?.code || ''} ${error?.status || ''}`.trim(),
        error?.message || error?.rawError?.message || 'Unknown Discord REST error'
    ];
    const flattened = flattenDiscordErrors(error?.rawError?.errors || error?.errors);
    for (const line of flattened) {
        const match = line.match(/^(\d+)(?:\.|:)/);
        const index = match ? Number(match[1]) : null;
        const command = Number.isInteger(index) ? commands[index] : null;
        lines.push(command ? `${line} [command=${command.name}]` : line);
    }
    return lines.filter(Boolean).join('\n');
}

module.exports = {
    validateCommandPayloads,
    formatDiscordRestError
};
