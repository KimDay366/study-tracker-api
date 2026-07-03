import { Errors } from "../../lib/errors.js";
import * as repo from "./logics.repository.js";
import type { LogicCreateInput, LogicUpdateInput, LogicResponse } from "./logics.types.js";

const MAX_LOGICS = 5;

export async function listLogics(userId: string): Promise<LogicResponse[]> {
  return repo.listByUser(userId);
}

export async function getLogic(id: string, userId: string): Promise<LogicResponse> {
  const logic = await repo.findByIdOwned(id, userId);
  if (!logic) throw Errors.LOGIC_NOT_FOUND();
  return logic;
}

export async function createLogic(userId: string, dto: LogicCreateInput): Promise<LogicResponse> {
  const count = await repo.countByUser(userId);
  if (count >= MAX_LOGICS) throw Errors.LOGIC_LIMIT_EXCEEDED();
  return repo.insertWithCategories(userId, dto);
}

export async function updateLogic(
  id: string,
  userId: string,
  dto: LogicUpdateInput,
): Promise<LogicResponse> {
  const logic = await repo.findByIdOwned(id, userId);
  if (!logic) throw Errors.LOGIC_NOT_FOUND();
  return repo.updateWithCategories(id, userId, dto);
}

export async function deleteLogic(id: string, userId: string): Promise<void> {
  const deleted = await repo.deleteOwned(id, userId);
  if (!deleted) throw Errors.LOGIC_NOT_FOUND();
}
