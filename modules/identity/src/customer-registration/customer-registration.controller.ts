// customer-registration.controller.ts — PUBLIC customer self-signup. POST /customer/auth/register creates a CUSTOMER
// account for a salon (by salon code) so the customer can then sign in. No auth guard (public, like password-reset).
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { CUSTOMER_REGISTER_BODY } from '../request-schemas';
import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { CustomerRegistrationService } from './customer-registration.service';

@Controller('customer/auth')
export class CustomerRegistrationController {
  constructor(private readonly svc: CustomerRegistrationService) {}

  @Post('register') @HttpCode(200)
  register(@Body(ValidatedBody(CUSTOMER_REGISTER_BODY)) b: any) { return this.svc.register(b ?? {}); }
}
