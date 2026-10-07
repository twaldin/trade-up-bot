/**
 * A claim the board still treats as taken. `getActiveClaims` loads this set,
 * and the free board hides those rows. An expired claim fails the predicate,
 * so the row stays on the board and stays unlockable.
 */
export const ACTIVE_CLAIM_PREDICATE = "released_at IS NULL AND expires_at > NOW()";
