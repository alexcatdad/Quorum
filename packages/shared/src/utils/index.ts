/**
 * Common utility functions used across the Quorum application
 */

/**
 * Formats a date to ISO string
 */
export function formatDate(date: Date): string {
	return date.toISOString();
}

/**
 * Creates a delay promise for async operations
 */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safely parses JSON with error handling
 */
export function safeJsonParse<T>(json: string): T | null {
	try {
		return JSON.parse(json) as T;
	} catch {
		return null;
	}
}

/**
 * Generates a random ID (simple implementation)
 */
export function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Checks if a value is defined (not null or undefined)
 */
export function isDefined<T>(value: T | null | undefined): value is T {
	return value !== null && value !== undefined;
}
