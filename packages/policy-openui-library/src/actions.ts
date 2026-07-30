import type { ActionEvent } from "@openuidev/react-lang";
import { z } from "zod";

export const policyActionTypeSchema = z.enum([
  "open_source",
  "change_year",
  "filter_projects",
  "change_audience",
  "go_to_review",
  "save_json",
  "save_csv"
]);

export type PolicyActionType = z.infer<typeof policyActionTypeSchema>;

export interface AllowedPolicyAction {
  type: PolicyActionType;
  params: Record<string, unknown>;
  humanFriendlyMessage: string;
}

export function parseAllowedPolicyAction(
  event: ActionEvent
): AllowedPolicyAction | undefined {
  const type = policyActionTypeSchema.safeParse(event.type);
  if (!type.success) {
    return undefined;
  }
  return {
    type: type.data,
    params: event.params,
    humanFriendlyMessage: event.humanFriendlyMessage
  };
}
