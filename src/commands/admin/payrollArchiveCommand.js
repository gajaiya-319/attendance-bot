'use strict';

function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function createPayrollArchiveCommand({
    MessageFlags,
    payrollArchiveService,
    payrollOperationLogService = null,
    isOwner
}) {
    if (!MessageFlags) throw new TypeError('MessageFlags must be provided');
    if (!payrollArchiveService || typeof payrollArchiveService.saveCurrent !== 'function') {
        throw new TypeError('payrollArchiveService.saveCurrent must be a function');
    }
    if (typeof isOwner !== 'function') throw new TypeError('isOwner must be a function');

    async function execute(interaction, { autoDel = () => {} } = {}) {
        if (!isOwner(interaction.user?.id || interaction.member?.id)) {
            return interaction.reply({
                content: '서버주인만 /급여기록으로 Raw_Data에 마감할 수 있습니다.',
                flags: MessageFlags.Ephemeral
            }).then(() => autoDel());
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        if (!interaction.deferred && !interaction.replied) return null;

        const periodLabel = interaction.options?.getString?.('기간') || interaction.options?.getString?.('period') || null;
        const savedBy = interaction.user?.tag || interaction.user?.username || interaction.member?.displayName || interaction.user?.id;
        const result = await payrollArchiveService.saveCurrent({
            periodLabel,
            savedBy: 'GREAT 수동저장',
            trigger: 'discord-급여기록'
        });

        if (payrollOperationLogService && typeof payrollOperationLogService.record === 'function') {
            await payrollOperationLogService.record({
                kind: 'payroll-archive',
                action: 'discord-command',
                userName: savedBy,
                payload: {
                    periodLabel: periodLabel || null,
                    ok: result.ok,
                    code: result.code || null,
                    row: result.row,
                    source: result.source
                },
                source: 'payroll-archive-command'
            });
        }

        if (!result.ok) {
            const message = result.code === 'archive-in-progress'
                ? '다른 급여기록 저장이 진행 중입니다. 잠시 후 다시 시도해주세요.'
                : result.code === 'summary-not-ready' || String(result.code || '').includes('not-ready')
                    ? '현재 정산표 값이 아직 준비되지 않았습니다. Paagrio/Heine Great 탭 합계 행을 확인하거나 createPerfectPayrollSheets를 실행했는지 확인해주세요.'
                    : `급여 기록 실패: ${result.code}`;
            return interaction.editReply({ content: message }).then(() => autoDel());
        }

        const completionLabel = result.corrected
            ? '급여 기록 정정 완료'
            : result.recoveredClosedPeriod
                ? '누락 급여 기록 복구 완료'
                : '급여 기록 완료';
        const lines = [
            `${completionLabel}: ${result.periodLabel}`,
            `저장 위치: ${result.sheet || 'Raw_Data'} ${result.row}행 (${result.source || 'great-tabs'})`,
            '최근_3일_요약=Great 실시간 · 월간_누적_요약=Raw_Data 합계. Great 탭 초기화 전에 /급여기록 실행하세요.',
            ...result.saved.map(row => `${row.server}: 아데나 ${formatNumber(row.totalAdena)} / 급여 ${formatNumber(row.grossSalary)} / 직원 ${formatNumber(row.playerShare)} / 오너 ${formatNumber(row.ownerShare)} / 페소 ${formatNumber(row.totalPeso)}`)
        ];
        return interaction.editReply({ content: lines.join('\n') }).then(() => autoDel());
    }

    return {
        aliases: ['급여기록', 'payroll-record'],
        execute
    };
}

module.exports = {
    createPayrollArchiveCommand,
    formatNumber
};
