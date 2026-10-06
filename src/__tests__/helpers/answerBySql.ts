// BI_SERVER_SQL_CONTENT_MOCKS_v713
// Database mocks in tests must answer by WHAT is asked, not by the ORDER queries happen to run in. A chain of
// mockResolvedValueOnce answers breaks silently when the code under test adds, removes or reorders a query: the
// wrong row reaches the wrong query and the test either fails for no real reason or, worse, still passes.
//
//   queryMock.mockImplementation(answerBySql([
//     ["FROM bi_applications", { rows: [app] }],
//     [/UPDATE bi_documents/, { rows: [], rowCount: 1 }],
//   ]));
//
// The first rule whose pattern matches the SQL text answers. An answer can be a value, a function of (sql, params),
// rejects(err) to make the query fail, or inTurn(a, b) when the SAME query must answer differently each time it runs
// (once every answer is used, that rule steps aside). Anything unmatched goes to the fallback: a function (often the
// mock's previous implementation) or a value, empty rows by default.
export type SqlRule = [RegExp | string, unknown];

const IN_TURN = Symbol("inTurn");
const REJECTS = Symbol("rejects");

export function sqlText(sql: unknown): string {
  if (typeof sql === "string") return sql;
  if (sql && typeof sql === "object" && "text" in (sql as Record<string, unknown>)) return String((sql as { text: unknown }).text);
  return String(sql ?? "");
}

export function inTurn(...answers: unknown[]): { [IN_TURN]: unknown[] } {
  return { [IN_TURN]: answers };
}

export function rejects(error: unknown): { [REJECTS]: unknown } {
  return { [REJECTS]: error };
}

export function answerBySql(rules: SqlRule[], fallback?: unknown): (sql?: unknown, params?: unknown[]) => Promise<any> {
  const used = new Map<number, number>();
  return async (sql?: unknown, params?: unknown[]): Promise<any> => {
    const text = sqlText(sql);
    for (let r = 0; r < rules.length; r += 1) {
      const [match, answer] = rules[r]!;
      const hit = typeof match === "string" ? text.includes(match) : match.test(text);
      if (!hit) continue;
      let out: unknown = answer;
      if (out && typeof out === "object" && IN_TURN in (out as object)) {
        const list = (out as { [IN_TURN]: unknown[] })[IN_TURN];
        const n = used.get(r) ?? 0;
        if (n >= list.length) continue;
        used.set(r, n + 1);
        out = list[n];
      }
      if (out && typeof out === "object" && REJECTS in (out as object)) throw (out as { [REJECTS]: unknown })[REJECTS];
      if (typeof out === "function") return (out as (s: string, p?: unknown[]) => unknown)(text, params);
      return out;
    }
    if (typeof fallback === "function") return (fallback as (s?: unknown, p?: unknown[]) => unknown)(sql, params);
    return fallback === undefined ? { rows: [], rowCount: 0 } : fallback;
  };
}

/** The calls whose SQL matches, e.g. to assert on an UPDATE's parameters without knowing its position. */
export function callsMatching(mock: { mock: { calls: unknown[][] } }, match: RegExp | string): unknown[][] {
  return mock.mock.calls.filter((c) => (typeof match === "string" ? sqlText(c[0]).includes(match) : match.test(sqlText(c[0]))));
}
