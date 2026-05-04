'use strict';

/**
 * Calculate session duration and credits to transfer.
 *
 * Business rule:
 * - Credits are transferred only after a session starts and ends.
 * - The live duration determines the transfer amount.
 * - 30 minutes at a 30-minute rate = 1 credit.
 * - Credits are rounded up so partial sessions still count toward the next credit.
 */
function calculateSessionCredits({ startTime, endTime, creditRate = 30 }) {
    const startedAt = startTime ? new Date(startTime) : null;
    const endedAt = endTime ? new Date(endTime) : null;

    if (!startedAt || !endedAt || Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
        return {
            actualDurationMinutes: 0,
            roundedDurationMinutes: 0,
            creditsUsed: 0,
        };
    }

    const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
    const actualDurationMinutes = durationMs / 60000;
    const roundedDurationMinutes = Math.round(actualDurationMinutes);
    const safeRate = Number.isFinite(Number(creditRate)) && Number(creditRate) > 0 ? Number(creditRate) : 30;

    // Allows 1 credit for every (safeRate - 5) minutes, so 25+ mins yields 1 credit, 50+ mins yields 2 credits.
    const effectiveBlock = Math.max(1, safeRate - 5);
    const creditsUsed = Math.floor(actualDurationMinutes / effectiveBlock);

    return {
        actualDurationMinutes,
        roundedDurationMinutes,
        creditsUsed,
    };
}

module.exports = {
    calculateSessionCredits,
};