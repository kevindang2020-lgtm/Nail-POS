import { Module } from '@nestjs/common';
import { SuperAdminProductCatalogController } from './super-admin-product-catalog.controller';
import { CatalogOversightService } from './super-admin-product-catalog.service';
import { InMemoryCatalogRepo, type CatalogRepo } from './super-admin-product-catalog.repository';
import { KyselyCatalogRepo } from './super-admin-product-catalog.kysely.repository';
import { InMemoryMasterProductRepo, type MasterProductRepo } from './product-master.repository';
import { KyselyMasterProductRepo } from './product-master.kysely.repository';
import { MasterProductService } from './product-master.service';
import { InMemoryImportRepo, type ImportRepo } from './product-import.repository';
import { KyselyImportRepo } from './product-import.kysely.repository';
import { ProductImportService } from './product-import.service';
import { InMemoryDistributionRepo, type DistributionRepo } from './product-distribution.repository';
import { KyselyDistributionRepo } from './product-distribution.kysely.repository';
import { ProductDistributionService } from './product-distribution.service';
import { InMemoryBarcodeRepo, type BarcodeRepo } from './product-barcode.repository';
import { KyselyBarcodeRepo } from './product-barcode.kysely.repository';
import { ProductBarcodeService } from './product-barcode.service';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

export const CATALOG_REPO = Symbol('CATALOG_REPO');
export const MASTER_PRODUCT_REPO = Symbol('MASTER_PRODUCT_REPO');
export const IMPORT_REPO = Symbol('IMPORT_REPO');
export const DISTRIBUTION_REPO = Symbol('DISTRIBUTION_REPO');
export const BARCODE_REPO = Symbol('BARCODE_REPO');

@Module({
  controllers: [SuperAdminProductCatalogController],
  providers: [
    {
      provide: CATALOG_REPO,
      useFactory: (db: AppDatabase): CatalogRepo => (db ? new KyselyCatalogRepo(db) : new InMemoryCatalogRepo()),
      inject: [DATABASE],
    },
    {
      provide: CatalogOversightService,
      useFactory: (repo: CatalogRepo) => new CatalogOversightService(repo),
      inject: [CATALOG_REPO],
    },
    {
      provide: MASTER_PRODUCT_REPO,
      useFactory: (db: AppDatabase): MasterProductRepo => (db ? new KyselyMasterProductRepo(db) : new InMemoryMasterProductRepo()),
      inject: [DATABASE],
    },
    {
      provide: MasterProductService,
      useFactory: (repo: MasterProductRepo) => new MasterProductService(repo),
      inject: [MASTER_PRODUCT_REPO],
    },
    {
      provide: IMPORT_REPO,
      useFactory: (db: AppDatabase): ImportRepo => (db ? new KyselyImportRepo(db) : new InMemoryImportRepo()),
      inject: [DATABASE],
    },
    {
      provide: ProductImportService,
      useFactory: (repo: ImportRepo) => new ProductImportService(repo),
      inject: [IMPORT_REPO],
    },
    {
      provide: DISTRIBUTION_REPO,
      useFactory: (db: AppDatabase): DistributionRepo => (db ? new KyselyDistributionRepo(db) : new InMemoryDistributionRepo()),
      inject: [DATABASE],
    },
    {
      provide: ProductDistributionService,
      useFactory: (repo: DistributionRepo) => new ProductDistributionService(repo),
      inject: [DISTRIBUTION_REPO],
    },
    {
      provide: BARCODE_REPO,
      useFactory: (db: AppDatabase): BarcodeRepo => (db ? new KyselyBarcodeRepo(db) : new InMemoryBarcodeRepo()),
      inject: [DATABASE],
    },
    {
      provide: ProductBarcodeService,
      useFactory: (repo: BarcodeRepo) => new ProductBarcodeService(repo),
      inject: [BARCODE_REPO],
    },
  ],
  exports: [CatalogOversightService, MasterProductService, ProductImportService, ProductDistributionService, ProductBarcodeService],
})
export class SuperAdminProductCatalogModule {}
