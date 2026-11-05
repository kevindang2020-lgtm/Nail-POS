// pos-search.dto.ts — query DTO. NOTE: tenantId/branchId are NEVER accepted here; derived from session.
import { IsString, IsOptional, IsIn, MinLength } from "class-validator";
export class PosSearchQueryDto {
  @IsString() @MinLength(2) q!: string;
  @IsOptional() @IsIn(["overview", "customers", "appointments", "services", "technicians", "tickets", "receipts", "queue"]) scope?: string;
}
export class PosSearchOpenDto {
  @IsString() resultType!: string;
  @IsString() entityId!: string;
  @IsString() q!: string;
}
