# Catalog Management · Business Management · Platform Overview — Deep-Chain Matrix

Final three sections. All routes behind `@UseGuards(SuperAdminGuard)`; all modules registered in AppModule.

## Catalog Management

| Item | Route → Page | Endpoint · Controller (guard) | Module | Audit | DB migrations | Tests | Status |
|---|---|---|---|---|---|---|---|
| Catalog (oversight) | `/catalog` → `CatalogScreen` | `/super-admin/catalog` · `SuperAdminCatalogController` | `SuperAdminCatalogModule` | 9 | — | 3 | Complete |
| Service Templates | `/service-templates` → `ServiceTemplatesScreen` | `/super-admin/catalog/service-templates` · `SuperAdminCatalogController` | `SuperAdminCatalogModule` | (9, shared) | **183–186** (templates, lifecycle, deployment tracking) | (in catalog) | Complete |
| Product Catalog | `/product-catalog` → `ProductCatalogScreen` | `/super-admin/product-catalog/*` · `SuperAdminProductController` | `SuperAdminProductCatalogModule` | — | product-catalog tables | **10** | Complete |
| Business Categories | (settings) → categories | `/super-admin/settings/general/business-categories` · `BusinessCategoriesController` | `BusinessCategoriesModule` | 5 | **205** | 1 | Complete |

Service templates carry lifecycle + **deployment tracking** (183–186) so tenants copy/customize without the
platform overwriting their customized services (per spec).

## Business Management

| Item | Route → Page | Endpoint · Controller (guard) | Module | Audit | DB | Tests | Status |
|---|---|---|---|---|---|---|---|
| Marketing & Campaigns | `/marketing-campaigns` → `SuperAdminCampaignsScreen` | `/super-admin/campaigns` · CampaignsController | `CampaignsModule` | — | **113** (campaigns), **240** (campaign_compliance) | — | Complete |
| Promotions & Offers | `/promotions-offers` → `PromotionsScreen` | `/super-admin/promotions` · PromotionsController | `PromotionsModule` | — | **178** (plan_addons_promotions_trials) | 4 | Complete |
| Loyalty Programs | `/loyalty-programs` → `LoyaltyProgramsScreen` | `/super-admin/loyalty` · LoyaltyController | `LoyaltyModule` | 3 | **048, 212, 213** (suspicious cases), **214** (calc corrections) | 7 | Complete |
| Communications | `/communications` (+ inbox) → `CommunicationsOverviewScreen` | `/super-admin/communications` · CommunicationsController | `CommunicationsModule` | — | **114** | — | Complete |
| Memberships | `/membership-programs` (`/memberships`→redirect) → `MembershipProgramsScreen` | `/super-admin/membership-programs` · Controller | `SuperAdminMembershipProgramsModule` (+ `MembershipsModule`) | — | **189** (seed) | 4+1 | Complete |

Salon customer memberships (`membership-programs`) are kept separate from tenant→AIPowerSalon software
subscriptions (Billing section) — distinct modules, routes, and tables, per spec.

## Platform Overview

| Item | Route → Page | Endpoint · Controller (guard) | Module | Audit | Tests | Status |
|---|---|---|---|---|---|---|
| Overview | `/dashboard` → `DashboardScreen` | `/super-admin/dashboard` · DashboardController | `DashboardModule` | — | 2 | Complete |
| Live Operations | `/live-operations` → `LiveOperationsScreen` | `/super-admin/platform` (+overview) · Platform/Overview | `SuperAdminOverviewModule` / `OverviewAggregateModule` | — | 2+1 | Complete |
| Analytics | `/analytics` → `AnalyticsScreen` | `/super-admin/analytics` · AnalyticsController | `SuperAdminAnalyticsModule` | 2 | 1 | Complete |
| Platform Dashboard | `/platform-dashboard` → `PlatformDashboardScreen` | `/super-admin/overview` · Overview | `SuperAdminOverviewModule` | — | — | Complete |
| Report Builder | `/report-builder` → `ReportBuilderScreen` | `/super-admin/report-builder` · ReportBuilderController | `SuperAdminReportBuilderModule` | 5 | 1 | Complete |
| Scheduled Reports | `/scheduled-reports` → `ScheduledReportsScreen` | `/super-admin/scheduled-reports` · Controller | `SuperAdminScheduledReportsModule` | 6 | **218** | 1 | Complete |

Overview / Live Ops / Analytics / Platform Dashboard are read-only monitoring surfaces (aggregate platform
metrics); Report Builder and Scheduled Reports write audit records for report definitions/schedules.

## Notes
- These are lower-sensitivity, largely read/config surfaces; where mutations exist (loyalty corrections,
  report schedules, template deployment, business categories) the service writes audit records.
- Money-bearing figures (memberships, promotions, campaign spend) use integer cents.
- All routes server-guarded by `SuperAdminGuard`; all modules imported in AppModule.
