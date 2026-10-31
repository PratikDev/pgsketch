export type * from './model/types';
export type { ValidationCode, ValidationError } from './model/errors';
export { validateModel } from './model/validate';
export { assignNames } from './model/naming';
export { fingerprint } from './fingerprint/fingerprint';
export { introspectCasts } from './introspect/casts';
export { introspect } from './introspect';
export type { Introspection } from './introspect';
export type { Query, QueryParam } from './introspect/query';
export type { CastData } from './sql/coercion';
export type { ChangeOp, CommentTarget, DiffPart } from './diff/ops';
export { diff } from './diff';
export { orderOps } from './order/order';
export type { OrderedOp, Phase } from './order/order';
export { renderMigration } from './render/migration';
export type { Migration, MigrationContext } from './render/migration';
export { classifyTypeChange } from './risk/type-changes';
export type { TypeChangeRisk } from './risk/type-changes';
export { typeChangeRewritesTable } from './risk/type-changes';
export { assessRisk, RISK_LABELS } from './risk/assess';
export type { Risk, RiskLevel } from './risk/assess';
export { firstDifference, matchesByName } from './diff/applied';
export { currentSearchPath, normalizeExpression } from './normalize/expression';
export type {
  ExpressionColumn,
  ExpressionContext,
  ExpressionTarget,
  NormalizedExpression,
} from './normalize/expression';
export { blockersOfColumn, blockersOfTable } from './diff/readonly-guard';
export { renderPgType } from './sql/pgtype';
export { quoteIdent, quoteLiteral } from './sql/quote';
