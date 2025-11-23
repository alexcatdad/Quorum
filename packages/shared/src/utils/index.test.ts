import { expect, test } from "bun:test";
import { delay, formatDate, generateId, isDefined, safeJsonParse } from "./index.ts";

test("formatDate returns ISO string", () => {
	const date = new Date("2025-01-01T00:00:00.000Z");
	expect(formatDate(date)).toBe("2025-01-01T00:00:00.000Z");
});

test("delay waits for specified time", async () => {
	const start = Date.now();
	await delay(50);
	const elapsed = Date.now() - start;
	expect(elapsed).toBeGreaterThanOrEqual(50);
});

test("safeJsonParse parses valid JSON", () => {
	const result = safeJsonParse<{ name: string }>('{"name":"test"}');
	expect(result).toEqual({ name: "test" });
});

test("safeJsonParse returns null for invalid JSON", () => {
	const result = safeJsonParse("{invalid}");
	expect(result).toBeNull();
});

test("generateId creates unique IDs", () => {
	const id1 = generateId();
	const id2 = generateId();
	expect(id1).not.toBe(id2);
	expect(id1).toContain("-");
});

test("isDefined returns true for defined values", () => {
	expect(isDefined("test")).toBe(true);
	expect(isDefined(0)).toBe(true);
	expect(isDefined(false)).toBe(true);
});

test("isDefined returns false for null/undefined", () => {
	expect(isDefined(null)).toBe(false);
	expect(isDefined(undefined)).toBe(false);
});
