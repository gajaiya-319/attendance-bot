'use strict';

const nodeFs = require('fs').promises;
const {
    buildLiveOffGuidanceDm,
    buildFinishedLiveOffReminderDm
} = require('../utils/attendanceDmMessages');

function createDayOffWorkflow(deps) {
    const {
        client,
        CONFIG,
        moment,
        EmbedBuilder,
        dayOffService,
        roleService,
        getDayOffReservations,
        getAttendanceData,
        removeOvertimeUser,
        saveSystemAsync,
        ensureUserData,
        applyDayOffState,
        clearDayOffReservationState,
        appendAttendanceEvent,
        updateWorkingRole,
        queueDashboardRender,
        getDayOffLogicalDateForShift,
        buildShiftBoundsForBusinessDate,
        getShiftBounds,
        getDayOffPanelPayload,
        DAY_OFF_REQUEST_CUSTOM_IDS,
        reactionCleanupLocks,
        fs = nodeFs,
        logger = console
    } = deps;

async function sendTemporaryDayOffReply(message, content) {
    const reply = await message.reply({ content, allowedMentions: { users: [message.author.id], roles: [], repliedUser: true } })
        .catch(e => {
            console.error('[DAYOFF REPLY ERROR]', e);
            return null;
        });
    if (reply) setTimeout(() => reply.delete().catch(() => {}), 5000);
}

function isReactionBlockedError(error) {
    return error?.code === 90001 || error?.rawError?.code === 90001;
}

async function setDayOffStatusEmoji(message, emoji) {
    await message.fetch().catch(() => null);
    reactionCleanupLocks.add(message.id);
    for (const statusEmoji of dayOffService.DAYOFF_STATUS_EMOJIS) {
        const reaction = message.reactions.cache.find(r => r.emoji.name === statusEmoji);
        if (reaction) {
            await reaction.remove().catch(async () => {
                await reaction.users.remove(client.user.id).catch(() => {});
            });
        }
    }
    let result = { ok: true };
    if (emoji) {
        result = await message.react(emoji)
            .then(() => ({ ok: true }))
            .catch(e => {
                console.error('[DAYOFF REACT ERROR]', e);
                return {
                    ok: false,
                    code: e?.code || e?.rawError?.code || null,
                    reactionBlocked: isReactionBlockedError(e),
                    message: e?.message || 'reaction failed'
                };
            });
    }
    setTimeout(() => reactionCleanupLocks.delete(message.id), 5000);
    return result;
}

async function sendDayOffStatusFallback(message, reservation, statusLabel, emoji) {
    if (!reservation) return false;
    const content = [
        `${emoji} Day-off status: ${statusLabel}`,
        `Name: ${reservation.name}`,
        `Shift: ${reservation.shiftLabel}`,
        `Leave Date: ${reservation.leaveDate}`,
        statusLabel === 'Pending'
            ? 'This request has been received and is waiting for manager approval.'
            : null
    ].filter(Boolean).join('\n');
    let fallbackMessage = null;
    if (reservation.statusFallbackMessageId) {
        fallbackMessage = await message.channel?.messages?.fetch(reservation.statusFallbackMessageId)
            .catch(() => null);
        if (fallbackMessage) {
            await fallbackMessage.edit({ content }).catch(e => {
                console.error('[DAYOFF STATUS FALLBACK EDIT ERROR]', e);
                fallbackMessage = null;
            });
        }
    }
    if (!fallbackMessage) {
        fallbackMessage = await message.reply({
            content,
            allowedMentions: { users: [message.author.id], roles: [], repliedUser: false }
        }).catch(e => {
            console.error('[DAYOFF STATUS FALLBACK ERROR]', e);
            return null;
        });
    }
    if (!fallbackMessage) return false;
    await fallbackMessage.fetch().catch(() => null);
    reactionCleanupLocks.add(fallbackMessage.id);
    for (const statusEmoji of dayOffService.DAYOFF_STATUS_EMOJIS) {
        const reaction = fallbackMessage.reactions.cache.find(r => r.emoji.name === statusEmoji);
        if (reaction) {
            await reaction.remove().catch(async () => {
                await reaction.users.remove(client.user.id).catch(() => {});
            });
        }
    }
    await fallbackMessage.react(emoji).catch(e => console.error('[DAYOFF STATUS FALLBACK REACT ERROR]', e));
    setTimeout(() => reactionCleanupLocks.delete(fallbackMessage.id), 5000);
    reservation.statusFallbackMessageId = fallbackMessage.id;
    reservation.statusFallbackType = statusLabel;
    reservation.statusFallbackAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    getDayOffReservations()[reservation.messageId] = reservation;
    await saveSystemAsync();
    await appendDayOffAudit('STATUS_FALLBACK_SENT', {
        messageId: reservation.messageId,
        fallbackMessageId: fallbackMessage.id,
        userId: reservation.userId,
        name: reservation.name,
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        status: statusLabel
    });
    return true;
}

async function writeDayOffLog(text) {
    const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    if (logChan) await logChan.send(text).catch(e => console.error('[DAYOFF LOG ERROR]', e));
}

async function appendDayOffAudit(event, payload = {}) {
    try {
        await fs.mkdir('./logs', { recursive: true });
        const record = {
            time: moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm:ss'),
            event,
            ...payload
        };
        await fs.appendFile(CONFIG.FILES.DAYOFF_LOG, `${JSON.stringify(record)}\n`);
    } catch (e) {
        console.error('[DAYOFF AUDIT LOG ERROR]', e);
    }
}

async function readDayOffLog(limit = 10) {
    try {
        const raw = await fs.readFile(CONFIG.FILES.DAYOFF_LOG, 'utf8');
        return raw.trim().split(/\r?\n/).filter(Boolean).slice(-limit);
    } catch {
        return [];
    }
}

async function notifyDayOffReviewer(reservation) {
    const notifyKey = `${reservation.messageId}:${reservation.leaveDate}:${reservation.shift}:pending`;
    if (reservation.reviewerNotifyKey === notifyKey) return 'already-sent';

    const leaveText = moment.tz(reservation.leaveDate, 'YYYY-MM-DD', CONFIG.TIMEZONE).format('YYYY-MM-DD');
    const text = [
        '📋 휴무 신청 검토 필요',
        `이름: ${reservation.name}`,
        reservation.nameMismatch ? `작성 이름: ${reservation.submittedName}` : null,
        reservation.nameMismatch ? '⚠️ 작성 이름과 Discord 닉네임이 다릅니다. 공식 대상은 Discord 작성자 기준으로 처리됩니다.' : null,
        `근무조: ${reservation.shiftLabel}`,
        `휴무일: ${leaveText}`,
        '',
        `${reservation.name} 님이 ${leaveText} 자로 휴무를 신청했습니다.`,
        '승인하려면 이모지 반응을 남겨주세요.'
    ].filter(line => line !== null).join('\n');

    let dmStatus = '리뷰어 미설정';
    if (CONFIG.DAYOFF_REVIEWER_ID) {
        const reviewer = await client.users.fetch(CONFIG.DAYOFF_REVIEWER_ID).catch(() => null);
        if (reviewer) {
            await reviewer.send(text).then(() => {
                dmStatus = '발송 완료';
            }).catch(e => {
                console.error('[DAYOFF REVIEWER DM ERROR]', e);
                dmStatus = '발송 실패';
            });
        } else {
            dmStatus = '유저 찾을 수 없음';
        }
    }

    reservation.reviewerNotifyKey = notifyKey;
    reservation.reviewerNotifiedAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    reservation.reviewerDmStatus = dmStatus;
    getDayOffReservations()[reservation.messageId] = reservation;
    await saveSystemAsync();
    await writeDayOffLog(`${text}\nDM 상태: ${dmStatus}`);
    await appendDayOffAudit('REQUESTED', {
        messageId: reservation.messageId,
        userId: reservation.userId,
        name: reservation.name,
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        reviewerId: CONFIG.DAYOFF_REVIEWER_ID,
        reviewerDmStatus: dmStatus
    });
    return dmStatus;
}

function dayOffReservationToParsed(reservation) {
    if (!reservation) return null;
    return {
        ok: true,
        code: 'valid',
        emoji: '❌',
        displayName: reservation.name,
        submittedName: reservation.submittedName || reservation.name,
        nameMismatch: Boolean(reservation.nameMismatch),
        shift: reservation.shift,
        shiftLabel: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        userId: reservation.userId
    };
}

function getDayOffReservationUserId(message, parsed = null) {
    return parsed?.userId || getDayOffReservations()[message?.id]?.userId || message?.author?.id || null;
}

async function fetchDayOffReservationUser(reservation) {
    if (!reservation?.userId) return null;
    return client.users.fetch(reservation.userId).catch(() => null);
}

async function saveDayOffReservation(message, parsed, status, approver = null) {
    const previous = getDayOffReservations()[message.id] || {};
    const userId = parsed.userId || previous.userId || message.author.id;
    const reservation = {
        ...previous,
        id: message.id,
        messageId: message.id,
        channelId: message.channelId,
        userId,
        name: parsed.displayName,
        submittedName: parsed.submittedName || null,
        nameMismatch: Boolean(parsed.nameMismatch),
        shift: parsed.shift,
        shiftLabel: parsed.shiftLabel,
        leaveDate: parsed.leaveDate,
        status,
        approvedBy: approver?.id || previous.approvedBy || null,
        approvedByName: approver?.displayName || approver?.user?.username || previous.approvedByName || null,
        updatedAt: moment().tz(CONFIG.TIMEZONE).toISOString()
    };
    getDayOffReservations()[message.id] = reservation;
    await saveSystemAsync();
    return reservation;
}

function isDayOffRequestPanelMessage(message) {
    if (!message?.author?.bot) return false;
    return message.components?.some(row =>
        row.components?.some(component => component.customId === DAY_OFF_REQUEST_CUSTOM_IDS.openModal)
    );
}

async function repostDayOffRequestPanel(channel, exceptMessageId = null) {
    if (!channel?.messages?.fetch || !channel?.send) return null;
    const recentMessages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    if (recentMessages) {
        const panelMessages = [...recentMessages.values()]
            .filter(message => message.id !== exceptMessageId && isDayOffRequestPanelMessage(message));
        for (const panelMessage of panelMessages) {
            await panelMessage.delete().catch(error => {
                console.error('[DAYOFF PANEL DELETE ERROR]', error);
            });
        }
    }
    return channel.send(getDayOffPanelPayload()).catch(error => {
        console.error('[DAYOFF PANEL REPOST ERROR]', error);
        return null;
    });
}

async function submitDayOffRequestFromInteraction({
    interaction,
    submittedName,
    leaveDate,
    shift,
    shiftLabel,
    reason
}) {
    const requestUserId = interaction.user?.id;
    const displayName = (interaction.member?.displayName || interaction.user?.username || submittedName || 'Unknown').trim();
    const displayBaseName = roleService.getWorkerNicknameBase(displayName || submittedName || 'Unknown');
    const submittedBaseName = roleService.getWorkerNicknameBase(submittedName || displayBaseName);
    const duplicate = Object.values(getDayOffReservations()).find(r =>
        r &&
        ['pending', 'approved'].includes(r.status) &&
        r.userId === requestUserId &&
        r.leaveDate === leaveDate &&
        r.shift === shift
    );
    if (duplicate) {
        return {
            ok: false,
            message: `A day-off request already exists for ${leaveDate} (${shiftLabel}).`
        };
    }

    const channelId = dayOffService.getDayOffChannelId();
    const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.send) {
        return { ok: false, message: 'Day-off channel not found.' };
    }

    const parsed = {
        ok: true,
        code: 'valid',
        emoji: '❌',
        displayName,
        submittedName,
        nameMismatch: Boolean(
            submittedName &&
            dayOffService.normalizeDayOffName(submittedName) &&
            dayOffService.normalizeDayOffName(submittedName) !== dayOffService.normalizeDayOffName(displayName)
        ),
        shift,
        shiftLabel,
        leaveDate,
        userId: requestUserId
    };

    const embed = new EmbedBuilder()
        .setTitle('Day Off Request')
        .setColor('#3B82F6')
        .setDescription([
            `👤 Applicant: <@${requestUserId}>`,
            '```',
            `🏷️ Name   : ${submittedBaseName || displayBaseName || 'Unknown'}`,
            `🕒 Shift  : ${shiftLabel}`,
            `📅 Date   : ${leaveDate}`,
            `📝 Reason : ${reason}`,
            '```'
        ].join('\n'))
        .setFooter({ text: 'React with ✅ to approve.' })
        .setTimestamp();
    const message = await channel.send({
        embeds: [embed],
        allowedMentions: { users: [], roles: [] }
    }).catch(error => {
        console.error('[DAYOFF MODAL MESSAGE ERROR]', error);
        return null;
    });
    if (!message) return { ok: false, message: 'Could not post the day-off request.' };

    const reservation = await saveDayOffReservation(message, parsed, 'pending');
    reservation.reason = reason;
    reservation.source = 'modal';
    reservation.requestedBy = requestUserId;
    reservation.requestedByName = displayName;
    reservation.requestedAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    getDayOffReservations()[reservation.messageId] = reservation;
    await saveSystemAsync();

    const statusEmojiResult = await setDayOffStatusEmoji(message, '⏳');
    if (!statusEmojiResult.ok && statusEmojiResult.reactionBlocked) {
        await sendDayOffStatusFallback(message, reservation, 'Pending', '⏳');
    }
    await notifyDayOffReviewer(reservation);
    await repostDayOffRequestPanel(channel, message.id);

    return {
        ok: true,
        message: `Your day-off request has been submitted and is waiting for approval.\nShift: ${shiftLabel}\nLeave Date: ${leaveDate}`
    };
}

async function processDayOffMessage(message, { silent = false } = {}) {
    if (!dayOffService.isDayOffChannel(message) || message.author?.bot) return;
    const parsed = dayOffService.parseDayOffRequest(message);

    if (!parsed.ok) {
        delete getDayOffReservations()[message.id];
        await setDayOffStatusEmoji(message, parsed.emoji);
        await saveSystemAsync();

        // ✨ [업데이트] 이름 누락 경고 
        if (parsed.code === 'missing-name') {
            if (!silent) await sendTemporaryDayOffReply(message, `${message.author} Username cannot be blank. Please explicitly provide your name in the request format.`);
            await writeDayOffLog(`❌ 휴무 신청 실패\n👥 대상: ${parsed.displayName}\n📝 사유: 이름이 공란입니다.`);
            await appendDayOffAudit('FAILED', {
                messageId: message.id,
                userId: message.author.id,
                name: parsed.displayName,
                reason: 'missing-name'
            });
        } else if (parsed.code === 'invalid-month') {
            if (!silent) await sendTemporaryDayOffReply(message, `${message.author} The month name is invalid. Please check the English spelling. Example: May, Dec`);
            await writeDayOffLog(`❌ 휴무 신청 실패\n👥 이름: ${parsed.displayName}\n📝 사유: 월 이름이 올바르지 않습니다.\n⏰ 처리 시간: ${moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm')}`);
            await appendDayOffAudit('FAILED', {
                messageId: message.id,
                userId: message.author.id,
                name: parsed.displayName,
                reason: 'invalid-month'
            });
        } else {
            if (!silent) await sendTemporaryDayOffReply(message, `${message.author} I could not find a valid leave date. Please use this format exactly: Leave date: May 21`);
            await writeDayOffLog(`❌ 휴무 신청 실패\n👥 이름: ${parsed.displayName}\n📝 사유: 휴무 날짜 또는 근무 구분을 찾지 못했습니다.\n⏰ 처리 시간: ${moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm')}`);
            await appendDayOffAudit('FAILED', {
                messageId: message.id,
                userId: message.author.id,
                name: parsed.displayName,
                reason: parsed.code
            });
        }
        return;
    }

    const existingReservation = getDayOffReservations()[message.id];
    if (existingReservation?.status === 'approved' && dayOffService.hasApprovalReaction(message)) {
        await approveDayOffMessage(message, null, parsed, silent);
        return;
    }

    const reservation = await saveDayOffReservation(message, parsed, 'pending');
    const statusEmojiResult = await setDayOffStatusEmoji(message, '⏳');
    if (!statusEmojiResult.ok && statusEmojiResult.reactionBlocked) {
        await sendDayOffStatusFallback(message, reservation, 'Pending', '⏳');
    }
    if (!silent) {
        const nameNotice = parsed.nameMismatch
            ? `\nNote: The name in your form (${parsed.submittedName}) is different from your Discord name. Your request will be processed under your Discord name: ${parsed.displayName}.`
            : '';
        await sendTemporaryDayOffReply(message, `${message.author} Your day-off request has been received and is waiting for manager approval.\nShift: ${parsed.shiftLabel}\nLeave Date: ${parsed.leaveDate}${nameNotice}`);
        await notifyDayOffReviewer(reservation);
    }
}

async function approveDayOffMessage(message, approverMember = null, parsed = null, silent = false) {
    if (!dayOffService.isDayOffChannel(message)) return;
    const existingReservation = getDayOffReservations()[message.id];
    if (message.author?.bot && !existingReservation) return;
    const freshParsed = parsed || dayOffReservationToParsed(existingReservation) || dayOffService.parseDayOffRequest(message);
    if (!freshParsed.ok) {
        await processDayOffMessage(message, { silent });
        return;
    }
    const requestUserId = getDayOffReservationUserId(message, freshParsed);

    const duplicate = Object.values(getDayOffReservations()).find(r =>
        r &&
        r.messageId !== message.id &&
        ['pending', 'approved'].includes(r.status) &&
        r.userId === requestUserId &&
        r.leaveDate === freshParsed.leaveDate &&
        r.shift === freshParsed.shift
    );
    if (duplicate) {
        if (duplicate.status === 'pending' && dayOffService.hasApprovalText(message)) {
            duplicate.status = 'cancelled';
            duplicate.cancelledAt = moment().tz(CONFIG.TIMEZONE).toISOString();
            duplicate.cancelledBy = CONFIG.DAYOFF_REVIEWER_ID || 'system';
            duplicate.cancelledByName = 'Superseded by approved request text';
            duplicate.cancelReason = `Superseded by approved request message ${message.id}`;
            getDayOffReservations()[duplicate.messageId] = duplicate;
            await saveSystemAsync();
            await appendDayOffAudit('DUPLICATE_PENDING_SUPERSEDED', {
                messageId: duplicate.messageId,
                supersededByMessageId: message.id,
                userId: requestUserId,
                name: freshParsed.displayName,
                shift: freshParsed.shiftLabel,
                leaveDate: freshParsed.leaveDate
            });
        } else {
        const statusEmojiResult = await setDayOffStatusEmoji(message, '❌');
        if (!statusEmojiResult.ok && statusEmojiResult.reactionBlocked) {
            const duplicateBlockReservation = {
                id: message.id,
                messageId: message.id,
                channelId: message.channelId,
                userId: requestUserId,
                name: freshParsed.displayName,
                submittedName: freshParsed.submittedName || null,
                nameMismatch: Boolean(freshParsed.nameMismatch),
                shift: freshParsed.shift,
                shiftLabel: freshParsed.shiftLabel,
                leaveDate: freshParsed.leaveDate,
                status: 'duplicate-blocked'
            };
            await sendDayOffStatusFallback(message, duplicateBlockReservation, 'Duplicate Blocked', '❌');
        }
        if (!silent) {
            await sendTemporaryDayOffReply(message, `${message.author} A day-off request already exists for ${freshParsed.leaveDate}.`);
        }
        await writeDayOffLog(`❌ 휴무 신청 중복 차단\n👥 이름: ${freshParsed.displayName}\n⏰ 근무: ${freshParsed.shiftLabel}\n📅 휴무일: ${freshParsed.leaveDate}\n📝 사유: 같은 날짜와 근무조의 휴무 예약이 이미 존재합니다.`);
        await appendDayOffAudit('DUPLICATE_BLOCKED', {
            messageId: message.id,
            duplicateMessageId: duplicate.messageId,
            userId: requestUserId,
            name: freshParsed.displayName,
            shift: freshParsed.shiftLabel,
            leaveDate: freshParsed.leaveDate
        });
        return;
        }
    }

    const reservation = await saveDayOffReservation(message, freshParsed, 'approved', approverMember);
    const dmKey = `${reservation.leaveDate}:${reservation.shift}:${reservation.userId}`;
    let dmStatus = 'DM 발송 완료';
    if (reservation.lastDmKey !== dmKey) {
        const targetUser = await fetchDayOffReservationUser(reservation);
        await targetUser?.send(dayOffService.buildDayOffDm(reservation)).catch(e => {
            console.error('[DAYOFF DM ERROR]', e);
            dmStatus = 'DM 발송 실패';
        });
        if (!targetUser) dmStatus = 'DM 대상 찾기 실패';
        reservation.lastDmKey = dmKey;
        reservation.dmSentAt = moment().tz(CONFIG.TIMEZONE).toISOString();
        await saveSystemAsync();
    } else {
        dmStatus = 'DM 중복 발송 생략';
    }

    const statusEmojiResult = await setDayOffStatusEmoji(message, '✅');
    if (!statusEmojiResult.ok && statusEmojiResult.reactionBlocked) {
        await sendDayOffStatusFallback(message, reservation, 'Approved', '✅');
    }
    if (!silent) {
        await sendTemporaryDayOffReply(message, `${message.author} Your day off has been approved.\nShift: ${reservation.shiftLabel}\nLeave Date: ${reservation.leaveDate}`);
    }
    await writeDayOffLog(`✅ 휴무 승인 완료\n이름: ${reservation.name}\n근무조: ${reservation.shiftLabel}\n휴무일: ${reservation.leaveDate}\n승인자: ${reservation.approvedByName || '시스템'}\nDM 상태: ${dmStatus}`);
    await appendDayOffAudit('APPROVED', {
        messageId: message.id,
        userId: message.author.id,
        name: reservation.name,
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        approvedBy: reservation.approvedBy || CONFIG.DAYOFF_REVIEWER_ID,
        approvedByName: reservation.approvedByName || null,
        dmStatus
    });
}

async function cancelDayOffApproval(message, cancelledBy = null) {
    if (!dayOffService.isDayOffChannel(message)) return;
    const reservation = getDayOffReservations()[message.id];
    if (message.author?.bot && !reservation) return;
    if (!reservation || reservation.status !== 'approved') {
        await processDayOffMessage(message, { silent: true });
        return;
    }

    reservation.status = 'pending';
    reservation.cancelledBy = cancelledBy?.id || CONFIG.DAYOFF_REVIEWER_ID;
    reservation.cancelledByName = cancelledBy?.displayName || cancelledBy?.user?.username || null;
    reservation.cancelledAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    delete reservation.appliedDate;
    delete reservation.appliedAt;
    getDayOffReservations()[message.id] = reservation;

    await saveSystemAsync();
    const statusEmojiResult = await setDayOffStatusEmoji(message, '⏳');
    if (!statusEmojiResult.ok && statusEmojiResult.reactionBlocked) {
        await sendDayOffStatusFallback(message, reservation, 'Pending', '⏳');
    }
    await writeDayOffLog(`❌ 휴무 승인 취소\n이름: ${reservation.name}\n근무조: ${reservation.shiftLabel}\n휴무일: ${reservation.leaveDate}\n취소자: ${reservation.cancelledByName || reservation.cancelledBy || '알 수 없음'}`);
    await appendDayOffAudit('CANCELLED', {
        messageId: message.id,
        userId: message.author.id,
        name: reservation.name,
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        cancelledBy: reservation.cancelledBy,
        cancelledByName: reservation.cancelledByName
    });
}

async function cancelDayOffRequest(message, cancelledBy = null) {
    if (!dayOffService.isDayOffChannel(message)) return;
    const reservation = getDayOffReservations()[message.id];
    if (message.author?.bot && !reservation) return;
    if (!reservation || !['pending', 'approved'].includes(reservation.status)) return null;

    reservation.status = 'cancelled';
    reservation.cancelledBy = cancelledBy?.id || CONFIG.DAYOFF_REVIEWER_ID;
    reservation.cancelledByName = cancelledBy?.displayName || cancelledBy?.user?.username || null;
    reservation.cancelledAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    delete reservation.appliedDate;
    delete reservation.appliedAt;
    getDayOffReservations()[message.id] = reservation;

    const user = getAttendanceData()[reservation.userId];
    if (user?.dayOff && reservation.leaveDate === moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD')) {
        clearDayOffReservationState(user, moment().tz(CONFIG.TIMEZONE), 'day-off-cancel-reaction', 'day-off-reservation-cancelled');
    }

    await saveSystemAsync();
    const statusEmojiResult = await setDayOffStatusEmoji(message, '❌');
    if (!statusEmojiResult.ok && statusEmojiResult.reactionBlocked) {
        await sendDayOffStatusFallback(message, reservation, 'Cancelled', '❌');
    }
    await writeDayOffLog(`❌ 휴무 신청 취소\n이름: ${reservation.name}\n근무조: ${reservation.shiftLabel}\n휴무일: ${reservation.leaveDate}\n취소자: ${reservation.cancelledByName || reservation.cancelledBy || '알 수 없음'}`);
    await appendDayOffAudit('CANCELLED', {
        messageId: message.id,
        userId: message.author.id,
        name: reservation.name,
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        cancelledBy: reservation.cancelledBy,
        cancelledByName: reservation.cancelledByName
    });
    return reservation;
}

async function markWorkedOnDayOff(member, user, shift, now) {
    if (user) user.dayOffExpireAt = null;
    const today = getDayOffLogicalDateForShift(shift, now);
    const reservation = Object.values(getDayOffReservations()).find(r =>
        r &&
        r.status === 'approved' &&
        r.userId === member.id &&
        r.leaveDate === today &&
        r.shift === shift
    );
    if (!reservation) return null;

    reservation.status = 'worked';
    reservation.workedAt = now.toISOString();
    reservation.workedBy = member.id;
    reservation.workedByName = member.displayName;
    if (reservation.appliedDate === today && (user.offCount || 0) > 0) {
        user.offCount -= 1;
    }
    delete reservation.appliedDate;
    delete reservation.appliedAt;

    await writeDayOffLog(`🔄 휴무 당일 근무 전환\n👥 대상: ${reservation.name}\n⏰ 근무: ${reservation.shiftLabel}\n📅 기존 휴무일: ${reservation.leaveDate}\n📝 사유: 휴무일 본인 CLOCK IN 버튼 출근\n\n${reservation.name} 님이 승인된 휴무일에 출근하여 근무 상태로 전환되었습니다.`);
    await appendDayOffAudit('WORKED_ON_DAYOFF', {
        messageId: reservation.messageId,
        userId: reservation.userId,
        name: reservation.name,
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        reason: 'clock-in-or-live-on'
    });
    return reservation;
}

function getActiveApprovedDayOffReservation(memberId, shift, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!memberId || !shift) return null;
    const logicalDate = getDayOffLogicalDateForShift(shift, now);
    return Object.values(getDayOffReservations()).find(r =>
        r &&
        r.status === 'approved' &&
        r.userId === memberId &&
        r.shift === shift &&
        r.leaveDate === logicalDate
    ) || null;
}

async function sendFinishedLiveOffReminder(member, user, now, source = 'voice_snapshot') {
    if (!member || !user?.isFinished || user.checkedIn) return false;
    const finishedAt = user.checkOutRaw || user.attendanceStatusChangedAt || null;
    if (!finishedAt) return false;
    if (!Array.isArray(user.finishedLiveOffReminderMarks)) user.finishedLiveOffReminderMarks = [];

    const elapsedMins = Math.max(0, now.diff(moment(finishedAt).tz(CONFIG.TIMEZONE), 'minutes'));
    const reminderMarks = [15, 30, 45, 60];
    const reminderMark = Math.floor(elapsedMins / 15) * 15;
    if (!reminderMarks.includes(reminderMark)) return false;
    if (user.finishedLiveOffReminderMarks.includes(reminderMark)) return false;

    user.finishedLiveOffReminderMarks.push(reminderMark);
    appendAttendanceEvent(user, 'finished_live_off_dm_sent', now, source, {
        minutesSinceFinished: elapsedMins,
        reminderMark
    });
    await member.send(buildFinishedLiveOffReminderDm(
        reminderMarks.indexOf(reminderMark) + 1,
        reminderMarks.length,
        buildLiveOffGuidanceDm({ final: true, minutes: reminderMark })
    )).catch(() => null);
    return true;
}

async function cancelDayOffReservationByCommand(member, leaveDate, cancelledBy) {
    const reservation = Object.values(getDayOffReservations()).find(r =>
        r &&
        ['pending', 'approved'].includes(r.status) &&
        r.userId === member.id &&
        r.leaveDate === leaveDate
    );
    if (!reservation) return null;

    reservation.status = 'cancelled';
    reservation.cancelledBy = cancelledBy.id || CONFIG.DAYOFF_REVIEWER_ID;
    reservation.cancelledByName = cancelledBy.displayName || cancelledBy.user?.username || null;
    reservation.cancelledAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    delete reservation.appliedDate;
    delete reservation.appliedAt;
    getDayOffReservations()[reservation.messageId] = reservation;

    const u = getAttendanceData()[member.id];
    if (u?.dayOff && leaveDate === moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD')) {
        clearDayOffReservationState(u, moment().tz(CONFIG.TIMEZONE), 'day-off-cancel-command', 'day-off-reservation-cancelled');
    }

    await saveSystemAsync();
    await writeDayOffLog(`❌ 휴무 예약 취소\n👥 대상: ${reservation.name}\n⏰ 근무: ${reservation.shiftLabel}\n📅 휴무일: ${reservation.leaveDate}\n👑 취소자: ${reservation.cancelledByName || reservation.cancelledBy || '정보 없음'}\n\n${reservation.name} 님의 휴무가 취소되었습니다.`);
    await appendDayOffAudit('CANCELLED', {
        messageId: reservation.messageId,
        userId: reservation.userId,
        name: reservation.name,
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        cancelledBy: reservation.cancelledBy,
        cancelledByName: reservation.cancelledByName,
        reason: 'slash-command'
    });
    return reservation;
}

async function cancelOnlyDayOffReservationByCommand(member, cancelledBy) {
    const candidates = Object.values(getDayOffReservations())
        .filter(r =>
            r &&
            ['pending', 'approved'].includes(r.status) &&
            r.userId === member.id
        )
        .sort((a, b) => `${a.leaveDate}${a.messageId}`.localeCompare(`${b.leaveDate}${b.messageId}`));

    if (candidates.length !== 1) {
        return {
            error: candidates.length === 0 ? 'not-found' : 'ambiguous',
            count: candidates.length,
            candidates
        };
    }

    const reservation = candidates[0];
    const cancelled = await cancelDayOffReservationByCommand(member, reservation.leaveDate, cancelledBy);
    return cancelled || { error: 'not-found', count: 0, candidates: [] };
}

async function rejectDayOffReservationByCommand(member, leaveDate, rejectedBy, reason = 'Rejected by Graet') {
    const reservation = Object.values(getDayOffReservations()).find(r =>
        r &&
        ['pending', 'approved'].includes(r.status) &&
        r.userId === member.id &&
        r.leaveDate === leaveDate
    );
    if (!reservation) return null;

    reservation.status = 'rejected';
    reservation.rejectedBy = rejectedBy.id || CONFIG.DAYOFF_REVIEWER_ID;
    reservation.rejectedByName = rejectedBy.displayName || rejectedBy.user?.username || null;
    reservation.rejectedAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    reservation.rejectReason = (reason || 'Rejected by Graet').trim() || 'Rejected by Graet';
    delete reservation.appliedDate;
    delete reservation.appliedAt;
    getDayOffReservations()[reservation.messageId] = reservation;

    const u = getAttendanceData()[member.id];
    if (u?.dayOff && leaveDate === moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD')) {
        clearDayOffReservationState(u, moment().tz(CONFIG.TIMEZONE), 'day-off-reject-command', 'day-off-reservation-rejected');
    }

    const channel = await client.channels.fetch(reservation.channelId).catch(() => null);
    const message = channel ? await channel.messages.fetch(reservation.messageId).catch(() => null) : null;
    if (message) await setDayOffStatusEmoji(message, '❌');

    await member.send(dayOffService.buildDayOffRejectDm(reservation)).catch(e => {
        console.error('[DAYOFF REJECT DM ERROR]', e);
    });

    await saveSystemAsync();
    await writeDayOffLog(`❌ 휴무 신청 반려\n👥 대상: ${reservation.name}\n⏰ 근무: ${reservation.shiftLabel}\n📅 휴무일: ${reservation.leaveDate}\n👑 반려자: ${reservation.rejectedByName || reservation.rejectedBy || '정보 없음'}\n📝 사유: ${reservation.rejectReason}`);
    await appendDayOffAudit('REJECTED', {
        messageId: reservation.messageId,
        userId: reservation.userId,
        name: reservation.name,
        submittedName: reservation.submittedName || null,
        nameMismatch: Boolean(reservation.nameMismatch),
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        rejectedBy: reservation.rejectedBy,
        rejectedByName: reservation.rejectedByName,
        reason: reservation.rejectReason
    });
    return reservation;
}

async function approveDayOffReservationByCommand(member, leaveDate, approvedBy) {
    const reservation = Object.values(getDayOffReservations()).find(r =>
        r &&
        r.status === 'pending' &&
        r.userId === member.id &&
        r.leaveDate === leaveDate
    );
    if (!reservation) return null;

    const duplicate = Object.values(getDayOffReservations()).find(r =>
        r &&
        r.messageId !== reservation.messageId &&
        r.status === 'approved' &&
        r.userId === reservation.userId &&
        r.leaveDate === leaveDate &&
        r.shift === reservation.shift
    );
    if (duplicate) return { error: 'duplicate' };

    reservation.status = 'approved';
    reservation.approvedBy = approvedBy.id || CONFIG.DAYOFF_REVIEWER_ID;
    reservation.approvedByName = approvedBy.displayName || approvedBy.user?.username || null;
    reservation.updatedAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    getDayOffReservations()[reservation.messageId] = reservation;

    const channel = await client.channels.fetch(reservation.channelId).catch(() => null);
    const message = channel ? await channel.messages.fetch(reservation.messageId).catch(() => null) : null;
    if (message) await setDayOffStatusEmoji(message, '✅');

    const dmKey = `${reservation.leaveDate}:${reservation.shift}:${reservation.userId}`;
    let dmStatus = 'DM 발송 완료';
    if (reservation.lastDmKey !== dmKey) {
        const targetUser = await client.users.fetch(reservation.userId).catch(() => null);
        if (targetUser) {
            await targetUser.send(dayOffService.buildDayOffDm(reservation)).catch(e => {
                console.error('[DAYOFF DM ERROR]', e);
                dmStatus = 'DM 발송 실패';
            });
        } else {
            dmStatus = '대상 유저 찾을 수 없음';
        }
        reservation.lastDmKey = dmKey;
        reservation.dmSentAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    } else {
        dmStatus = 'DM 중복 발송 생략';
    }

    await saveSystemAsync();
    await writeDayOffLog(`✅ 휴무 승인 완료 (명령어)\n이름: ${reservation.name}\n근무조: ${reservation.shiftLabel}\n휴무일: ${reservation.leaveDate}\n승인자: ${reservation.approvedByName || reservation.approvedBy || '시스템'}\nDM 상태: ${dmStatus}`);
    await appendDayOffAudit('APPROVED', {
        messageId: reservation.messageId,
        userId: reservation.userId,
        name: reservation.name,
        submittedName: reservation.submittedName || null,
        nameMismatch: Boolean(reservation.nameMismatch),
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        approvedBy: reservation.approvedBy,
        approvedByName: reservation.approvedByName,
        dmStatus,
        reason: 'slash-command'
    });
    return reservation;
}

async function checkDayOffReservations() {
    const now = moment().tz(CONFIG.TIMEZONE);
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return;
    let changed = false;

    for (const reservation of Object.values(getDayOffReservations())) {
        if (!reservation || reservation.status !== 'approved') continue;
        const logicalDate = getDayOffLogicalDateForShift(reservation.shift, now);
        if (reservation.leaveDate !== logicalDate) continue;
        const reservationBounds = buildShiftBoundsForBusinessDate(
            reservation.shift,
            moment.tz(reservation.leaveDate, 'YYYY-MM-DD', CONFIG.TIMEZONE)
        );
        if (reservationBounds?.end && now.isSameOrAfter(reservationBounds.end)) continue;

        const member = await guild.members.fetch(reservation.userId).catch(() => null);
        const u = ensureUserData(member || { id: reservation.userId, displayName: reservation.name }, reservation.shift);
        if (!u) continue;
        if (await applyApprovedDayOffReservation(reservation, member, u, now, 'dayoff-auto-apply')) changed = true;
    }

    if (changed) {
        await saveSystemAsync();
        queueDashboardRender();
    }
}

async function applyApprovedDayOffReservation(reservation, member, user, now, source = 'dayoff-auto-apply') {
    if (!reservation || reservation.status !== 'approved' || !user) return false;
    const logicalDate = getDayOffLogicalDateForShift(reservation.shift, now);
    if (reservation.leaveDate !== logicalDate) return false;
    const reservationBounds = buildShiftBoundsForBusinessDate(
        reservation.shift,
        moment.tz(reservation.leaveDate, 'YYYY-MM-DD', CONFIG.TIMEZONE)
    );
    if (reservationBounds?.end && now.isSameOrAfter(reservationBounds.end)) return false;
    const alreadyCounted = reservation.appliedDate === logicalDate;
    const alreadyApplied = alreadyCounted && user.dayOff && user.attendanceStatus === 'DAY_OFF';
    if (alreadyApplied) return false;

    user.shift = reservation.shift;
    applyDayOffState(user, now, source, 'approved-day-off-applied');
    user.dayOffExpireAt = (reservationBounds || getShiftBounds(reservation.shift, now)).end.toISOString();
    if (!alreadyCounted) user.offCount = (user.offCount || 0) + 1;
    removeOvertimeUser(reservation.userId);
    if (member) await updateWorkingRole(member, false);

    reservation.appliedDate = logicalDate;
    reservation.appliedAt = now.toISOString();
    if (!alreadyCounted) {
        await writeDayOffLog(`📅 휴무 자동 반영\n👥 이름: ${reservation.name}\n⏰ 근무: ${reservation.shiftLabel}\n📅 휴무일: ${reservation.leaveDate}\n📝 사유: ${source === 'dashboard-dayoff-self-heal' ? '현황판 렌더링 중 승인된 휴무 상태를 보정했습니다.' : `근무조별 논리 날짜(${logicalDate}) 기준으로 근무 현황에 DAY OFF를 반영했습니다.`}`);
        await appendDayOffAudit('APPLIED', {
            messageId: reservation.messageId,
            userId: reservation.userId,
            name: reservation.name,
            shift: reservation.shiftLabel,
            leaveDate: reservation.leaveDate,
            logicalDate,
            source
        });
    }
    return true;
}

    return {
        sendTemporaryDayOffReply,
        isReactionBlockedError,
        setDayOffStatusEmoji,
        sendDayOffStatusFallback,
        writeDayOffLog,
        appendDayOffAudit,
        readDayOffLog,
        notifyDayOffReviewer,
        dayOffReservationToParsed,
        getDayOffReservationUserId,
        fetchDayOffReservationUser,
        saveDayOffReservation,
        isDayOffRequestPanelMessage,
        repostDayOffRequestPanel,
        submitDayOffRequestFromInteraction,
        processDayOffMessage,
        approveDayOffMessage,
        cancelDayOffApproval,
        cancelDayOffRequest,
        markWorkedOnDayOff,
        getActiveApprovedDayOffReservation,
        buildLiveOffGuidanceDm,
        sendFinishedLiveOffReminder,
        cancelDayOffReservationByCommand,
        cancelOnlyDayOffReservationByCommand,
        rejectDayOffReservationByCommand,
        approveDayOffReservationByCommand,
        checkDayOffReservations,
        applyApprovedDayOffReservation
    };
}

module.exports = { createDayOffWorkflow };
