const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateSessionCredits } = require('../src/utils/sessionCredits');

test('calculateSessionCredits transfers 1 credit for a 30 minute session at a 30 minute rate', () => {
    const result = calculateSessionCredits({
        startTime: new Date('2026-05-01T10:00:00.000Z'),
        endTime: new Date('2026-05-01T10:30:00.000Z'),
        creditRate: 30,
    });

    assert.equal(Math.round(result.actualDurationMinutes), 30);
    assert.equal(result.roundedDurationMinutes, 30);
    assert.equal(result.creditsUsed, 1);
});

test('calculateSessionCredits rounds up partial live sessions', () => {
    const result = calculateSessionCredits({
        startTime: new Date('2026-05-01T10:00:00.000Z'),
        endTime: new Date('2026-05-01T10:45:00.000Z'),
        creditRate: 30,
    });

    assert.equal(result.creditsUsed, 2);
    assert.equal(result.roundedDurationMinutes, 45);
});

test('calculateSessionCredits returns zero values when the session never started', () => {
    const result = calculateSessionCredits({
        startTime: null,
        endTime: new Date('2026-05-01T10:30:00.000Z'),
        creditRate: 30,
    });

    assert.equal(result.actualDurationMinutes, 0);
    assert.equal(result.roundedDurationMinutes, 0);
    assert.equal(result.creditsUsed, 0);
});
