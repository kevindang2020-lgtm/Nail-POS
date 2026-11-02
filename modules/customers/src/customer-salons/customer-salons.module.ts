import { Module } from '@nestjs/common';
import { CustomerSalonsController } from './customer-salons.controller';
import { CustomerFavoritesController } from './customer-favorites.controller';
import { CustomerSalonsService } from './customer-salons.service';
import { GooglePlacesProvider } from './google-places.provider';

@Module({ controllers: [CustomerSalonsController, CustomerFavoritesController], providers: [CustomerSalonsService, GooglePlacesProvider], exports: [CustomerSalonsService] })
export class CustomerSalonsModule {}
