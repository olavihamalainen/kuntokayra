import { DatabaseSync } from 'node:sqlite';

export function testD1(testContext, ...migrations) {
  const sqlite = new DatabaseSync(':memory:');
  for (const sql of migrations) sqlite.exec(sql);
  testContext.after(() => sqlite.close());
  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bind = (...values) => ({
        all: () => ({ results: statement.all(...values) }),
        first: () => statement.get(...values) ?? null,
        run: () => statement.run(...values),
      });
      return { ...bind(), bind };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.all());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, DB };
}
