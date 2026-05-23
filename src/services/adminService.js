'use strict';

function createAdminService({ getAnnounceData, truncateWidth }) {
    function formatAnnouncementList() {
        return Object.entries(getAnnounceData())
            .map(([slot, d]) => {
                if (!d) return `Slot ${slot}: empty`;
                if (typeof d !== 'object') return `Slot ${slot}: invalid legacy data`;
                const state = d.active ? 'ON' : 'OFF';
                const roleIds = Array.isArray(d.roleIds)
                    ? d.roleIds.filter(Boolean)
                    : (d.roleId ? [d.roleId] : []);
                const role = roleIds.length ? ` roles=${roleIds.map(roleId => `<@&${roleId}>`).join(',')}` : '';
                const content = truncateWidth(d.content || '', 55);
                return `Slot ${slot}: ${state} ${d.time || '--:--'}${role} - ${content}`;
            })
            .join('\n');
    }

    function applyManualAdjustment(user, field, value) {
        const numericFields = {
            points: 'points',
            normal: 'totalNormal',
            late: 'totalLate',
            absent: 'totalAbsent',
            early: 'totalEarly',
            ot: 'totalOT',
            off: 'offCount',
            dc: 'dcCount',
            strikes: 'strikes'
        };
        const booleanFields = {
            'checked-in': 'checkedIn',
            'day-off': 'dayOff',
            disconnected: 'disconnected',
            finished: 'isFinished'
        };

        if (numericFields[field]) {
            const amount = Number(value);
            if (!Number.isFinite(amount)) return false;
            user[numericFields[field]] = amount;
            return true;
        }
        if (booleanFields[field]) {
            if (!['true', 'false'].includes(String(value).toLowerCase())) return false;
            user[booleanFields[field]] = String(value).toLowerCase() === 'true';
            return true;
        }
        if (field === 'status') {
            if (!['ontime', 'late', 'absent', 'none'].includes(value)) return false;
            user.status = value === 'none' ? null : value;
            return true;
        }
        if (field === 'shift') {
            if (!['day', 'night'].includes(value)) return false;
            user.shift = value;
            return true;
        }
        return false;
    }

    return {
        formatAnnouncementList,
        applyManualAdjustment
    };
}

module.exports = createAdminService;
