import type { InjectOptions, LightMyRequestResponse } from 'fastify';

import { buildApp } from '../../src/app.js';

type InjectWorkerInput = {
  databasePath: string;
  request: {
    method: NonNullable<InjectOptions['method']>;
    url: string;
    payload?: InjectOptions['payload'];
    headers?: InjectOptions['headers'];
  };
};

async function main() {
  const rawInput = process.argv[2];
  if (!rawInput) {
    throw new Error('Missing inject worker input');
  }

  const input = JSON.parse(rawInput) as InjectWorkerInput;
  const { app } = await buildApp({ databasePath: input.databasePath, logger: false });

  try {
    const request: InjectOptions = {
      method: input.request.method,
      url: input.request.url,
      payload: input.request.payload,
      headers: input.request.headers,
    };

    const response: LightMyRequestResponse = await app.inject(request);

    process.stdout.write(
      `${JSON.stringify({
        statusCode: response.statusCode,
        body: response.body,
      })}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
