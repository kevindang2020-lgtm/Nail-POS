// mobile-links.controller.ts — BUILD_PLAN Phase 13 D (Constitution 6 §64–65): universal links (iOS) + App Links (Android).
//
//   GET /.well-known/apple-app-site-association — from APPLE_TEAM_ID (Kevin's Apple Developer Team ID); 404 without it
//   GET /.well-known/assetlinks.json             — from ANDROID_CERT_SHA256_<CUSTOMER|TECH|OWNER|MANAGER_PAY>; 404 without
//   GET /app-links/<app>/<route>[/<id>]          — the link was opened where the app is NOT installed: 302 to that app's web
//                                                  build (APP_LINK_WEB_<APP>) with ?link=<route>[/<id>]; 404 if unset
// Public by necessity (Apple / Google fetch the files with no session; the fallback is a plain browser visit) and excluded
// from the session middleware in app.module.ts. No tenant or user data; nothing is read from the database. The redirect is
// never open: the host comes only from env, and the path only from the closed route list (parseAppLink).
import { Controller, Get, Header, NotFoundException, Redirect, Req } from '@nestjs/common';
import { appleAppSiteAssociation, androidAssetLinks, parseAppLink, type LinkAppId, type AppleAppSiteAssociation, type AndroidAssetLinks, type AppLinkRedirect } from '@aipowersalon/api-contracts';

const ENV_APP: Record<LinkAppId, string> = { customer: 'CUSTOMER', tech: 'TECH', owner: 'OWNER', 'manager-pay': 'MANAGER_PAY' };

@Controller()
export class MobileLinksController {
  @Get('.well-known/apple-app-site-association')
  @Header('Content-Type', 'application/json')
  @Header('Cache-Control', 'public, max-age=3600')
  aasa(): AppleAppSiteAssociation {
    const body = appleAppSiteAssociation(process.env.APPLE_TEAM_ID);
    if (!body) throw new NotFoundException();
    return body;
  }

  @Get('.well-known/assetlinks.json')
  @Header('Cache-Control', 'public, max-age=3600')
  assetLinks(): AndroidAssetLinks {
    const body = androidAssetLinks(Object.fromEntries((Object.keys(ENV_APP) as LinkAppId[]).map((a) => [a, process.env[`ANDROID_CERT_SHA256_${ENV_APP[a]}`]])));
    if (!body) throw new NotFoundException();
    return body;
  }

  @Get('app-links/*')
  @Redirect()
  fallback(@Req() req: any): AppLinkRedirect {
    const parsed = parseAppLink(String(req?.path ?? req?.url ?? '').replace(/^\/api\/v1(?=\/)/, ''));
    if (!parsed) throw new NotFoundException();
    const base = String(process.env[`APP_LINK_WEB_${ENV_APP[parsed.app]}`] ?? '').trim();
    if (!/^https:\/\/[^/?#]+/i.test(base)) throw new NotFoundException();
    const id = Object.values(parsed.route.params)[0];
    const url = new URL(base); url.searchParams.set('link', `${parsed.route.name}${id ? '/' + id : ''}`);
    return { url: url.toString(), statusCode: 302 };
  }
}
