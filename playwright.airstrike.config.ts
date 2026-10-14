import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./tests',testMatch:'airstrike.spec.ts',workers:1,timeout:180000,expect:{timeout:20000},
  outputDir:'test-results/airstrike',use:{viewport:{width:1440,height:1000},launchOptions:{channel:'chrome'},screenshot:'only-on-failure',trace:'retain-on-failure'} });
