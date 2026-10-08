export * from "./generated/api";
export * from "./generated/types";
// orval names both an endpoint's path-params zod schema (api) and its query-params type (types)
// `<Operation>Params`: with a query param in the spec the star exports collide. Keep the zod one.
export { GetProjectCapacityParams } from "./generated/api";
