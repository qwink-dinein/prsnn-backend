/**
 * Gender matching and profile lock rules, shared by listings, bookings and
 * allocation so every path applies the same rules.
 */

export const GENDERS = ['woman', 'man', 'nonbinary'];
export const SEE_GENDERS = [...GENDERS, 'everyone'];
export const VISIBILITY = ['open', 'locked'];

/** Default lock for a new choice of gender: women and non-binary locked, men open. */
export const defaultVisibilityFor = (gender) => (gender === 'man' ? 'open' : 'locked');

/**
 * Can a viewer who wants to see `seeGender` see this companion?
 * No preference (logged out, older account) → everyone. A companion with no
 * gender set appears only to people who chose "everyone".
 */
export function matchesSeeGender(seeGender, companionGender) {
  if (!seeGender || seeGender === 'everyone') return true;
  return companionGender === seeGender;
}

export const isLocked = (user) => user?.profileVisibility === 'locked';

/** First name only, for locked profiles. */
export const firstNameOf = (name) => (name || '').trim().split(/\s+/)[0] || '';

/**
 * Apply the lock to a public profile shape: no photo, first name only,
 * `locked: true` so the app shows its static blurred placeholder.
 * `unlocked` = the viewer has a confirmed, paid booking with this person.
 */
export function applyLock(profile, user, { unlocked = false } = {}) {
  if (!isLocked(user) || unlocked) return { ...profile, locked: false };
  return { ...profile, locked: true, profilePhoto: null, profilePhotoUrl: undefined, fullName: firstNameOf(profile.fullName) };
}

/** Escape user text before putting it in a RegExp (prevents regex injection / ReDoS). */
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60);

/**
 * Validates and applies gender / seeGender / profileVisibility / state from a
 * request body onto a user document. Changing visibility requires
 * `visibilityConsent: true` (the person confirmed it in the app); the consent
 * time is stored. Returns an error message, or null.
 */
export function applyIdentity(user, body = {}) {
  const { gender, seeGender, profileVisibility, visibilityConsent, state } = body;
  if (gender !== undefined && gender !== '') {
    if (!GENDERS.includes(gender)) return 'Choose woman, man or non-binary.';
    user.gender = gender;
  }
  if (seeGender !== undefined && seeGender !== '') {
    if (!SEE_GENDERS.includes(seeGender)) return 'Choose who you want to see: women, men, non-binary people or everyone.';
    user.seeGender = seeGender;
  }
  if (profileVisibility !== undefined && profileVisibility !== '') {
    if (!VISIBILITY.includes(profileVisibility)) return 'Profile visibility must be open or locked.';
    const consent = visibilityConsent === true || visibilityConsent === 'true';
    if (!consent) return 'Please confirm how your profile is shown.';
    user.profileVisibility = profileVisibility;
    user.visibilityConsentAt = new Date();
  }
  if (typeof state === 'string' && state.trim()) user.state = state.trim().slice(0, 60);
  return null;
}
