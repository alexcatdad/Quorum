import { expect, test } from "bun:test";
import { generateId } from "@quorum/shared";

test("can import from @quorum/shared", () => {
	const id = generateId();
	expect(id).toBeDefined();
	expect(typeof id).toBe("string");
});
