/**
 * Test app to verify @quorum/shared package imports
 */

import {
  generateId,
  formatDate,
  delay,
  isDefined,
  type BaseEntity,
  type Result,
} from "@quorum/shared";

console.log("Testing @quorum/shared package imports...\n");

// Test utility functions
const id = generateId();
console.log("Generated ID:", id);

const now = new Date();
console.log("Formatted date:", formatDate(now));

// Test type-checking
const entity: BaseEntity = {
  id: generateId(),
  createdAt: new Date(),
  updatedAt: new Date(),
};
console.log("Created entity:", entity);

// Test Result type
const successResult: Result<string> = {
  success: true,
  data: "Operation completed",
};
console.log("Success result:", successResult);

// Test isDefined
const value: string | null = "test";
if (isDefined(value)) {
  console.log("Value is defined:", value);
}

// Test async function
async function testAsync() {
  console.log("\nTesting async delay...");
  await delay(100);
  console.log("Delay complete!");
}

await testAsync();

console.log("\nAll tests passed! @quorum/shared is working correctly.");
