/**
 * Per-drone parameter value expressions.
 *
 * A parameter value containing `$` is treated as an arithmetic expression
 * that is evaluated separately for every target drone at upload time, so a
 * single manifest can assign a different value to each drone. Available
 * variables:
 *
 *   $id — the numeric part of the target UAV's id ("7" → 7, "drone-12" → 12)
 *
 * Supported syntax: numbers, `+ - * / %`, parentheses and unary minus.
 * Examples:
 *
 *   SYSID_THISMAV=$id
 *   SYSID_THISMAV=$id+1
 *   GRIP_GRAB=($id-1)%4
 *
 * Values without `$` are passed through untouched, so plain numeric
 * manifests behave exactly as before. Evaluation uses a small hand-written
 * parser — no eval(), no access to anything but the whitelisted variables.
 */

export function isParameterExpression(value) {
  return typeof value === 'string' && value.includes('$');
}

/** Numeric part of a UAV id: "7" → 7, "drone-12" → 12, "COL-03" → 3. */
export function extractNumericUavId(uavId) {
  const match = String(uavId ?? '').match(/(\d+)\s*$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function tokenize(expression) {
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    const ch = expression[index];
    if (/\s/.test(ch)) {
      index++;
      continue;
    }

    if (/[\d.]/.test(ch)) {
      let end = index;
      while (end < expression.length && /[\d.]/.test(expression[end])) end++;
      const raw = expression.slice(index, end);
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new Error(`invalid number ${JSON.stringify(raw)}`);
      }

      tokens.push({ type: 'number', value });
      index = end;
      continue;
    }

    if (ch === '$') {
      let end = index + 1;
      while (end < expression.length && /[A-Za-z_]/.test(expression[end])) end++;
      const name = expression.slice(index + 1, end).toLowerCase();
      if (!name) {
        throw new Error('lone $ without a variable name');
      }

      tokens.push({ type: 'variable', name });
      index = end;
      continue;
    }

    if ('+-*/%()'.includes(ch)) {
      tokens.push({ type: ch });
      index++;
      continue;
    }

    throw new Error(`unexpected character ${JSON.stringify(ch)}`);
  }

  return tokens;
}

/**
 * Evaluates an arithmetic expression with the given variables.
 *
 * @param expression  the expression string, e.g. `($id-1)*2`
 * @param variables   plain object of variable values, e.g. `{ id: 7 }`
 * @returns the numeric result
 * @throws Error on syntax errors or unknown variables
 */
export function evaluateParameterExpression(expression, variables = {}) {
  const tokens = tokenize(String(expression));
  let position = 0;

  const peek = () => tokens[position];
  const take = () => tokens[position++];

  function parseFactor() {
    const token = take();
    if (!token) {
      throw new Error('unexpected end of expression');
    }

    if (token.type === 'number') {
      return token.value;
    }

    if (token.type === 'variable') {
      if (!(token.name in variables)) {
        throw new Error(
          `unknown variable $${token.name} (available: ${Object.keys(variables)
            .map((v) => '$' + v)
            .join(', ')})`
        );
      }

      return Number(variables[token.name]);
    }

    if (token.type === '-') {
      return -parseFactor();
    }

    if (token.type === '+') {
      return parseFactor();
    }

    if (token.type === '(') {
      const value = parseExpression();
      const closing = take();
      if (!closing || closing.type !== ')') {
        throw new Error('missing closing parenthesis');
      }

      return value;
    }

    throw new Error(`unexpected token ${JSON.stringify(token.type)}`);
  }

  function parseTerm() {
    let value = parseFactor();
    while (peek() && ['*', '/', '%'].includes(peek().type)) {
      const op = take().type;
      const rhs = parseFactor();
      if (op === '*') value *= rhs;
      else if (op === '/') value /= rhs;
      else value %= rhs;
    }

    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    while (peek() && ['+', '-'].includes(peek().type)) {
      const op = take().type;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }

    return value;
  }

  const result = parseExpression();
  if (position < tokens.length) {
    throw new Error(`unexpected trailing input near token ${position + 1}`);
  }

  if (!Number.isFinite(result)) {
    throw new Error('expression did not evaluate to a finite number');
  }

  return result;
}

/**
 * Resolves a manifest value for one target drone: expressions (values
 * containing `$`) are evaluated with the drone's variables, everything else
 * is returned untouched.
 */
export function resolveParameterValue(value, uavId) {
  if (!isParameterExpression(value)) {
    return value;
  }

  const id = extractNumericUavId(uavId);
  if (id === null) {
    throw new Error(
      `cannot derive a numeric id from UAV id ${JSON.stringify(uavId)} ` +
        'needed by a $-expression'
    );
  }

  return evaluateParameterExpression(value, { id });
}

/**
 * Validates an expression at manifest-entry time (before any drone is
 * known) by test-evaluating it with a dummy id. Throws on invalid syntax.
 */
export function validateParameterExpression(value) {
  if (isParameterExpression(value)) {
    evaluateParameterExpression(value, { id: 1 });
  }
}
