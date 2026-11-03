// ai-inventory.module.ts — AI Inventory Assistant module.
//   Slice 1: the read-only inventory POSITION backbone. The analysis service reads the AUTHORITATIVE inventory tables
//   through a read-only port bound to the READ replica (DATABASE_READ) in production, or an in-memory fake when no DB is
//   present (tests/local). It never mutates stock and never duplicates the inventory ledger — mutations always go through
//   the existing Inventory module's authorized services in later slices.
import { Module } from '@nestjs/common';
import { AiInventoryController } from './ai-inventory.controller';
import { AiInventoryPositionService } from './ai-inventory-position.service';
import { AiInventoryReorderService } from './ai-inventory-reorder.service';
import { AiInventorySlowMovingService } from './ai-inventory-slowmoving.service';
import { AiInventoryRecipeService } from './ai-inventory-recipe.service';
import { InMemoryInventoryRead, type InventoryReadPort } from './ai-inventory.port';
import { KyselyInventoryRead } from './ai-inventory.kysely.port';
import { InMemoryRecipeRepository, type RecipeRepositoryPort } from './ai-inventory-recipe.repository';
import { KyselyRecipeRepository } from './ai-inventory-recipe.kysely.repository';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { InventoryCenter } from './inventory-center';
import { InventoryCenterController, INVENTORY_CENTER } from './inventory-center.controller';

@Module({
  controllers: [AiInventoryController, InventoryCenterController],
  providers: [
    // AI Inventory Assistant guides (Nov 3 2026): cards with definitions, products, stock activity, the system check (read-only)
    { provide: INVENTORY_CENTER, useFactory: (db: AppDatabase) => (db ? new InventoryCenter(db as never) : null), inject: [DATABASE] },
    {
      provide: 'InventoryReadPort',
      useFactory: (db: AppDatabase): InventoryReadPort => (db ? new KyselyInventoryRead(db) : new InMemoryInventoryRead()),
      inject: [DATABASE_READ],
    },
    {
      provide: AiInventoryPositionService,
      useFactory: (read: InventoryReadPort) => new AiInventoryPositionService(read),
      inject: ['InventoryReadPort'],
    },
    {
      provide: AiInventoryReorderService,
      useFactory: (read: InventoryReadPort) => new AiInventoryReorderService(read),
      inject: ['InventoryReadPort'],
    },
    {
      provide: AiInventorySlowMovingService,
      useFactory: (read: InventoryReadPort) => new AiInventorySlowMovingService(read),
      inject: ['InventoryReadPort'],
    },
    // Recipes are a WRITE surface — persisted on the PRIMARY db (read-after-write on approve), in-memory when no DB.
    {
      provide: 'RecipeRepositoryPort',
      useFactory: (db: AppDatabase): RecipeRepositoryPort => (db ? new KyselyRecipeRepository(db) : new InMemoryRecipeRepository()),
      inject: [DATABASE],
    },
    {
      provide: AiInventoryRecipeService,
      useFactory: (repo: RecipeRepositoryPort) => new AiInventoryRecipeService(repo),
      inject: ['RecipeRepositoryPort'],
    },
  ],
  exports: [AiInventoryPositionService, AiInventoryReorderService, AiInventorySlowMovingService, AiInventoryRecipeService],
})
export class AiInventoryModule {}
