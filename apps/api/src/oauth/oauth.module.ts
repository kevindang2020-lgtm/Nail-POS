import { Module } from '@nestjs/common';
import { OAuthController, ConnectedAppsController } from './oauth.controller';
/** Constitution 3 Step 10d — the OAuth authorization server. */
@Module({ controllers: [OAuthController, ConnectedAppsController] })
export class OAuthModule {}
