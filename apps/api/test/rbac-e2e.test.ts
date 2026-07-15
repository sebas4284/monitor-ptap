/**
 * E2E ligero (Fase 4, criterio de aceptación): "sin JWT → 401; rol insuficiente → 403"
 * probado con requests HTTP reales (@nestjs/testing + supertest) contra un controlador
 * de prueba con rutas viewer/operator/admin — sin MYSQL_POOL ni AuthController real
 * (login no se prueba aquí, eso es responsabilidad de auth.service, no de los guards).
 */
import 'reflect-metadata';
import { test } from 'node:test';
import { Controller, Get, INestApplication, Module, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MinTier } from '../src/modules/auth/decorators/min-tier.decorator';
import { Public } from '../src/modules/auth/decorators/public.decorator';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { MinTierGuard } from '../src/modules/auth/guards/min-tier.guard';
import { JwtService } from '../src/modules/auth/jwt.service';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-rbac-e2e';

@Controller('probe')
@UseGuards(JwtAuthGuard, MinTierGuard)
class ProbeController {
  @Public()
  @Get('public')
  publicRoute() {
    return { ok: true };
  }

  @Get('viewer')
  @MinTier('viewer')
  viewerRoute() {
    return { ok: true };
  }

  @Get('admin')
  @MinTier('admin')
  adminRoute() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController], providers: [JwtAuthGuard, MinTierGuard, JwtService] })
class ProbeModule {}

async function buildApp(): Promise<{ app: INestApplication; jwt: JwtService }> {
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, jwt: moduleRef.get(JwtService) };
}

test('rbac-e2e: ruta @Public() responde 200 sin token', async () => {
  const { app } = await buildApp();
  try {
    await request(app.getHttpServer()).get('/probe/public').expect(200);
  } finally {
    await app.close();
  }
});

test('rbac-e2e: ruta protegida sin Authorization → 401', async () => {
  const { app } = await buildApp();
  try {
    await request(app.getHttpServer()).get('/probe/viewer').expect(401);
  } finally {
    await app.close();
  }
});

test('rbac-e2e: token válido pero rol insuficiente (civil pide admin) → 403', async () => {
  const { app, jwt } = await buildApp();
  try {
    const token = jwt.sign({ sub: 'u1', email: 'a@b.com', name: 'A', role: 'civil', plant: 'montebello' });
    await request(app.getHttpServer()).get('/probe/admin').set('Authorization', `Bearer ${token}`).expect(403);
  } finally {
    await app.close();
  }
});

test('rbac-e2e: token válido con rol suficiente (admin) → 200 en ruta admin y viewer', async () => {
  const { app, jwt } = await buildApp();
  try {
    const token = jwt.sign({ sub: 'u1', email: 'a@b.com', name: 'A', role: 'admin', plant: 'montebello' });
    await request(app.getHttpServer()).get('/probe/admin').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).get('/probe/viewer').set('Authorization', `Bearer ${token}`).expect(200);
  } finally {
    await app.close();
  }
});

test('rbac-e2e: token válido con rol operador → 200 en viewer, 403 en admin', async () => {
  const { app, jwt } = await buildApp();
  try {
    const token = jwt.sign({ sub: 'u1', email: 'a@b.com', name: 'A', role: 'operador', plant: 'montebello' });
    await request(app.getHttpServer()).get('/probe/viewer').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).get('/probe/admin').set('Authorization', `Bearer ${token}`).expect(403);
  } finally {
    await app.close();
  }
});
