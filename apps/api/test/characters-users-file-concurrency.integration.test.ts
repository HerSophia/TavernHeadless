import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type DataResponse<T> = { data: T };

type ChildInjectRequest = {
  method: string;
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
};

type ChildInjectResult = {
  statusCode: number;
  body: string;
};

const INJECT_WORKER_PATH = fileURLToPath(new URL('./helpers/inject-request-worker.ts', import.meta.url));
const FILE_CONCURRENCY_TEST_TIMEOUT_MS = 20_000;

function parseBody<T>(result: ChildInjectResult): T {
  return JSON.parse(result.body) as T;
}

async function runInjectedRequestInChild(
  databasePath: string,
  request: ChildInjectRequest,
): Promise<ChildInjectResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', INJECT_WORKER_PATH, JSON.stringify({ databasePath, request })],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: process.env.NODE_ENV ?? 'test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Inject worker exited with code ${code}\n${stderr || stdout || 'No worker output received'}`,
          ),
        );
        return;
      }

      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const lastLine = lines.at(-1);

      if (!lastLine) {
        reject(new Error(`Inject worker produced no output${stderr ? `\n${stderr}` : ''}`));
        return;
      }

      try {
        resolve(JSON.parse(lastLine) as ChildInjectResult);
      } catch (error) {
        reject(
          new Error(
            `Failed to parse inject worker output: ${lastLine}\n${stderr || (error instanceof Error ? error.message : String(error))}`,
          ),
        );
      }
    });
  });
}

async function importCharacter(app: FastifyInstance, name: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/import/character',
    payload: {
      payload: {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name,
          description: `${name} description`,
          personality: 'Thoughtful',
          scenario: 'Test scenario',
          first_mes: `Hello from ${name}`,
          mes_example: `<START>\\n${name}: hi`,
        },
      },
      create_session: false,
    },
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<
    DataResponse<{
      character_id: string;
      character_version_id: string;
    }>
  >().data;
}

async function createUser(app: FastifyInstance, name: string, description = 'desc') {
  const response = await app.inject({
    method: 'POST',
    url: '/users',
    payload: { snapshot: { name, description } },
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<
    DataResponse<{
      id: string;
      revision: number;
    }>
  >().data;
}

describe('File-backed cross-process concurrency', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let databasePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tavern-file-concurrency-'));
    databasePath = join(tempDir, 'api.db');
    ({ app } = await buildApp({ databasePath, logger: false }));
  });

  afterEach(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns one success and one conflict for character version append across separate processes', async () => {
    const imported = await importCharacter(app, 'File Character');

    const detailResponse = await app.inject({ method: 'GET', url: `/characters/${imported.character_id}` });
    expect(detailResponse.statusCode).toBe(200);
    const revision = detailResponse.json<DataResponse<{ revision: number }>>().data.revision;

    const [firstResponse, secondResponse] = await Promise.all([
      runInjectedRequestInChild(databasePath, {
        method: 'POST',
        url: `/characters/${imported.character_id}/versions`,
        payload: {
          snapshot: { name: 'File Character A' },
          expected_revision: revision,
        },
      }),
      runInjectedRequestInChild(databasePath, {
        method: 'POST',
        url: `/characters/${imported.character_id}/versions`,
        payload: {
          snapshot: { name: 'File Character B' },
          expected_revision: revision,
        },
      }),
    ]);

    const responses = [firstResponse, secondResponse];
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);

    const conflict = responses.find((response) => response.statusCode === 409);
    expect(conflict).toBeDefined();
    expect(['character_revision_conflict', 'character_conflict']).toContain(
      parseBody<ErrorResponse>(conflict!).error.code,
    );

    const detailAfterResponse = await app.inject({ method: 'GET', url: `/characters/${imported.character_id}` });
    expect(detailAfterResponse.statusCode).toBe(200);
    expect(
      detailAfterResponse.json<
        DataResponse<{
          latest_version_no: number | null;
          revision: number;
        }>
      >().data,
    ).toEqual(expect.objectContaining({ latest_version_no: 2, revision: 1 }));
  }, FILE_CONCURRENCY_TEST_TIMEOUT_MS);

  it('returns one success and one conflict for character append and delete across separate processes', async () => {
    const imported = await importCharacter(app, 'Delete Race');

    const detailResponse = await app.inject({ method: 'GET', url: `/characters/${imported.character_id}` });
    expect(detailResponse.statusCode).toBe(200);
    const revision = detailResponse.json<DataResponse<{ revision: number }>>().data.revision;

    const [appendResponse, deleteResponse] = await Promise.all([
      runInjectedRequestInChild(databasePath, {
        method: 'POST',
        url: `/characters/${imported.character_id}/versions`,
        payload: {
          snapshot: { name: 'Delete Race v2' },
          expected_revision: revision,
        },
      }),
      runInjectedRequestInChild(databasePath, {
        method: 'DELETE',
        url: `/characters/${imported.character_id}`,
        payload: { expected_revision: revision },
      }),
    ]);

    const responses = [appendResponse, deleteResponse];
    expect(responses.filter((response) => response.statusCode === 201 || response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);

    const conflict = responses.find((response) => response.statusCode === 409);
    expect(conflict).toBeDefined();
    expect(['character_revision_conflict', 'character_deleted']).toContain(
      parseBody<ErrorResponse>(conflict!).error.code,
    );

    const detailAfterResponse = await app.inject({ method: 'GET', url: `/characters/${imported.character_id}` });
    expect(detailAfterResponse.statusCode).toBe(200);
    const detailAfter = detailAfterResponse.json<
      DataResponse<{
        status: string;
        latest_version_no: number | null;
        revision: number;
      }>
    >().data;
    expect(detailAfter.revision).toBe(1);
    expect([
      { status: 'active', latest_version_no: 2 },
      { status: 'deleted', latest_version_no: 1 },
    ]).toContainEqual({
      status: detailAfter.status,
      latest_version_no: detailAfter.latest_version_no,
    });
  }, FILE_CONCURRENCY_TEST_TIMEOUT_MS);

  it('returns one success and one conflict for user rename across separate processes', async () => {
    const firstUser = await createUser(app, 'Worker Rename A');
    const secondUser = await createUser(app, 'Worker Rename B');
    const targetName = 'Worker Shared Target';

    const [firstResponse, secondResponse] = await Promise.all([
      runInjectedRequestInChild(databasePath, {
        method: 'PATCH',
        url: `/users/${firstUser.id}`,
        payload: {
          expected_revision: firstUser.revision,
          snapshot: { name: targetName, description: 'first' },
        },
      }),
      runInjectedRequestInChild(databasePath, {
        method: 'PATCH',
        url: `/users/${secondUser.id}`,
        payload: {
          expected_revision: secondUser.revision,
          snapshot: { name: targetName, description: 'second' },
        },
      }),
    ]);

    const responses = [firstResponse, secondResponse];
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);
    expect(parseBody<ErrorResponse>(responses.find((response) => response.statusCode === 409)!).error.code).toBe(
      'user_conflict',
    );

    const listResponse = await app.inject({
      method: 'GET',
      url: `/users?keyword=${encodeURIComponent(targetName)}`,
    });
    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json<
      DataResponse<
        Array<{
          id: string;
          name: string;
          revision: number;
        }>
      >
    >();

    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]).toEqual(
      expect.objectContaining({
        name: targetName,
        revision: 1,
      }),
    );
  }, FILE_CONCURRENCY_TEST_TIMEOUT_MS);
});
