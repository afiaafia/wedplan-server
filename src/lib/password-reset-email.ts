import type { User } from "better-auth";

type ResetEmailInput = {
  user: User;
  url: string;
  token: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendPasswordResetEmail({
  user,
  url,
}: ResetEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.PASSWORD_RESET_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Password reset email delivery is not configured.");
    }

    console.info(
      `[dev] Password reset link for ${user.email}: ${url}`
    );
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [user.email],
      subject: "Reset your WedPlan password",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#302729">
          <h1 style="font-size:22px">Reset your WedPlan password</h1>
          <p>Hello ${escapeHtml(user.name || "there")},</p>
          <p>We received a request to reset your password. This link expires in 1 hour.</p>
          <p><a href="${escapeHtml(url)}" style="color:#7d4a50;font-weight:bold">Reset password</a></p>
          <p>If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
      text: `Reset your WedPlan password: ${url}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Password reset email failed with status ${response.status}`);
  }
}
