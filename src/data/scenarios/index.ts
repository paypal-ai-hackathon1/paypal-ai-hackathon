import type { Scenario, ScenarioId } from "@/lib/domain";
import { yagi } from "./yagi";

export const DEFAULT_SCENARIO_ID: ScenarioId = yagi.id;

export const scenarios: Record<ScenarioId, Scenario> = {
  [yagi.id]: yagi,
};
