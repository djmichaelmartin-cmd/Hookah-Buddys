export * from "./generated/api";
export * from "./generated/types";

// A handful of operations declare BOTH a path parameter and query parameters.
// For those, the zod client (generated/api) emits a `<Op>Params` value (the
// coercible path-param schema) while the TypeScript schemas (generated/types)
// emit a `<Op>Params` type. `export *` treats these same-named exports as
// ambiguous, so we re-export the value form explicitly to disambiguate.
export {
  ListBusinessFollowersParams,
  ListBusinessMediaParams,
  ListBusinessRecentCheckinsParams,
  ListBusinessMentionsParams,
  ReportBusinessChildBody,
  ReviewBusinessMentionBody,
  ReviewBusinessReportBody,
  CreateBusinessChildCommentBody,
} from "./generated/api";
