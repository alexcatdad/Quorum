import { Elysia } from "elysia";
import { register } from "../utils/metrics";

export const metricsRoutes = new Elysia({ prefix: "/metrics" }).get(
	"/",
	async () => {
		const metrics = await register.metrics();
		return new Response(metrics, {
			headers: {
				"Content-Type": register.contentType,
			},
		});
	},
	{
		detail: {
			tags: ["Metrics"],
			summary: "Prometheus metrics endpoint",
			description: "Returns Prometheus-formatted metrics",
		},
	},
);
