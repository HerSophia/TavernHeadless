import { z } from "zod";

/**
 * 当前路由层用于从 JSON Schema 片段生成 Zod 校验器的最小子集。
 *
 * 这里只覆盖项目当前已经在请求体验证中使用到的结构，
 * 不追求完整实现所有 JSON Schema 语义。
 */
export type SupportedJsonSchema =
  | { type: "boolean" }
  | { type: "number"; minimum?: number; maximum?: number }
  | { type: "integer"; minimum?: number; maximum?: number }
  | { type: "string"; minLength?: number; maxLength?: number; enum?: readonly string[] }
  | { type: "array"; items: SupportedJsonSchema }
  | {
    type: "object";
    properties: Record<string, SupportedJsonSchema>;
    required?: readonly string[];
    additionalProperties?: boolean;
  };

export type SupportedJsonObjectSchema = Extract<SupportedJsonSchema, { type: "object" }>;

export interface BuildZodObjectSchemaOptions {
  trimStringFields?: readonly string[];
  coerceBooleanFields?: readonly string[];
  defaultValues?: Record<string, unknown>;
}

/**
 * 根据受支持的 JSON Schema 子集构造对应的 Zod Schema。
 */
export function buildZodSchemaFromJsonSchema(schema: SupportedJsonSchema): z.ZodTypeAny {
  switch (schema.type) {
    case "boolean":
      return z.boolean();
    case "number": {
      let numberSchema = z.number();
      if (schema.minimum !== undefined) numberSchema = numberSchema.min(schema.minimum);
      if (schema.maximum !== undefined) numberSchema = numberSchema.max(schema.maximum);
      return numberSchema;
    }
    case "integer": {
      let integerSchema = z.number().int();
      if (schema.minimum !== undefined) integerSchema = integerSchema.min(schema.minimum);
      if (schema.maximum !== undefined) integerSchema = integerSchema.max(schema.maximum);
      return integerSchema;
    }
    case "string": {
      if (schema.enum && schema.enum.length > 0) {
        return z.enum([...schema.enum] as [string, ...string[]]);
      }
      let stringSchema = z.string();
      if (schema.minLength !== undefined) stringSchema = stringSchema.min(schema.minLength);
      if (schema.maxLength !== undefined) stringSchema = stringSchema.max(schema.maxLength);
      return stringSchema;
    }
    case "array":
      return z.array(buildZodSchemaFromJsonSchema(schema.items));
    case "object":
      return buildZodObjectSchema<Record<string, unknown>>(schema);
  }
}

/**
 * 根据对象型 JSON Schema 片段构造严格 Zod 对象。
 */
export function buildZodObjectSchema<T>(
  schema: SupportedJsonObjectSchema,
  options: BuildZodObjectSchemaOptions = {},
): z.ZodType<T> {
  const requiredKeys = new Set(schema.required ?? []);
  const trimStringFields = new Set(options.trimStringFields ?? []);
  const coerceBooleanFields = new Set(options.coerceBooleanFields ?? []);
  const defaultValues = options.defaultValues ?? {};
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, propertySchema] of Object.entries(schema.properties)) {
    let fieldSchema: z.ZodTypeAny;

    if (propertySchema.type === "string" && trimStringFields.has(key) && !propertySchema.enum) {
      let stringSchema = z.string().trim();
      if (propertySchema.minLength !== undefined) stringSchema = stringSchema.min(propertySchema.minLength);
      if (propertySchema.maxLength !== undefined) stringSchema = stringSchema.max(propertySchema.maxLength);
      fieldSchema = stringSchema;
    } else if (propertySchema.type === "boolean" && coerceBooleanFields.has(key)) {
      fieldSchema = z.coerce.boolean();
    } else {
      fieldSchema = buildZodSchemaFromJsonSchema(propertySchema);
    }

    if (!requiredKeys.has(key)) {
      fieldSchema = fieldSchema.optional();
    }

    if (Object.prototype.hasOwnProperty.call(defaultValues, key)) {
      fieldSchema = fieldSchema.default(defaultValues[key]);
    }

    shape[key] = fieldSchema;
  }

  let objectSchema: z.ZodTypeAny = z.object(shape);
  if (schema.additionalProperties === false) {
    objectSchema = (objectSchema as z.AnyZodObject).strict();
  }

  return objectSchema as unknown as z.ZodType<T>;
}

/**
 * 根据对象型 JSON Schema 片段构造可选 Zod 对象。
 */
export function buildZodOptionalObjectSchema<T>(
  schema: SupportedJsonObjectSchema,
  options: BuildZodObjectSchemaOptions = {},
): z.ZodType<T | undefined> {
  return buildZodObjectSchema<T>(schema, options).optional() as z.ZodType<T | undefined>;
}
