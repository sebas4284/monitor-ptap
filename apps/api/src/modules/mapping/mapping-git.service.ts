import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import Ajv2020 from 'ajv/dist/2020';
import { aplicarOverrides, aplicarSobreRaw, bufferDeLaSenal, validarParche, type MappingOverride } from '../../infrastructure/connectivity/mapping/mapping-overrides';
import { loadMapping, type LoadedMapping } from '../../infrastructure/connectivity/mapping/opc-mapping.loader';
import { PlantPipelineService } from '../../infrastructure/connectivity/pipeline/plant-pipeline.service';
import { MappingOverrideRepository } from './mapping-override.repository';
import { mappingPatchSchema } from './mapping-patch.schema';
import { MappingWriteLock } from './mapping-write-lock';

const execute = promisify(execFile);
const MAPPING = 'apps/api/config/opc_mapping.json';
const SCHEMA = 'apps/api/config/opc_mapping.schema.json';
const BRANCH = 'yosh';

interface GitConfiguration {
  repoPath: string;
  remote: string;
  name: string;
  email: string;
  sshLauncher?: string;
}

function reject(motivo: string, message: string): never {
  throw new ConflictException({ motivo, message });
}

/** A checkout descartable impide que un fallo de commit/push modifique el despliegue en ejecución. */
export async function exportMappingToGit(config: GitConfiguration, base: LoadedMapping, overrides: MappingOverride[]) {
  const root = await realpath(config.repoPath);
  const lock = join(tmpdir(), `ptap-mapping-git-${createHash('sha256').update(root).digest('hex')}.lock`);
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') reject('GIT_OCUPADO', 'Ya hay una exportación de mapeo en curso.');
    throw error;
  }
  let temporary: string | undefined;
  try {
    temporary = await mkdtemp(join(tmpdir(), 'ptap-mapping-export-'));
    const hooks = join(temporary, 'hooks');
    await mkdir(hooks);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TMPDIR: tmpdir(),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH: config.sshLauncher,
      GIT_SSH_VARIANT: 'ssh',
    };
    const git = async (cwd: string, args: string[]) => {
      try {
        const { stdout } = await execute('git', [
          '-c', `core.hooksPath=${hooks}`, '-c', 'core.fsmonitor=false', '-c', 'credential.helper=',
          '-c', 'protocol.ext.allow=never', ...args,
        ], { cwd, env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
        return stdout.trim();
      } catch {
        // Git stderr puede contener rutas de claves o información del transporte: no va a la API.
        throw new ServiceUnavailableException({ motivo: 'GIT_FALLO', message: 'Git no completó la exportación. Se conservan el despliegue y todos los overrides; sincroniza y vuelve a intentarlo.' });
      }
    };
    if (await realpath(await git(root, ['rev-parse', '--show-toplevel'])) !== root) reject('GIT_REPOSITORIO', 'La ruta debe ser la raíz del repositorio.');
    if (await git(root, ['branch', '--show-current']) !== BRANCH) reject('GIT_RAMA', 'El despliegue debe estar en yosh.');
    if (await git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'])) {
      reject('GIT_SUCIO', 'El repositorio tiene cambios locales. No se exporta ningún archivo.');
    }
    const head = await git(root, ['rev-parse', 'HEAD']);
    const work = join(temporary, 'checkout');
    await git(temporary, ['clone', '--no-hardlinks', '--single-branch', '--branch', BRANCH, '--', root, work]);
    if (await git(work, ['rev-parse', 'HEAD']) !== head) reject('GIT_CAMBIO', 'El repositorio cambió durante la exportación.');
    const remoteHead = (await git(work, ['ls-remote', '--exit-code', config.remote, `refs/heads/${BRANCH}`])).split(/\s/)[0];
    if (remoteHead !== head) reject('GIT_DESACTUALIZADO', 'yosh local y remota difieren. Sincroniza mediante el despliegue normal antes de exportar.');
    const mappingPath = join(work, MAPPING);
    const loaded = loadMapping(mappingPath);
    if (!isDeepStrictEqual(loaded.raw, base.raw)) reject('GIT_BASE_DISTINTA', 'El JSON del repositorio no coincide con el mapeo base del proceso.');
    let effective = loaded;
    for (const override of overrides) {
      const parsed = mappingPatchSchema.safeParse(override.patch);
      if (!parsed.success) throw new BadRequestException({ motivo: 'PARCHE_INVALIDO', message: 'Un override no cumple el contrato de edición.' });
      const verdict = validarParche(effective, override.plantId, override.domainKey, parsed.data);
      if (!verdict.ok && verdict.motivo !== 'SIN_CAMBIOS') {
        throw new BadRequestException({ motivo: verdict.motivo, message: verdict.detalle });
      }
      effective = aplicarOverrides(effective, [override]);
    }
    const document = aplicarSobreRaw(loaded.raw, overrides);
    const schema: unknown = JSON.parse(await readFile(join(work, SCHEMA), 'utf8'));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema as object);
    if (!validate(document)) throw new BadRequestException({ motivo: 'SCHEMA_INVALIDO', message: 'El mapeo exportado no cumple el schema del repositorio.' });
    validateSemantics(effective);
    if (isDeepStrictEqual(document, loaded.raw)) return { status: 'sin_cambios' as const, commit: null, branch: BRANCH };
    await writeFile(mappingPath, `${JSON.stringify(document, null, 2)}\n`);
    loadMapping(mappingPath);
    await git(work, ['add', '--', MAPPING]);
    if (await git(work, ['diff', '--cached', '--name-only']) !== MAPPING) reject('GIT_ARCHIVOS', 'El commit debe contener exclusivamente el JSON del mapeo.');
    await git(work, ['-c', `user.name=${config.name}`, '-c', `user.email=${config.email}`, '-c', 'commit.gpgSign=false',
      'commit', '--no-verify', '-m', 'config: exportar correcciones del mapeo OPC']);
    const commit = await git(work, ['rev-parse', 'HEAD']);
    if (await git(root, ['rev-parse', 'HEAD']) !== head
      || await git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'])) {
      reject('GIT_CAMBIO', 'El repositorio cambió durante la exportación.');
    }
    // No force, rebase ni actualización del checkout vivo: un despliegue normal incorporará el commit.
    await git(work, ['push', '--porcelain', config.remote, `${commit}:refs/heads/${BRANCH}`]);
    return { status: 'publicado' as const, commit, branch: BRANCH };
  } finally {
    try {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}

function validateSemantics(mapping: LoadedMapping): void {
  const slots = new Map<string, number | null>();
  for (const signal of mapping.signals) {
    if ((signal.min != null && signal.max != null && signal.min >= signal.max)
      || (signal.opMin != null && signal.opMax != null && signal.opMin >= signal.opMax)) {
      throw new BadRequestException({ motivo: 'RANGO_INVALIDO', message: 'El mínimo debe ser menor que el máximo.' });
    }
    const buffer = bufferDeLaSenal(mapping, signal.plantId, signal.buffer, signal.sourceBuffer);
    if (!buffer || (buffer.arrayLength !== null && signal.index >= buffer.arrayLength)) {
      throw new BadRequestException({ motivo: 'INDICE_FUERA_DE_RANGO', message: 'Una señal queda fuera del buffer de destino.' });
    }
    const slot = `${signal.plantId}/${buffer.browseName}/${signal.index}`;
    const bits = signal.stateEncoding?.bits;
    const mask = !signal.writable && bits ? bits.open | bits.close | bits.fault : null;
    const previous = slots.get(slot);
    if (slots.has(slot) && (previous === null || mask === null || ((previous ?? 0) & mask) !== 0)) {
      throw new BadRequestException({ motivo: 'INDICE_DUPLICADO', message: 'Dos señales ocupan la misma posición sin bits independientes.' });
    }
    slots.set(slot, mask === null ? null : (previous ?? 0) | mask);
  }
}

@Injectable()
export class MappingGitService {
  constructor(
    @Inject(MappingOverrideRepository) private readonly repo: MappingOverrideRepository,
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
    @Inject(MappingWriteLock) private readonly writeLock: MappingWriteLock,
  ) {}

  async publicar() {
    return this.writeLock.run(() => this.publicarInterno());
  }

  private async publicarInterno() {
    if (process.env.MAPPING_GIT_ENABLED !== 'true') {
      throw new ServiceUnavailableException({ motivo: 'GIT_DESHABILITADO', message: 'La exportación Git está deshabilitada.' });
    }
    const repoPath = process.env.MAPPING_GIT_REPO_PATH;
    const remote = process.env.MAPPING_GIT_REMOTE;
    const keyPath = process.env.MAPPING_GIT_SSH_KEY_PATH;
    const sshLauncher = process.env.MAPPING_GIT_SSH_LAUNCHER;
    const name = process.env.MAPPING_GIT_AUTHOR_NAME;
    const email = process.env.MAPPING_GIT_AUTHOR_EMAIL;
    if (!repoPath || !isAbsolute(repoPath) || !remote || !/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(remote)
      || !keyPath || !isAbsolute(keyPath) || !sshLauncher || !isAbsolute(sshLauncher)
      || !name || !email || /[\r\n\0<>]/.test(name) || !/^[^\s<>@]+@[^\s<>@]+$/.test(email)
      || process.env.MAPPING_GIT_DEPLOY_KEY_CONFIRMED !== 'true') {
      throw new ServiceUnavailableException({ motivo: 'GIT_CONFIGURACION', message: 'Falta la configuración administrativa o confirmar la deploy key limitada al repositorio.' });
    }
    const root = await realpath(repoPath);
    for (const external of [keyPath, sshLauncher]) {
      const actual = await realpath(external);
      const fromRepo = relative(root, actual);
      const metadata = await stat(actual);
      if ((!fromRepo.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(fromRepo))
        || !metadata.isFile() || process.platform === 'win32'
        || (metadata.mode & 0o077) !== 0 || (external === keyPath && (metadata.mode & 0o777) !== 0o600)) {
        throw new ServiceUnavailableException({ motivo: 'GIT_CREDENCIAL', message: 'La clave y el launcher deben ser archivos privados fuera del repositorio.' });
      }
    }
    return exportMappingToGit({ repoPath: resolve(root), remote, sshLauncher, name, email },
      this.pipeline.getBaseMapping(), await this.repo.listarEfectivos());
  }
}
