'use strict';

const KO = {
    noPermission: '\uad8c\ud55c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.',
    title: '\ud83d\udcca \uae09\uc5ec \uac80\uc0ac',
    pending: '\uc2dc\ud2b8 \uc2e4\ud328 \ub300\uae30',
    recentLogs: '\ucd5c\uadfc \uae09\uc5ec \ubc31\uc5c5 \ub85c\uadf8',
    duplicates: '\uc911\ubcf5 \uc758\uc2ec',
    none: '\uc5c6\uc74c',
    endAdena: '\uc5d4\ub4dc\uc544\ub370\ub098',
    deathPenalty: '\ub2e4\uc774\ud328\ub110\ud2f0',
    purchase: '\ud3ec\uc158',
    approve: '\uc2b9\uc778',
    cancel: '\ucde8\uc18c',
    unknown: '\uc54c \uc218 \uc5c6\uc74c'
};

function kindLabel(kind) {
    if (kind === 'end-adena') return KO.endAdena;
    if (kind === 'death-penalty') return KO.deathPenalty;
    if (kind === 'purchase') return KO.purchase;
    return kind || KO.unknown;
}

function actionLabel(action) {
    return action === 'cancel' ? KO.cancel : KO.approve;
}

function countBy(items, fn) {
    const map = new Map();
    for (const item of items || []) {
        const key = fn(item);
        map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function duplicateEntries(logs = []) {
    const byId = new Map();
    for (const item of logs) {
        const key = [
            item.messageId || item.id || 'no-message',
            item.kind || 'sheet',
            item.action || 'write'
        ].join('|');
        if (!byId.has(key)) byId.set(key, []);
        byId.get(key).push(item);
    }
    return [...byId.values()].filter(group => group.length > 1);
}

function formatRecentLog(item) {
    const amount = item.payload?.rawAmount ?? item.payload?.amount ?? 0;
    return `- ${kindLabel(item.kind)} / ${actionLabel(item.action)} / ${item.server || '-'} / ${item.shift || '-'} / ${item.userName || '-'} / ${Number(amount || 0).toLocaleString('en-US')}`;
}

function renderPayrollAudit({ pending = [], logs = [] }) {
    const pendingCounts = countBy(pending, item => kindLabel(item.kind));
    const logCounts = countBy(logs, item => kindLabel(item.kind));
    const duplicates = duplicateEntries(logs);
    const lines = [
        KO.title,
        '',
        `${KO.pending}: ${pending.length}\uac1c`,
        ...(pendingCounts.length ? pendingCounts.map(([label, count]) => `- ${label}: ${count}\uac1c`) : [`- ${KO.none}`]),
        '',
        `${KO.recentLogs}: ${logs.length}\uac1c`,
        ...(logCounts.length ? logCounts.map(([label, count]) => `- ${label}: ${count}\uac1c`) : [`- ${KO.none}`]),
        '',
        `${KO.duplicates}: ${duplicates.length}\uac1c`
    ];

    if (duplicates.length) {
        duplicates.slice(0, 5).forEach(group => {
            const first = group[0];
            lines.push(`- ${kindLabel(first.kind)} / ${first.userName || '-'} / ${first.messageId || first.id || '-'} / ${group.length}\uac1c`);
        });
    }

    const recent = logs.slice(-5).reverse();
    if (recent.length) {
        lines.push('', '[\ucd5c\uadfc \ub85c\uadf8 5\uac1c]');
        recent.forEach(item => lines.push(formatRecentLog(item)));
    }

    if (pending.length) {
        lines.push('', '\u26a0\ufe0f \uc2e4\ud328 \ub300\uae30\uac00 \uc788\uc2b5\ub2c8\ub2e4. `/\uc791\uc5c5\ub300\uae30` \ub610\ub294 `/\uc791\uc5c5\uc7ac\uc2dc\ub3c4`\ub85c \ud655\uc778\ud558\uc138\uc694.');
    }

    return lines.join('\n').slice(0, 1900);
}

function createPayrollAuditCommand({
    MessageFlags,
    opsQueueService,
    payrollOperationLogService,
    canRun
}) {
    if (!MessageFlags) throw new TypeError('MessageFlags must be provided');
    if (!opsQueueService || typeof opsQueueService.list !== 'function') throw new TypeError('opsQueueService.list must be a function');
    if (!payrollOperationLogService || typeof payrollOperationLogService.listRecent !== 'function') throw new TypeError('payrollOperationLogService.listRecent must be a function');
    if (typeof canRun !== 'function') throw new TypeError('canRun must be a function');

    async function execute(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) {
            return interaction.reply({ content: KO.noPermission, flags: MessageFlags.Ephemeral }).then(() => autoDel());
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        if (!interaction.deferred && !interaction.replied) return null;

        const [pending, logs] = await Promise.all([
            opsQueueService.list(),
            payrollOperationLogService.listRecent({ limit: 300 })
        ]);
        return interaction.editReply({ content: renderPayrollAudit({ pending, logs }) }).then(() => autoDel());
    }

    return {
        aliases: ['\uae09\uc5ec\uac80\uc0ac', 'payroll-audit'],
        execute
    };
}

module.exports = {
    createPayrollAuditCommand,
    renderPayrollAudit,
    duplicateEntries
};
