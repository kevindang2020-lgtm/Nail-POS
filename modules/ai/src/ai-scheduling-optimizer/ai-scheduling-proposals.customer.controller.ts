// ai-scheduling-proposals.customer.controller.ts — BUILD_PLAN Phase 7 (agent B): the customer's side of a schedule change
// proposal (customer-web /appointments/proposals).
//   GET  customer/schedule-proposals              → CustomerScheduleProposalList (only the signed-in customer's own)
//   POST customer/schedule-proposals/:id/approve  (CustomerScheduleProposalDecision) → CustomerScheduleProposalResponse
//   POST customer/schedule-proposals/:id/reject   (same)
// CustomerAuthGuard + the /customer realm: a CUSTOMER session only. The customer is resolved from the session (customers
// row linked to the user in that salon) — never from the request; another customer's proposal answers 404.
// Lives beside the proposal service (one injector with the engine it hands decisions to) rather than in apps/api's
// CustomerModule, which would have to import the whole optimizer module for two routes.
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CustomerAuthGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SCHED_CUSTOMER_PROPOSAL_DECISION_BODY } from '../request-schemas';
import type { CustomerScheduleProposalDecision, CustomerScheduleProposalList, CustomerScheduleProposalResponse } from '@aipowersalon/api-contracts/customer';
import { ScheduleProposalService } from './ai-scheduling-proposals';
import { schedOpsRun } from './ai-scheduling-ops.common';

const who = (req: any) => { const c = req?.ctx || {}; return { tenantId: String(c.tenantId ?? ''), userId: String(c.userId ?? '') }; };

@Controller('customer/schedule-proposals')
@UseGuards(CustomerAuthGuard)
export class CustomerScheduleProposalsController {
  constructor(private readonly proposals: ScheduleProposalService) {}

  @Get()
  list(@Req() r: any): Promise<CustomerScheduleProposalList> { return schedOpsRun(() => this.proposals.listForCustomer(who(r))); }

  @Post(':id/approve')
  approve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SCHED_CUSTOMER_PROPOSAL_DECISION_BODY)) b: CustomerScheduleProposalDecision): Promise<CustomerScheduleProposalResponse> {
    return schedOpsRun(async () => ({ proposal: await this.proposals.customerDecide(who(r), String(id), true, b?.expectedVersion) }));
  }

  @Post(':id/reject')
  reject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SCHED_CUSTOMER_PROPOSAL_DECISION_BODY)) b: CustomerScheduleProposalDecision): Promise<CustomerScheduleProposalResponse> {
    return schedOpsRun(async () => ({ proposal: await this.proposals.customerDecide(who(r), String(id), false, b?.expectedVersion) }));
  }
}
