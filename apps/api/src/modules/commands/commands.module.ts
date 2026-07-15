import { Module } from '@nestjs/common';

// Vacío hasta Fase 5. Cualquier controlador de comandos que se añada aquí debe usar
// @UseGuards(JwtAuthGuard, MinTierGuard) + @MinTier('operator') como mínimo, y queda
// además detrás de OPCUA_WRITES_ENABLED (regla 9 del prompt maestro).
@Module({})
export class CommandsModule {}
