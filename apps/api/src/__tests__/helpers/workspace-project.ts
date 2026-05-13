import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import type { AppDb, DbExecutor } from "../../db/client.js";
import { accounts, projects, sessions, workspaces } from "../../db/schema.js";
import {
  DEFAULT_WORKSPACE_NAME,
  WorkspaceScopeService,
  buildDefaultWorkspaceId,
} from "../../services/workspace-scope-service.js";

export type TestDb = AppDb | DbExecutor;

export type TestWorkspaceScope = {
  accountId: string;
  workspaceId: string;
};

export type TestProjectScope = TestWorkspaceScope & {
  projectId: string;
};

export type TestSessionScope = TestProjectScope & {
  sessionId: string;
};

export function ensureTestAccount(
  db: TestDb,
  accountId = DEFAULT_ADMIN_ACCOUNT_ID,
  now = Date.now(),
): void {
  db.insert(accounts)
    .values({
      id: accountId,
      name: accountId,
      role: accountId === DEFAULT_ADMIN_ACCOUNT_ID ? "admin" : "user",
      status: "active",
      isDefault: accountId === DEFAULT_ADMIN_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
}

export function ensureTestDefaultWorkspace(
  db: TestDb,
  accountId = DEFAULT_ADMIN_ACCOUNT_ID,
  now = Date.now(),
): TestWorkspaceScope {
  ensureTestAccount(db, accountId, now);
  const workspace = new WorkspaceScopeService(db).ensureDefaultWorkspace(accountId, now);
  return { accountId, workspaceId: workspace.id };
}

export function createTestWorkspace(
  db: TestDb,
  input: {
    accountId?: string;
    id?: string;
    name?: string;
    isDefault?: boolean;
    status?: "active" | "archived";
    now?: number;
  } = {},
): TestWorkspaceScope {
  const now = input.now ?? Date.now();
  const accountId = input.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID;
  const workspaceId = input.id ?? buildDefaultWorkspaceId(accountId);

  ensureTestAccount(db, accountId, now);

  db.insert(workspaces)
    .values({
      id: workspaceId,
      accountId,
      name: input.name ?? (input.isDefault ? DEFAULT_WORKSPACE_NAME : `Workspace ${workspaceId}`),
      kind: "default",
      isDefault: input.isDefault ?? workspaceId === buildDefaultWorkspaceId(accountId),
      status: input.status ?? "active",
      settingsJson: "{}",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  return { accountId, workspaceId };
}

export function createTestProject(
  db: TestDb,
  input: {
    accountId?: string;
    workspaceId?: string;
    id?: string;
    name?: string;
    status?: "active" | "archived";
    now?: number;
  } = {},
): TestProjectScope {
  const now = input.now ?? Date.now();
  const accountId = input.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID;
  const workspaceId = input.workspaceId ?? ensureTestDefaultWorkspace(db, accountId, now).workspaceId;
  const projectId = input.id ?? `proj_test_${nanoid()}`;

  createTestWorkspace(db, {
    accountId,
    id: workspaceId,
    isDefault: workspaceId === buildDefaultWorkspaceId(accountId),
    now,
  });

  db.insert(projects)
    .values({
      id: projectId,
      accountId,
      workspaceId,
      name: input.name ?? `Project ${projectId}`,
      description: null,
      kind: "session_default",
      status: input.status ?? "active",
      settingsOverrideJson: "{}",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  return { accountId, workspaceId, projectId };
}

export function createTestSessionWithScope(
  db: TestDb,
  input: {
    id?: string;
    accountId?: string;
    workspaceId?: string;
    projectId?: string;
    title?: string | null;
    now?: number;
    values?: Partial<typeof sessions.$inferInsert>;
  } = {},
): TestSessionScope {
  const now = input.now ?? Date.now();
  const accountId = input.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID;
  const sessionId = input.id ?? `sess_test_${nanoid()}`;

  let projectScope: TestProjectScope;
  if (input.projectId) {
    const existingProject = db
      .select({
        id: projects.id,
        accountId: projects.accountId,
        workspaceId: projects.workspaceId,
      })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.accountId, accountId)))
      .limit(1)
      .get();

    projectScope = existingProject
      ? {
          accountId: existingProject.accountId,
          workspaceId: existingProject.workspaceId,
          projectId: existingProject.id,
        }
      : createTestProject(db, {
          accountId,
          workspaceId: input.workspaceId,
          id: input.projectId,
          now,
        });
  } else {
    projectScope = createTestProject(db, {
      accountId,
      workspaceId: input.workspaceId,
      id: `proj_session_${sessionId}`,
      name: input.title?.trim() || `默认项目 - ${sessionId}`,
      now,
    });
  }

  db.insert(sessions)
    .values({
      id: sessionId,
      title: input.title ?? "Test Session",
      accountId,
      workspaceId: projectScope.workspaceId,
      projectId: projectScope.projectId,
      status: "active",
      createdAt: now,
      updatedAt: now,
      ...input.values,
    })
    .run();

  return { ...projectScope, sessionId };
}

export function createTestPromptAssetScope(
  db: TestDb,
  accountId = DEFAULT_ADMIN_ACCOUNT_ID,
  now = Date.now(),
): TestWorkspaceScope {
  return ensureTestDefaultWorkspace(db, accountId, now);
}
