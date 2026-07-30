'use strict';

function formatPurchaseRequestOwnerDm({ userName, quantity, itemLabel = 'potion', amount = null }) {
    const requestText = itemLabel === 'haste buff'
        ? `헤이스트 버프 ${Number(amount || 0).toLocaleString('ko-KR')}`
        : `포션 ${Number(quantity || 0).toLocaleString('ko-KR')}개`;
    return [
        '🧪 포션 구매 요청',
        '',
        `요청자: ${userName}`,
        `요청 내용: ${requestText}`,
        '',
        '확인 후 가능할 때 구매해 주세요.'
    ].join('\n');
}

function formatPurchaseApprovedDm({ quantity, itemLabel = 'potion' }) {
    const itemText = itemLabel?.startsWith('haste buff')
        ? itemLabel
        : `${quantity} ${quantity === 1 ? 'potion' : 'potions'}`;
    const verb = itemLabel?.startsWith('haste buff') || quantity === 1 ? 'has' : 'have';
    return [
        `✅ Your ${itemText} ${verb} been purchased.`,
        `Please check your ${itemLabel?.startsWith('haste buff') ? 'buff' : 'potions'} when you have a moment.`,
        '🧪 Thank you, and enjoy your hunt!'
    ].join('\n');
}

module.exports = {
    formatPurchaseRequestOwnerDm,
    formatPurchaseApprovedDm
};
