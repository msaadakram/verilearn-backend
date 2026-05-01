const test = require('node:test');
const assert = require('node:assert/strict');

const Conversation = require('../src/models/Conversation');
const messageService = require('../src/services/messageService');

function makeConversation(participants) {
  return {
    participants,
  };
}

test('normalizeActiveMode accepts valid modes and rejects invalid ones', () => {
  assert.equal(messageService.normalizeActiveMode('teacher'), 'teacher');
  assert.equal(messageService.normalizeActiveMode('  STUDENT  '), 'student');
  assert.equal(messageService.normalizeActiveMode('invalid'), null);
  assert.equal(messageService.normalizeActiveMode(undefined, 'student'), 'student');
});

test('canUserAccessMode respects dashboard unlocks for dual-role users', () => {
  const student = { profession: 'student' };
  const teacher = { profession: 'teacher' };
  const unlockedTeacher = { profession: 'teacher', teacherProfile: { dashboardUnlocked: true } };

  assert.equal(messageService.canUserAccessMode(student, 'student'), true);
  assert.equal(messageService.canUserAccessMode(student, 'teacher'), false);
  assert.equal(messageService.canUserAccessMode(teacher, 'teacher'), true);
  assert.equal(messageService.canUserAccessMode(teacher, 'student'), false);
  assert.equal(messageService.canUserAccessMode(unlockedTeacher, 'student'), true);
  assert.equal(messageService.canUserAccessMode(unlockedTeacher, 'teacher'), true);
});

test('assertConversationAccess rejects missing conversations and role mismatches', async () => {
  const originalFindById = Conversation.findById;

  try {
    Conversation.findById = async () => null;
    await assert.rejects(
      () => messageService.assertConversationAccess('conv-1', 'user-1', 'student'),
      (error) => error.statusCode === 404,
    );

    Conversation.findById = async () => makeConversation([
      { userId: { toString: () => 'user-1' }, role: 'student' },
      { userId: { toString: () => 'user-2' }, role: 'teacher' },
    ]);

    await assert.rejects(
      () => messageService.assertConversationAccess('conv-1', 'user-1', 'teacher'),
      (error) => error.statusCode === 403 && /not accessible in teacher mode/i.test(error.message),
    );
  } finally {
    Conversation.findById = originalFindById;
  }
});

test('assertConversationAccess returns participant and counterparty when access is valid', async () => {
  const originalFindById = Conversation.findById;

  try {
    Conversation.findById = async () => makeConversation([
      { userId: { toString: () => 'user-1' }, role: 'student' },
      { userId: { toString: () => 'user-2' }, role: 'teacher' },
    ]);

    const result = await messageService.assertConversationAccess('conv-1', 'user-1', 'student');

    assert.equal(result.participant.role, 'student');
    assert.equal(result.counterparty.role, 'teacher');
    assert.equal(result.conversation.participants.length, 2);
  } finally {
    Conversation.findById = originalFindById;
  }
});