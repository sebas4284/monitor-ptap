import { ClientSession, MessageSecurityMode, OPCUAClient, SecurityPolicy, UserTokenType } from 'node-opcua';

interface ReadArgs {
  endpoint: string;
  nodeId: string;
  securityMode: string;
  securityPolicy: string;
  identity: { type: 'anonymous' } | { type: 'username'; userName: string; password: string };
}

function parseArgs(argv: string[]): ReadArgs {
  const result: ReadArgs = {
    endpoint: process.env.OPC_ENDPOINT ?? 'opc.tcp://localhost:4840',
    nodeId: process.env.OPC_NODE_ID ?? 'ns=2;s=Device1.Tag1',
    securityMode: process.env.OPC_SECURITY_MODE ?? 'None',
    securityPolicy: process.env.OPC_SECURITY_POLICY ?? 'None',
    identity: { type: 'anonymous' },
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--endpoint':
        result.endpoint = argv[++i] ?? result.endpoint;
        break;
      case '--node':
        result.nodeId = argv[++i] ?? result.nodeId;
        break;
      case '--security-mode':
        result.securityMode = argv[++i] ?? result.securityMode;
        break;
      case '--security-policy':
        result.securityPolicy = argv[++i] ?? result.securityPolicy;
        break;
      case '--identity':
        result.identity = argv[++i] === 'username'
          ? { type: 'username', userName: process.env.OPC_USERNAME ?? '', password: process.env.OPC_PASSWORD ?? '' }
          : { type: 'anonymous' };
        break;
      case '--username':
        if (result.identity.type === 'username') {
          result.identity.userName = argv[++i] ?? result.identity.userName;
        }
        break;
      case '--password':
        if (result.identity.type === 'username') {
          result.identity.password = argv[++i] ?? result.identity.password;
        }
        break;
      default:
        break;
    }
  }

  return result;
}

export function parseReadArgs(argv: string[]): ReadArgs {
  return parseArgs(argv);
}

async function readOneNode(args: ReadArgs): Promise<void> {
  const client = OPCUAClient.create({
    endpointMustExist: false,
    securityMode: (MessageSecurityMode as Record<string, number>)[args.securityMode] ?? MessageSecurityMode.None,
    securityPolicy: (SecurityPolicy as Record<string, string>)[args.securityPolicy] ?? SecurityPolicy.None,
  });

  try {
    await client.connect(args.endpoint);
    const session = await client.createSession(args.identity.type === 'username' ? {
      type: UserTokenType.UserName,
      userName: args.identity.userName,
      password: args.identity.password,
    } : { type: UserTokenType.Anonymous });

    const node = await session.readVariableValue(args.nodeId);
    console.log(JSON.stringify({ endpoint: args.endpoint, nodeId: args.nodeId, value: node.value.value }, null, 2));

    await session.close();
  } finally {
    await client.disconnect();
  }
}

if (require.main === module) {
  const args = parseReadArgs(process.argv.slice(2));
  void readOneNode(args).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
