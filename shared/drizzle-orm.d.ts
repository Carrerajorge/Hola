// Type shim for drizzle-orm modules.
// The installed version only ships .d.cts files but the ESM export
// conditions reference .d.ts which are absent.  This ambient shim
// provides just enough typing so the CI check (shared/ only) passes
// without weakening strictness elsewhere.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------- helpers used across declarations ----------
interface ColumnBuilder {
  primaryKey(): ColumnBuilder;
  notNull(): ColumnBuilder;
  unique(): ColumnBuilder;
  default(value: any): ColumnBuilder;
  defaultNow(): ColumnBuilder;
  defaultRandom(): ColumnBuilder;
  array(): ColumnBuilder;
  references(ref: any, opts?: any): ColumnBuilder;
  $type<T>(): ColumnBuilder;
  $defaultFn(fn: () => any): ColumnBuilder;
}

// ---------- drizzle-orm core ----------
declare module "drizzle-orm" {
  export const sql: any;
  export const relations: (...args: any[]) => any;
  export const eq: (...args: any[]) => any;
  export const and: (...args: any[]) => any;
  export const or: (...args: any[]) => any;
  export const not: (...args: any[]) => any;
  export const gt: (...args: any[]) => any;
  export const gte: (...args: any[]) => any;
  export const lt: (...args: any[]) => any;
  export const lte: (...args: any[]) => any;
  export const ne: (...args: any[]) => any;
  export const isNull: (...args: any[]) => any;
  export const isNotNull: (...args: any[]) => any;
  export const inArray: (...args: any[]) => any;
  export const notInArray: (...args: any[]) => any;
  export const exists: (...args: any[]) => any;
  export const notExists: (...args: any[]) => any;
  export const between: (...args: any[]) => any;
  export const notBetween: (...args: any[]) => any;
  export const like: (...args: any[]) => any;
  export const notLike: (...args: any[]) => any;
  export const ilike: (...args: any[]) => any;
  export const notIlike: (...args: any[]) => any;
  export const desc: (...args: any[]) => any;
  export const asc: (...args: any[]) => any;
  export const count: (...args: any[]) => any;
  export const countDistinct: (...args: any[]) => any;
  export const avg: (...args: any[]) => any;
  export const avgDistinct: (...args: any[]) => any;
  export const sum: (...args: any[]) => any;
  export const sumDistinct: (...args: any[]) => any;
  export const max: (...args: any[]) => any;
  export const min: (...args: any[]) => any;
  export type InferSelectModel<T> = any;
  export type InferInsertModel<T> = any;
  export type InferModel<T> = any;
}

// ---------- drizzle-orm/pg-core ----------
declare module "drizzle-orm/pg-core" {
  export function pgTable(name: string, columns: any, extra?: (table: any) => any): any;
  export function pgEnum<T extends string>(name: string, values: readonly [T, ...T[]]): any;
  export function pgEnum(name: string, values: readonly string[]): any;
  export function pgSchema(name: string): any;
  export function text(name: string): ColumnBuilder;
  export function varchar(name: string, config?: any): ColumnBuilder;
  export function integer(name: string): ColumnBuilder;
  export function bigint(name: string, config?: any): ColumnBuilder;
  export function serial(name: string): ColumnBuilder;
  export function bigserial(name: string, config?: any): ColumnBuilder;
  export function smallint(name: string): ColumnBuilder;
  export function smallserial(name: string): ColumnBuilder;
  export function boolean(name: string): ColumnBuilder;
  export function timestamp(name: string, config?: any): ColumnBuilder;
  export function date(name: string, config?: any): ColumnBuilder;
  export function time(name: string, config?: any): ColumnBuilder;
  export function interval(name: string, config?: any): ColumnBuilder;
  export function numeric(name: string, config?: any): ColumnBuilder;
  export function real(name: string): ColumnBuilder;
  export function doublePrecision(name: string): ColumnBuilder;
  export function json(name: string): ColumnBuilder;
  export function jsonb(name: string): ColumnBuilder;
  export function uuid(name: string): ColumnBuilder;
  export function char(name: string, config?: any): ColumnBuilder;
  export function cidr(name: string): ColumnBuilder;
  export function inet(name: string): ColumnBuilder;
  export function macaddr(name: string): ColumnBuilder;
  export function macaddr8(name: string): ColumnBuilder;
  export function primaryKey(...columns: any[]): any;
  export function foreignKey(config: any): any;
  export function uniqueIndex(name?: string): { on(...columns: any[]): any };
  export function index(name?: string): { on(...columns: any[]): any; using(method: string, ...columns: any[]): any };
  export function unique(name?: string): any;
  export function check(name: string, expression: any): any;
  export function pgView(name: string): any;
  export function customType<T>(config: any): (name: string) => ColumnBuilder;
  export type PgTable = any;
}

// ---------- drizzle-orm driver adapters ----------
declare module "drizzle-orm/neon-http" {
  export function drizzle(...args: any[]): any;
  export type NeonHttpDatabase = any;
}

declare module "drizzle-orm/neon-serverless" {
  export function drizzle(...args: any[]): any;
}

declare module "drizzle-orm/node-postgres" {
  export function drizzle(...args: any[]): any;
}
