/**
 * Test logins (App Store / Play review, QA). OTP_TEST_NUMBERS is a comma list
 * of "10-digit-number:6-digit-code". For these numbers no WhatsApp/SMS is sent
 * and the fixed code works. Use numbers nobody owns (e.g. 90000 0000x) and keep
 * the list short; every use is logged. Never put a real customer's number here.
 */
const last10 = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);

export function testNumbers(env = process.env.OTP_TEST_NUMBERS) {
    const map = new Map();
    for (const pair of String(env ?? '').split(',')) {
        const [num, code] = pair.split(':').map((s) => (s ?? '').trim());
        if (/^[6-9]\d{9}$/.test(last10(num)) && /^\d{6}$/.test(code ?? '')) map.set(last10(num), code);
    }
    return map;
}

/** The fixed code for a test number, or null. */
export const testCodeFor = (phone, env) => testNumbers(env).get(last10(phone)) ?? null;
