// reset-messages.ts — the TEXT of the password-reset SMS and email. Auth's business content, split out of the SMS and
// email adapters when those became @aipowersalon/notifications (Constitution 13 §78: provider infrastructure in the
// package; what a message SAYS stays with the domain that sends it).
export function resetSmsBody(tempCode: string): string {
  return "AIPowerSalon: Your temporary login code is " + tempCode + ". It expires in 15 minutes. If you did not request this, contact your salon owner.";
}export function resetEmail(tempPassword: string): { subject: string; body: string } {
  return { subject: "Reset your AIPowerSalon password",
    body: "Your temporary password is: " + tempPassword + "\n\nIt expires in 15 minutes and must be changed after login.\nIf you did not request this, contact your salon owner or AIPowerSalon support." };
}
