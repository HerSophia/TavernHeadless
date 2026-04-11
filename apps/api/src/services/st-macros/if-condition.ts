export interface IfConditionSourceSegment {
  kind: "text" | "macro" | "raw";
  rawText: string;
}

type IfConditionComparisonOperator = "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "startsWith";
type IfConditionLogicalOperator = "and" | "or" | "not";

type IfConditionLiteralKind = "quoted" | "number" | "bareword";

interface IfConditionLiteralOperand {
  kind: "literal";
  literalKind: IfConditionLiteralKind;
  rawText: string;
  value: string;
}

interface IfConditionMacroOperand {
  kind: "macro";
  rawText: string;
}

export type IfConditionOperand = IfConditionLiteralOperand | IfConditionMacroOperand;

export type IfConditionExpression =
  | { kind: "operand"; operand: IfConditionOperand }
  | { kind: "group"; expression: IfConditionExpression }
  | { kind: "comparison"; operator: IfConditionComparisonOperator; left: IfConditionExpression; right: IfConditionExpression }
  | { kind: "not"; expression: IfConditionExpression }
  | { kind: "and"; left: IfConditionExpression; right: IfConditionExpression }
  | { kind: "or"; left: IfConditionExpression; right: IfConditionExpression };

export type IfConditionParseFailureReason = "unsupported" | "parse_failed";

type IfConditionParseFailure = { ok: false; reason: IfConditionParseFailureReason; message: string };

export type ParseIfConditionResult =
  | { ok: true; expression: IfConditionExpression }
  | IfConditionParseFailure;

export type EvaluateIfConditionResult =
  | { ok: true; result: boolean }
  | { ok: false; reason: "type_invalid"; message: string };

type TokenizeIfConditionResult =
  | { ok: true; tokens: IfConditionToken[] }
  | IfConditionParseFailure;

type ReadQuotedLiteralResult =
  | { ok: true; rawText: string; value: string; nextIndex: number }
  | IfConditionParseFailure;

interface IfConditionOperandToken {
  kind: "operand";
  operand: IfConditionOperand;
}

interface IfConditionComparisonOperatorToken {
  kind: "comparison_operator";
  operator: IfConditionComparisonOperator;
  rawText: string;
}

interface IfConditionLogicalOperatorToken {
  kind: "logical_operator";
  operator: IfConditionLogicalOperator;
  rawText: string;
}

interface IfConditionParenthesisToken {
  kind: "lparen" | "rparen";
  rawText: string;
}

type IfConditionToken =
  | IfConditionOperandToken
  | IfConditionComparisonOperatorToken
  | IfConditionLogicalOperatorToken
  | IfConditionParenthesisToken;

const KEYWORD_OPERATOR_MAP: Record<string, IfConditionComparisonOperator | IfConditionLogicalOperator> = {
  and: "and",
  or: "or",
  not: "not",
  contains: "contains",
  startswith: "startsWith",
};

function isWhitespace(character: string): boolean {
  return /\s/.test(character);
}

function isBarewordCharacter(character: string): boolean {
  return !isWhitespace(character)
    && ![
      "(",
      ")",
      '"',
      "'",
      "=",
      "!",
      "<",
      ">",
      ",",
      "+",
      "-",
      "*",
      "/",
      "?",
      ";",
      ":",
      "[",
      "]",
      "{",
      "}",
      "|",
      "&",
      "%",
      "^",
      "~",
      "\\",
    ].includes(character);
}

function parseFailure(message: string): IfConditionParseFailure {
  return { ok: false, reason: "parse_failed", message };
}

function unsupportedFailure(message: string): IfConditionParseFailure {
  return { ok: false, reason: "unsupported", message };
}

function tokenizeConditionSegments(segments: IfConditionSourceSegment[]): TokenizeIfConditionResult {
  const tokens: IfConditionToken[] = [];

  for (const segment of segments) {
    if (segment.kind === "macro") {
      tokens.push({
        kind: "operand",
        operand: {
          kind: "macro",
          rawText: segment.rawText,
        },
      });
      continue;
    }

    if (segment.kind === "raw") {
      return parseFailure("If condition expression contains an invalid raw fragment.");
    }

    const tokenized = tokenizeConditionText(segment.rawText);
    if (!tokenized.ok) {
      return tokenized;
    }
    tokens.push(...tokenized.tokens);
  }

  return {
    ok: true,
    tokens,
  };
}

function tokenizeConditionText(input: string): TokenizeIfConditionResult {
  const tokens: IfConditionToken[] = [];
  let index = 0;

  while (index < input.length) {
    const character = input[index] ?? "";
    if (isWhitespace(character)) {
      index += 1;
      continue;
    }

    if (character === "(") {
      tokens.push({ kind: "lparen", rawText: "(" });
      index += 1;
      continue;
    }

    if (character === ")") {
      tokens.push({ kind: "rparen", rawText: ")" });
      index += 1;
      continue;
    }

    const remaining = input.slice(index);
    if (remaining.startsWith(">=")) {
      tokens.push({ kind: "comparison_operator", operator: ">=", rawText: ">=" });
      index += 2;
      continue;
    }
    if (remaining.startsWith("<=")) {
      tokens.push({ kind: "comparison_operator", operator: "<=", rawText: "<=" });
      index += 2;
      continue;
    }
    if (remaining.startsWith("==")) {
      tokens.push({ kind: "comparison_operator", operator: "==", rawText: "==" });
      index += 2;
      continue;
    }
    if (remaining.startsWith("!=")) {
      tokens.push({ kind: "comparison_operator", operator: "!=", rawText: "!=" });
      index += 2;
      continue;
    }
    if (character === ">") {
      tokens.push({ kind: "comparison_operator", operator: ">", rawText: ">" });
      index += 1;
      continue;
    }
    if (character === "<") {
      tokens.push({ kind: "comparison_operator", operator: "<", rawText: "<" });
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      const quoted = readQuotedLiteral(input, index);
      if (!quoted.ok) {
        return quoted;
      }
      tokens.push({
        kind: "operand",
        operand: {
          kind: "literal",
          literalKind: "quoted",
          rawText: quoted.rawText,
          value: quoted.value,
        },
      });
      index = quoted.nextIndex;
      continue;
    }

    const numberMatch = remaining.match(/^-?(?:\d+(?:\.\d+)?|\.\d+)/);
    if (numberMatch?.[0]) {
      const rawText = numberMatch[0];
      tokens.push({
        kind: "operand",
        operand: {
          kind: "literal",
          literalKind: "number",
          rawText,
          value: rawText,
        },
      });
      index += rawText.length;
      continue;
    }

    if (!isBarewordCharacter(character)) {
      return unsupportedFailure(`If condition expression uses unsupported token: ${character}`);
    }

    const startIndex = index;
    while (index < input.length && isBarewordCharacter(input[index] ?? "")) {
      index += 1;
    }

    const rawText = input.slice(startIndex, index);
    const keyword = KEYWORD_OPERATOR_MAP[rawText.toLowerCase()];
    if (keyword === "and" || keyword === "or" || keyword === "not") {
      tokens.push({ kind: "logical_operator", operator: keyword, rawText });
      continue;
    }
    if (keyword === "contains" || keyword === "startsWith") {
      tokens.push({ kind: "comparison_operator", operator: keyword, rawText });
      continue;
    }

    tokens.push({
      kind: "operand",
      operand: {
        kind: "literal",
        literalKind: "bareword",
        rawText,
        value: rawText,
      },
    });
  }

  return {
    ok: true,
    tokens,
  };
}

function readQuotedLiteral(
  input: string,
  startIndex: number,
): ReadQuotedLiteralResult {
  const quote = input[startIndex];
  if (quote === undefined) {
    return parseFailure("If condition string literal is not closed.");
  }
  let index = startIndex + 1;
  let value = "";

  while (index < input.length) {
    const character = input[index] ?? "";
    if (character === "\\") {
      const escaped = input[index + 1];
      if (escaped === undefined) {
        return parseFailure("If condition string literal has an invalid escape sequence.");
      }
      value += escaped;
      index += 2;
      continue;
    }

    if (character === quote) {
      return {
        ok: true,
        rawText: input.slice(startIndex, index + 1),
        value,
        nextIndex: index + 1,
      };
    }

    value += character;
    index += 1;
  }

  return parseFailure("If condition string literal is not closed.");
}

class IfConditionParser {
  private index = 0;

  private failure: ParseIfConditionResult | null = null;

  constructor(private readonly tokens: IfConditionToken[]) {}

  parse(): ParseIfConditionResult {
    if (this.tokens.length === 0) {
      return {
        ok: true,
        expression: {
          kind: "operand",
          operand: {
            kind: "literal",
            literalKind: "bareword",
            rawText: "",
            value: "",
          },
        },
      };
    }

    const expression = this.parseOrExpression();
    if (!expression) {
      return this.failure ?? parseFailure("If condition expression could not be parsed.");
    }

    if (this.index < this.tokens.length) {
      return parseFailure("If condition expression has unexpected trailing tokens.");
    }

    return { ok: true, expression };
  }

  private parseOrExpression(): IfConditionExpression | null {
    let expression = this.parseAndExpression();
    if (!expression) {
      return null;
    }

    while (this.matchLogicalOperator("or")) {
      const right = this.parseAndExpression();
      if (!right) {
        return null;
      }
      expression = { kind: "or", left: expression, right };
    }

    return expression;
  }

  private parseAndExpression(): IfConditionExpression | null {
    let expression = this.parseNotExpression();
    if (!expression) {
      return null;
    }

    while (this.matchLogicalOperator("and")) {
      const right = this.parseNotExpression();
      if (!right) {
        return null;
      }
      expression = { kind: "and", left: expression, right };
    }

    return expression;
  }

  private parseNotExpression(): IfConditionExpression | null {
    if (this.matchLogicalOperator("not")) {
      const expression = this.parseNotExpression();
      if (!expression) {
        return null;
      }
      return { kind: "not", expression };
    }

    return this.parseComparisonExpression();
  }

  private parseComparisonExpression(): IfConditionExpression | null {
    const left = this.parsePrimaryExpression();
    if (!left) {
      return null;
    }

    const token = this.peek();
    if (!token || token.kind !== "comparison_operator") {
      return left;
    }

    this.index += 1;
    const right = this.parsePrimaryExpression();
    if (!right) {
      return null;
    }

    if (!this.isComparableExpression(left) || !this.isComparableExpression(right)) {
      return this.fail(parseFailure("If condition comparison operands must be plain values or parenthesized values."));
    }

    return {
      kind: "comparison",
      operator: token.operator,
      left,
      right,
    };
  }

  private parsePrimaryExpression(): IfConditionExpression | null {
    const token = this.peek();
    if (!token) {
      return this.fail(parseFailure("If condition expression ended unexpectedly."));
    }

    if (token.kind === "lparen") {
      this.index += 1;
      const expression = this.parseOrExpression();
      if (!expression) {
        return null;
      }
      if (!this.matchParenthesis("rparen")) {
        return this.fail(parseFailure("If condition expression is missing a closing parenthesis."));
      }
      return { kind: "group", expression };
    }

    if (token.kind === "operand") {
      this.index += 1;
      return { kind: "operand", operand: token.operand };
    }

    return this.fail(parseFailure(`Unexpected token in if condition expression: ${token.rawText}`));
  }

  private isComparableExpression(expression: IfConditionExpression): boolean {
    if (expression.kind === "operand") {
      return true;
    }

    if (expression.kind === "group") {
      return this.isComparableExpression(expression.expression);
    }

    return false;
  }

  private matchLogicalOperator(operator: IfConditionLogicalOperator): boolean {
    const token = this.peek();
    if (token?.kind === "logical_operator" && token.operator === operator) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private matchParenthesis(kind: "rparen"): boolean {
    const token = this.peek();
    if (token?.kind === kind) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private peek(): IfConditionToken | undefined {
    return this.tokens[this.index];
  }

  private fail(result: ParseIfConditionResult): null {
    if (this.failure === null) {
      this.failure = result;
    }
    return null;
  }
}

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function tryParseFiniteNumber(value: string): number | null {
  const normalized = stripMatchingQuotes(value);
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeComparableOperandValue(operand: IfConditionOperand, resolvedValue: string): string {
  if (operand.kind === "literal" && operand.literalKind === "quoted") {
    return resolvedValue;
  }
  return stripMatchingQuotes(resolvedValue);
}

function resolveComparableOperandValue(
  expression: IfConditionExpression,
  options: { resolveMacroOperand: (rawText: string) => string },
): string | null {
  if (expression.kind === "group") {
    return resolveComparableOperandValue(expression.expression, options);
  }

  if (expression.kind !== "operand") {
    return null;
  }

  const resolvedValue = expression.operand.kind === "macro"
    ? options.resolveMacroOperand(expression.operand.rawText)
    : expression.operand.value;
  return normalizeComparableOperandValue(expression.operand, resolvedValue);
}

function evaluateComparisonExpression(
  expression: Extract<IfConditionExpression, { kind: "comparison" }>,
  options: {
    resolveMacroOperand: (rawText: string) => string;
  },
): EvaluateIfConditionResult {
  const left = resolveComparableOperandValue(expression.left, options);
  const right = resolveComparableOperandValue(expression.right, options);
  if (left === null || right === null) {
    return {
      ok: false,
      reason: "type_invalid",
      message: "If condition comparison operands must resolve to plain values.",
    };
  }

  if (expression.operator === "==" || expression.operator === "!=") {
    const leftNumber = tryParseFiniteNumber(left);
    const rightNumber = tryParseFiniteNumber(right);
    const areEqual = leftNumber !== null && rightNumber !== null
      ? leftNumber === rightNumber
      : left === right;
    return {
      ok: true,
      result: expression.operator === "==" ? areEqual : !areEqual,
    };
  }

  if (expression.operator === ">" || expression.operator === "<" || expression.operator === ">=" || expression.operator === "<=") {
    const leftNumber = tryParseFiniteNumber(left);
    const rightNumber = tryParseFiniteNumber(right);
    if (leftNumber === null || rightNumber === null) {
      return {
        ok: false,
        reason: "type_invalid",
        message: `If condition operator ${expression.operator} requires numeric operands.`,
      };
    }

    const result = expression.operator === ">"
      ? leftNumber > rightNumber
      : expression.operator === "<"
        ? leftNumber < rightNumber
        : expression.operator === ">="
          ? leftNumber >= rightNumber
          : leftNumber <= rightNumber;
    return { ok: true, result };
  }

  const result = expression.operator === "contains"
    ? left.includes(right)
    : left.startsWith(right);
  return { ok: true, result };
}

export function parseIfConditionExpression(segments: IfConditionSourceSegment[]): ParseIfConditionResult {
  const tokenized = tokenizeConditionSegments(segments);
  if (!tokenized.ok) {
    return tokenized;
  }

  const parser = new IfConditionParser(tokenized.tokens);
  return parser.parse();
}

export function evaluateIfConditionExpression(
  expression: IfConditionExpression,
  options: {
    resolveMacroOperand: (rawText: string) => string;
    isTruthy: (value: string) => boolean;
  },
): EvaluateIfConditionResult {
  if (expression.kind === "group") {
    return evaluateIfConditionExpression(expression.expression, options);
  }

  if (expression.kind === "operand") {
    const resolvedValue = expression.operand.kind === "macro"
      ? options.resolveMacroOperand(expression.operand.rawText)
      : expression.operand.value;
    return {
      ok: true,
      result: options.isTruthy(resolvedValue),
    };
  }

  if (expression.kind === "not") {
    const evaluated = evaluateIfConditionExpression(expression.expression, options);
    if (!evaluated.ok) {
      return evaluated;
    }
    return {
      ok: true,
      result: !evaluated.result,
    };
  }

  if (expression.kind === "and") {
    const left = evaluateIfConditionExpression(expression.left, options);
    if (!left.ok) {
      return left;
    }
    if (!left.result) {
      return { ok: true, result: false };
    }
    return evaluateIfConditionExpression(expression.right, options);
  }

  if (expression.kind === "or") {
    const left = evaluateIfConditionExpression(expression.left, options);
    if (!left.ok) {
      return left;
    }
    if (left.result) {
      return { ok: true, result: true };
    }
    return evaluateIfConditionExpression(expression.right, options);
  }

  return evaluateComparisonExpression(expression, options);
}
