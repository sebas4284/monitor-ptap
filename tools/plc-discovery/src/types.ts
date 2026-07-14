export interface RootSpec {
  label: string;
  path: string[];
  comment?: string;
  optional?: boolean;
}

export interface DiscoveryConfig {
  endpointUrl: string;
  rootPath: string[];
  additionalRoots: RootSpec[];
  username?: string;
  password?: string;
  throttleMs: number;
  browseBatch: number;
  readBatch: number;
  sampleCount: number;
  sampleIntervalMs: number;
  maxNodes: number;
  maxDepth: number;
  outputDir: string;
  docsDir: string;
}

export interface JsonStatusCode {
  name: string;
  value: number;
  severity: 'Good' | 'Uncertain' | 'Bad';
}

export interface AttemptLog {
  securityMode: string;
  securityPolicy: string;
  identity: string;
  error: string;
}

// ── output/00_endpoints.json ────────────────────────────────────────────────
export interface EndpointsArtifact {
  capturedAt: string;
  requestedEndpoint: string;
  endpoints: Array<{
    endpointUrl: string;
    securityMode: string;
    securityPolicyUri: string;
    securityLevel: number;
    userTokens: string[];
  }>;
  hostnameMismatch: {
    detected: boolean;
    external: string;
    announcedByServer: string[];
    workaround: string;
  };
  sessionEstablished: {
    securityMode: string;
    securityPolicy: string;
    identity: string;
    attempts: AttemptLog[];
  };
  namespaces: string[];
  operationLimits: {
    maxNodesPerRead: number | null;
    maxNodesPerBrowse: number | null;
    maxNodesPerTranslate: number | null;
    maxBrowseContinuationPoints: number | null;
    maxArrayLength: number | null;
  };
  effectiveBatches: { read: number; browse: number };
  server: {
    state: string;
    productName: string | null;
    manufacturerName: string | null;
    softwareVersion: string | null;
    currentTime: string | null;
    clockSkewMs: number | null;
  };
}

// ── output/01_nodes.json ────────────────────────────────────────────────────
export interface BrowsedNode {
  nodeId: string;
  nsUri: string;
  rootLabel: string;
  browseName: string;
  displayName: string;
  nodeClass: string;
  typeDefinition: string | null;
  referenceType: string;
  parentNodeId: string;
  fullBrowsePath: string;
  depth: number;
  hasChildren: boolean;
}

export interface ResolvedRoot {
  label: string;
  path: string[];
  nodeId: string | null;
  found: boolean;
  error?: string;
  nodeCount: number;
  steps: Array<{
    segment: string;
    matchedBrowseName: string;
    nodeId: string;
    siblingBrowseNames: string[];
  }>;
}

export interface NodesArtifact {
  capturedAt: string;
  endpointUrl: string;
  roots: ResolvedRoot[];
  namespaces: string[];
  nodes: BrowsedNode[];
  stats: {
    total: number;
    variables: number;
    objects: number;
    methodsSeenNeverCalled: number;
    maxDepthReached: number;
    cappedAtLimit: boolean;
    duplicateReferencesSkipped: number;
    badBrowseResults: number;
  };
}

// ── output/02_readings.json ─────────────────────────────────────────────────
export interface ValueSample {
  t: string;
  value: unknown;
  statusCode: JsonStatusCode;
  sourceTimestamp: string | null;
  serverTimestamp: string | null;
}

export interface EuInformationJson {
  displayName: string | null;
  description: string | null;
  unitId: number | null;
  namespaceUri: string | null;
}

export interface RangeJson {
  low: number;
  high: number;
}

export interface VariableReading {
  nodeId: string;
  browseName: string;
  displayName: string;
  fullBrowsePath: string;
  parentNodeId: string;
  attrs: {
    description: string | null;
    dataType: { nodeId: string; name: string };
    valueRank: number;
    arrayDimensions: number[] | null;
    accessLevel: {
      raw: number;
      currentRead: boolean;
      currentWrite: boolean;
      historyRead: boolean;
      historyWrite: boolean;
    };
    userAccessLevel: {
      raw: number;
      currentRead: boolean;
      currentWrite: boolean;
    };
    minimumSamplingInterval: number | null;
    historizing: boolean;
    engineeringUnits: EuInformationJson | null;
    euRange: RangeJson | null;
    instrumentRange: RangeJson | null;
  };
  valueVariantType: string | null;
  samples: ValueSample[];
  movement: {
    changed: boolean;
    numeric: boolean;
    min: number | null;
    max: number | null;
    monotonicNonDecreasing: boolean;
  } | null;
}

export interface ReadingsArtifact {
  capturedAt: string;
  endpointUrl: string;
  sampleCount: number;
  sampleIntervalMs: number;
  namespaces: string[];
  typeDefinitionNames: Record<string, string>;
  readings: VariableReading[];
  stats: {
    variablesRead: number;
    goodValues: number;
    uncertainValues: number;
    badValues: number;
    withEngineeringUnits: number;
    writableByServer: number;
    writableByUser: number;
    changedDuringSampling: number;
  };
}
