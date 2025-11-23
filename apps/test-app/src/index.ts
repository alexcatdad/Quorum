/**
 * Test app to verify @quorum/shared package imports
 */

import { type BaseEntity, delay, generateId, isDefined, type Result } from "@quorum/shared";

// Test utility functions
const _id = generateId();

const _now = new Date();

// Test type-checking
const _entity: BaseEntity = {
	id: generateId(),
	createdAt: new Date(),
	updatedAt: new Date(),
};

// Test Result type
const _successResult: Result<string> = {
	success: true,
	data: "Operation completed",
};

// Test isDefined
const value: string | null = "test";
if (isDefined(value)) {
}

// Test async function
async function testAsync() {
	await delay(100);
}

await testAsync();
