declare module "vitest" {
  export interface ProvidedContext {
    testSchema: string;
    bossSchema: string;
  }
}

export {};
