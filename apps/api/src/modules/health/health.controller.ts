import { Controller, Get } from '@nestjs/common';
import { ROLES } from '@ptap/shared';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'ptap-api',
      sharedRoles: ROLES.length,
    };
  }
}
