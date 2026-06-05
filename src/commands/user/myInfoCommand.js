'use strict';

function createMyInfoCommand({
    EmbedBuilder,
    MessageFlags,
    safeAddFields,
    getAttendanceData
}) {
    if (typeof EmbedBuilder !== 'function') throw new TypeError('EmbedBuilder must be a constructor');
    if (typeof safeAddFields !== 'function') throw new TypeError('safeAddFields must be a function');
    if (typeof getAttendanceData !== 'function') throw new TypeError('getAttendanceData must be a function');

    async function execute(interaction) {
        const user = getAttendanceData()[interaction.user.id];
        if (!user) {
            return interaction.reply({
                content: 'No data.',
                flags: MessageFlags.Ephemeral
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`${user.name} STATUS`)
            .setColor('#2ECC71');

        safeAddFields(embed,
            { name: 'Total Points', value: `${user.points || 0} Pts`, inline: true },
            {
                name: 'Attendance Summary',
                value: [
                    `Normal: ${user.totalNormal || 0}`,
                    `Late: ${user.totalLate || 0}`,
                    `Absent: ${user.totalAbsent || 0}`,
                    `Early Out: ${user.totalEarly || 0}`,
                    `Overtime: ${user.totalOT || 0}`,
                    `Day Off: ${user.offCount || 0}`
                ].join('\n'),
                inline: false
            }
        );

        return interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
        });
    }

    return {
        aliases: ['my-info', '내정보'],
        execute
    };
}

module.exports = {
    createMyInfoCommand
};
