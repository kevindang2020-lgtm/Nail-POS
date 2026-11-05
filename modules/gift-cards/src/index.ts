// modules/gift-cards — the gift-cards domain (Constitution 13 Phase 6): the ONE public entry point (§97). Grouped layout
// (src/<dir>/...) since gift-card-stock joined; the original directory keeps its keys (gift-cards/<file>). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { GiftCardsModule } from './gift-cards/gift-cards.module';
export * from './gift-cards/gift-cards.dto';
export { GiftCardsService } from './gift-cards/gift-cards.service';   // Decision 31 liability report (checkout real-PG test)
export { KyselyGiftCardsRepository } from './gift-cards/gift-cards.kysely.repository';
export { giftCardChargeForTicket } from './gift-cards/gift-card-charge';   // used by the API today
export { CLAIM_TTL_DAYS, claimValidity, hashClaimToken, mintClaimToken } from './gift-cards/gift-card-claim-core';   // used by the API today
export { canTransitionSettlement, clearingObligation, crossTenantRedeemable, settlementTotals } from './gift-cards/gift-card-clearing-core';   // used by the API today
export { generateCardNumber, hashCardNumber, hashCardPin, lastFour, maskCardNumber, maskFromLast4} from './gift-cards/gift-card-number-core';   // used by the API today
// joined by --into (gift-card-stock):
export { GiftCardStockModule } from './gift-card-stock/gift-card-stock.module';
export { KyselyGiftCardStockRepo } from './gift-card-stock/gift-card-stock.repository';   // used by the API today
export { GIFT_CARD, GIFT_CARD_STOCK } from './gift-card-lifecycles';   // Phase 12 (#27): checkout, apps/api
