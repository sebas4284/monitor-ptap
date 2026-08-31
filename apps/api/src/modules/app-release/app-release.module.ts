import { Module } from '@nestjs/common';
import { AppReleaseController } from './app-release.controller';
import { AppReleaseService } from './app-release.service';
import { NovedadesService } from './novedades.service';

/** Sin dependencias: solo lee del disco lo que hay publicado. */
@Module({
  controllers: [AppReleaseController],
  providers: [AppReleaseService, NovedadesService],
})
export class AppReleaseModule {}
