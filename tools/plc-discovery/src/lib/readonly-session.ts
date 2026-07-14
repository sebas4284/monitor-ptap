import type {
  BrowseDescriptionLike,
  BrowseResult,
  ClientSession,
  DataValue,
  ReadValueIdOptions,
} from 'node-opcua';

/**
 * Fachada de SOLO LECTURA sobre ClientSession.
 *
 * Garantía estructural de las reglas del proyecto: este tipo NO expone
 * write(), call(), createSubscription2() ni ningún otro servicio mutante.
 * Todos los steps reciben esta fachada, nunca la sesión cruda, de modo que
 * un Write/Call accidental es un error de compilación, no un riesgo operativo.
 */
export class ReadOnlySession {
  constructor(private readonly session: ClientSession) {}

  browse(nodesToBrowse: BrowseDescriptionLike[]): Promise<BrowseResult[]> {
    return this.session.browse(nodesToBrowse);
  }

  browseNext(continuationPoints: Buffer[], releaseContinuationPoints: boolean): Promise<BrowseResult[]> {
    return this.session.browseNext(continuationPoints, releaseContinuationPoints);
  }

  read(nodesToRead: ReadValueIdOptions[], maxAge = 0): Promise<DataValue[]> {
    return this.session.read(nodesToRead, maxAge);
  }

  readNamespaceArray(): Promise<string[]> {
    return this.session.readNamespaceArray();
  }

  close(): Promise<void> {
    return this.session.close();
  }
}
