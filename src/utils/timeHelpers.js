'use strict';

const moment = require('moment-timezone');
const { CONFIG, SHIFT_SCHEDULE, MAINTENANCE_WINDOWS } = require('../config/constants');
const createTimeLogic = require('../../time-logic');

module.exports = createTimeLogic({
    CONFIG,
    SHIFT_SCHEDULE,
    MAINTENANCE_WINDOWS,
    moment
});
