/**
 * Llamada de prueba al canal OFICIAL de comandos (Fase 5) — reemplaza los scripts crudos de
 * node-opcua de esta noche. Pasa por JwtAuthGuard + PermissionGuard + PlantScopeGuard →
 * WriteService: RBAC por mapping, interlock, idempotencia, read-back con timeout, auditoría SIEMPRE.
 *
 * Requiere un JWT real (ver scripts/mint-test-jwt.ts) de una cuenta con el permiso `control_valves`.
 *
 * Uso:
 *   CALL_TOKEN=<jwt> npm exec -w @ptap/api -- tsx scripts/call-valve-command.ts \
 *     [baseUrl] [plantId] [command] [target] [idempotencyKey]
 *
 * Ejemplo (instancia de prueba en :4001, planta sirena, abrir valve1):
 *   CALL_TOKEN=eyJ... npm exec -w @ptap/api -- tsx scripts/call-valve-command.ts \
 *     http://127.0.0.1:4001 sirena open valve1
 */
const BASE_URL = process.argv[2] ?? process.env.CALL_BASE_URL ?? 'http://127.0.0.1:4001';
const PLANT_ID = process.argv[3] ?? 'sirena';
const COMMAND = process.argv[4] ?? 'open';
const TARGET = process.argv[5] ?? 'valve1';
const IDEMPOTENCY_KEY = process.argv[6] ?? process.env.CALL_IDEMPOTENCY_KEY;
const TOKEN = process.env.CALL_TOKEN;

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('Falta CALL_TOKEN (JWT). Genera uno con: tsx scripts/mint-test-jwt.ts correo@ejemplo.com');
    process.exit(2);
  }

  const url = `${BASE_URL}/api/plants/${PLANT_ID}/commands`;
  const body: Record<string, string> = { command: COMMAND, target: TARGET };
  if (IDEMPOTENCY_KEY) body.idempotencyKey = IDEMPOTENCY_KEY;

  console.log(`== Comando oficial (Fase 5) ==`);
  console.log(`POST ${url}`);
  console.log(`body: ${JSON.stringify(body)}`);
  console.log(`${new Date().toISOString()}\n`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* respuesta no-JSON (p.ej. 401 sin body estructurado) */
  }

  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(json, null, 2));

  if (res.status === 200) {
    console.log('\n✅ status:"confirmed" — read-back confirmó el valor esperado.');
  } else if (res.status === 502) {
    console.log('\n⚠️  status:"failed" — se escribió pero el read-back NO confirmó dentro del timeout.');
  } else {
    console.log('\n❌ rechazado ANTES de escribir (ver "reason" arriba: RBAC/interlock/writes-disabled/etc).');
  }
}

main().catch((err) => {
  console.error('call-valve-command falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
