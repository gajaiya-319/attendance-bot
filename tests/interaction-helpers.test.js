const assert = require('assert');
const {
    createCommandOptionHelpers,
    patchCommandReplies
} = require('../src/utils/interactionHelpers');

const member = { id: '1' };
const role = { id: 'role' };
const interaction = {
    commandName: '테스트',
    options: {
        getMember: (name) => name === '대상' ? member : null,
        getInteger: (name) => name === '번호' ? 3 : null,
        getString: (name) => name === '시간' ? '21:30' : null,
        getRole: (name) => name === '역할' ? role : null
    }
};

const helpers = createCommandOptionHelpers(interaction);
assert.strictEqual(helpers.n('테스트'), true);
assert.strictEqual(helpers.getTargetMember(), member);
assert.strictEqual(helpers.getSlot(), 3);
assert.strictEqual(helpers.getAnnounceTime(), '21:30');
assert.strictEqual(helpers.getAnnounceRole(), role);

let replyPayload = null;
const patched = {
    reply: async (payload) => {
        replyPayload = payload;
        return 'ok';
    },
    editReply: async (payload) => payload,
    deferReply: async (payload) => payload
};

patchCommandReplies(patched, {
    withCommandStatusPayload: (payload) => ({ ...payload, content: `wrapped:${payload.content}` }),
    handleInteractionReplyError: () => null
});

patched.reply({ content: 'hello' });
assert.strictEqual(replyPayload.content, 'wrapped:hello');

console.log('interaction-helpers tests passed');
