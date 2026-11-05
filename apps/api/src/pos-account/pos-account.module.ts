import { Module } from '@nestjs/common';
import { PosAccountController } from './pos-account.controller';
import { PosAccountService } from './pos-account.service';

@Module({
  controllers: [PosAccountController],
  providers: [PosAccountService],
  exports: [PosAccountService],
})
export class PosAccountModule {}
