import { deliverGatewayMessage, type GatewayDeliveryResult } from "../gateway/delivery.js";

export type CronDeliverTarget = string;
export type CronDeliveryResult = GatewayDeliveryResult;

export async function deliverCronResult(options: {
	agentDir: string;
	deliver?: string;
	origin?: string;
	content: string;
}): Promise<CronDeliveryResult> {
	return deliverGatewayMessage(options);
}
