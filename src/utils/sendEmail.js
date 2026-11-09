import { Resend } from "resend";

/**
 * sendEmail.js - Email Utility using Resend API
 * 
 * Requirements in .env:
 * - RESEND_API_KEY: Your Resend API Key
 * - EMAIL_FROM: The from address (e.g., noreply@prsnn.com)
 */

let resendClient = null;

const getResendClient = () => {
    if (!resendClient) {
        if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
            console.error("❌ CRITICAL: RESEND_API_KEY or EMAIL_FROM missing in .env file.");
        }
        resendClient = new Resend(process.env.RESEND_API_KEY);
    }
    return resendClient;
};

/**
 * Sends an email using the Resend API.
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Subject line
 * @param {string} options.text - Plain text content
 * @param {string} options.html - HTML content
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export const sendEmail = async ({ to, subject, text, html }) => {
    try {
        const resend = getResendClient();

        // Send Logic
        const { data, error } = await resend.emails.send({
            from: process.env.EMAIL_FROM, // Sender address
            to,
            subject,
            html: html || `<p>${text || ""}</p>`,
            text: text || "",
        });

        if (error) {
            console.error("❌ Email sending failed via Resend:", error.message);
            return { success: false, error: error.message };
        }

        console.log(`✅ Email sent to ${to}. ID: ${data?.id}`);
        return { success: true, messageId: data?.id };

    } catch (error) {
        console.error("❌ Email sending failed:", error.message);
        return { success: false, error: error.message };
    }
};
