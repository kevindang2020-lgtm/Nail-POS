// webauthn.dto.ts — Face ID register/authenticate DTOs (class-validator).
import { IsString, IsOptional } from "class-validator";
export class BeginRegistrationDto { @IsOptional() @IsString() deviceLabel?: string; }
export class FinishRegistrationDto {
  @IsString() handle!: string;
  @IsString() credentialId!: string;
  @IsString() publicKey!: string;     // base64url COSE
  @IsString() clientDataJSON!: string;
  @IsString() attestationObject!: string;
  @IsOptional() @IsString() transports?: string;
}
export class BeginAuthenticationDto {
  @IsOptional() @IsString() tenantCodeOrSlug?: string; // tenant login surface
  @IsOptional() @IsString() emailOrPhone?: string;     // optional hint to scope allowCredentials
}
export class FinishAuthenticationDto {
  @IsString() handle!: string;
  @IsString() credentialId!: string;
  @IsString() clientDataJSON!: string;
  @IsString() authenticatorData!: string;
  @IsString() signature!: string;
}
