// BI_SERVER_v789 [5]/[37] - read an INSERT the code sent to a mocked pool as
// column -> value, so a test can assert "country is stored from the payload"
// without depending on placeholder numbers or parameter order.
//
//   const row = insertColumns(sql, params);
//   row.country.value     // the bound parameter for the column's first $n
//   row.country.expr      // the SQL expression, e.g. "COALESCE($23::text, 'CA')"

export type InsertedColumn = { expr: string; value: unknown };

function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (const ch of list) {
    if (ch === "'") quote = !quote;
    if (!quote && ch === "(") depth += 1;
    if (!quote && ch === ")") depth -= 1;
    if (!quote && depth === 0 && ch === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parenthesised(sql: string, from: number): { body: string; end: number } {
  const start = sql.indexOf("(", from);
  if (start < 0) throw new Error("insertColumns: no opening parenthesis");
  let depth = 0;
  let quote = false;
  for (let i = start; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") quote = !quote;
    if (quote) continue;
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return { body: sql.slice(start + 1, i), end: i + 1 };
    }
  }
  throw new Error("insertColumns: unbalanced parentheses");
}

export function insertColumns(sql: string, params: unknown[] = []): Record<string, InsertedColumn> {
  const into = /INSERT\s+INTO\s+[\w.]+\s*/i.exec(sql);
  if (!into) throw new Error("insertColumns: not an INSERT");
  const cols = parenthesised(sql, into.index + into[0].length - 1);
  const valuesAt = sql.slice(cols.end).search(/VALUES/i);
  if (valuesAt < 0) throw new Error("insertColumns: no VALUES list");
  const vals = parenthesised(sql, cols.end + valuesAt);
  const names = splitTopLevel(cols.body.replace(/--[^\n]*/g, ""));
  const exprs = splitTopLevel(vals.body.replace(/--[^\n]*/g, ""));
  if (names.length !== exprs.length) {
    throw new Error(`insertColumns: ${names.length} columns but ${exprs.length} values`);
  }
  const out: Record<string, InsertedColumn> = {};
  names.forEach((name, i) => {
    const expr = exprs[i]!;
    const ref = /\$(\d+)/.exec(expr);
    out[name] = { expr, value: ref ? params[Number(ref[1]) - 1] : undefined };
  });
  return out;
}
