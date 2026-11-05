// @aipowersalon/api-contracts/tenant — the tenant-realm API contracts (Constitution 13 §14).
export * from './owner';
export * from './cash-drawer';
export * from './compensation';
export * from './payroll';   // Payroll mandate wave 2: review / approval / payouts / export / exceptions / inquiries / pay plans
export * from './payroll-paychecks';   // Weekly Paycheck mandate (Oct 21 2026): statements, payout plans, check / cash payouts, owner decision
export * from './platform-announcements';   // Oct 22 2026: what a POS receives about Platform Announcements (client-safe fields only)
export * from './tech';
export * from './mobile-checkout';
export * from './checkout-lock';
export * from './checkout';
export * from './voice-booking';
export * from './ai-center';
export * from './ai-revenue';
export * from './workflow-runs';
export * from './ai';
export * from './turn-queue';   // Fair Turn Engine (wave 2)
export * from './ai-scheduling';
export * from './queue-alert-text';   // Vietnamese POS §21 (Oct 27 2026): AI-queue alert reasons as code + vars
export * from './money-protection-text';   // Vietnamese POS §21 (Oct 27 2026): Money Protection evidence as code + vars
export * from './call-intelligence';
export * from './communications';
export * from './pos-team';
export * from './devices';
export * from './api-webhooks';
export * from './end-of-day-followups';
export * from './deals';
export * from './booking';
export * from './queue';
export * from './deployments';
export * from './tenants';
export * from './workforce';
export * from './memberships';
export * from './profile';
export * from './gift-cards';
export * from './appointments';
export * from './payments';
export * from './support';
export * from './logs';
export * from './audit';
export * from './inventory';
export * from './pos-account';
export * from './loyalty';   // Decision 15 rewards catalog (Oct 3 2026)
export * from './display-ads';   // 23-inch dual-screen spec §48–§111: Customer Display Advertising (Oct 6 2026)
export * from './customer-displays';   // 23-inch dual-screen spec §9–§10, §81–§86: displays + registers as the POS sees them
export * from './community';
export * from './authorization';
export * from './approvals';   // BUILD_PLAN Phase 9 (agent D): approval policy detail + create / pending results
export * from './branch-health';   // BUILD_PLAN Phase 14 B: Constitution 11 §345 branch health (owner card + Super Admin list)
export * from './finance';   // Receipt/Expense/OCR/Accounting mandate (Oct 21 2026): /owner/finance/*
export * from './pos-terminal-pay';   // Fiserv master build §7 (Nov 2026): POS Card → Clover Compact
