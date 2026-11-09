/**
 * Superadmins are the phone numbers in SUPERADMIN_PHONES (comma-separated,
 * 10-digit Indian mobiles; set on Render, never committed). A matching phone is
 * promoted on OTP or PIN login; an account promoted this way is demoted at its
 * next login once its number is removed from the list.
 */
const last10 = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);

export function superadminPhones(env = process.env.SUPERADMIN_PHONES) {
    return new Set(
        String(env ?? '')
            .split(',')
            .map(last10)
            .filter((p) => /^[6-9]\d{9}$/.test(p))
    );
}

export const isSuperadminPhone = (phone, env) => {
    const p = last10(phone);
    return p.length === 10 && superadminPhones(env).has(p);
};

/**
 * Apply the env list to a user document before a token is issued.
 * Returns true when the role changed (caller saves).
 */
export function syncSuperadmin(user, env) {
    if (!user?.phone) return false;
    if (isSuperadminPhone(user.phone, env)) {
        if (user.role === 'superadmin' && user.superadminViaEnv) return false;
        if (user.role !== 'superadmin') user.superadminViaEnv = true;
        user.role = 'superadmin';
        user.verificationStatus = 'verified';
        return true;
    }
    if (user.role === 'superadmin' && user.superadminViaEnv) {
        user.role = 'user';
        user.superadminViaEnv = undefined;
        return true;
    }
    return false;
}
