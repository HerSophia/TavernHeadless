import type { FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";

import {
  cloneOpenApiDocument,
  localizeOpenApiDocument,
  resolveApiDocLanguage,
} from "./openapi-i18n";
import type { AuthMode } from "./auth";

export type RegisterOpenApiOptions = {
  authMode?: AuthMode;
};

const AUTH_SECURITY_SCHEMES = {
  ApiKeyAuth: {
    type: "apiKey",
    in: "header",
    name: "x-api-key",
    description: "Provide API key via x-api-key header",
  },
  BearerAuth: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Provide JWT via Authorization: Bearer <token>",
  },
} as const;

export async function registerOpenApi(app: FastifyInstance, options: RegisterOpenApiOptions = {}): Promise<void> {
  const authMode = options.authMode ?? "off";

  let security: Array<Record<string, string[]>> | undefined;
  if (authMode === "api_key") {
    security = [{ ApiKeyAuth: [] }];
  }

  if (authMode === "jwt") {
    security = [{ BearerAuth: [] }];
  }

  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "TavernHeadless API",
        description: "Backend API for TavernHeadless core engine",
        version: "0.2.0-beta.3",
      },
      components: {
        securitySchemes: AUTH_SECURITY_SCHEMES,
      },
      security,
      tags: [
        { name: "system", description: "System and health endpoints" },
        { name: "sessions", description: "Session CRUD and lifecycle" },
        { name: "floors", description: "Floor CRUD" },
        { name: "pages", description: "Message page CRUD" },
        { name: "messages", description: "Message CRUD" },
        { name: "variables", description: "Variable CRUD and upsert" },
        { name: "memories", description: "Memory and memory-edge CRUD" },
        { name: "imports", description: "SillyTavern resource import APIs" },
        { name: "exports", description: "Resource export and file download APIs, including advanced async job entrypoints" },
        { name: "backup", description: "Core asset backup export, restore preview, and restore job APIs" },
        { name: "chat-transfer-jobs", description: "Advanced developer APIs for async chat import/export job observation and artifact download" },
        { name: "characters", description: "Character lifecycle and versioning" },
        { name: "backup-jobs", description: "Advanced developer APIs for backup job observation, control, and artifact download" },
        { name: "chat", description: "Chat respond and regenerate" },
        { name: "session-state", description: "Session State public contract and governed custom namespace APIs" },
        { name: "llm-profiles", description: "LLM profile vault and activation" },
        { name: "accounts", description: "Account management" },
        { name: "users", description: "Account user-card management" },
        { name: "asset-versions", description: "Prompt asset version read, compare, and rollback APIs" },
        { name: "operation-logs", description: "Operation Journal query APIs" },
        { name: "vc-tags", description: "Version-control tags for floors and asset versions" },
      ],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    staticCSP: true,
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
    transformSpecification: (swaggerObject, request) => {
      const language = resolveApiDocLanguage(request);
      const localized = localizeOpenApiDocument(cloneOpenApiDocument(swaggerObject), language);
      return localized;
    },
    transformSpecificationClone: false,
  });

  app.get(
    "/docs-zh",
    {
      config: {
        swagger: {
          hide: true,
        },
      },
    },
    async (_, reply) => reply.redirect("/docs/?lang=zh")
  );

  app.get(
    "/openapi.json",
    {
      config: {
        swagger: {
          hide: true,
        },
      },
    },
    async (request) => {
      const swaggerApp = app as FastifyInstance & { swagger: () => unknown };
      const language = resolveApiDocLanguage(request);
      const specification = cloneOpenApiDocument(swaggerApp.swagger());
      return localizeOpenApiDocument(specification, language);
    }
  );

  app.get(
    "/docs-en",
    {
      config: {
        swagger: {
          hide: true,
        },
      },
    },
    async (_, reply) => reply.redirect("/docs/?lang=en")
  );
}
