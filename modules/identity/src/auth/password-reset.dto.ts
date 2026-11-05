// password-reset.dto.ts — class-validator DTOs for the tenant reset flow (§5, §8, §9).
import { IsString, IsOptional, MinLength, IsBoolean } from "class-validator";

export class RequestTenantPasswordResetDto {
  @IsString() salonCode!: string;
  @IsString() phone!: string;
}
export interface RequestTenantPasswordResetResponse { ok: true; message: string; }

export class TenantLoginDto {
  @IsString() tenantCodeOrSlug!: string;
  @IsString() emailOrPhone!: string;
  @IsString() password!: string;
  @IsOptional() @IsBoolean() rememberDevice?: boolean;
  @IsOptional() @IsString() deviceName?: string;
}
export interface TenantLoginResponse {
  accessToken?: string; refreshToken?: string;
  forcePasswordReset?: boolean; resetSessionToken?: string;
  user?: { userId: string; fullName: string; role: string };
  tenant?: { tenantId: string; salonName: string; tenantCode: string };
}

export class CompletePasswordResetDto {
  @IsString() resetSessionToken!: string;
  @IsString() @MinLength(10) newPassword!: string;
  @IsString() confirmPassword!: string;
}
export interface CompletePasswordResetResponse {
  accessToken: string; refreshToken: string;
  user: { userId: string; fullName: string; role: string; permissions: string[] };
  tenant: { tenantId: string; salonName: string; tenantCode: string };
  branch: { branchId: string; branchName: string };
}
