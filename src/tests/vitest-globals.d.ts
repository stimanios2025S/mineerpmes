/**
 * Rend visibles les globales de Vitest (`describe`, `it`, `expect`, ...).
 * Le projet active `globals: true` dans vitest.config.ts : sans cette
 * reference, TypeScript ignore ces fonctions et le typage des tests echoue.
 */
/// <reference types="vitest/globals" />
