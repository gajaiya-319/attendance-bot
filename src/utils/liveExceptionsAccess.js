'use strict';

function getLiveExceptionsMap(getLiveExceptions, logger = console) {
    if (typeof getLiveExceptions !== 'function') {
        logger.warn?.('[LIVE EXCEPTIONS WARN] getLiveExceptions is not a function; using empty map.');
        return {};
    }
    const map = getLiveExceptions();
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
        logger.warn?.('[LIVE EXCEPTIONS WARN] liveExceptions is not an object; using empty map.');
        return {};
    }
    return map;
}

module.exports = {
    getLiveExceptionsMap
};
