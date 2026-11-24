import type { Diner } from "../components/ItemAssignment";

export const MAX_DINERS = 200;
export const MAX_DINER_NAME_LENGTH = 80;
export const nameKey = (name: string) => name.trim().normalize("NFC").toLowerCase();

export function dinerNameError(name: string, diners: Diner[], exceptId: number): string {
  if (!name.trim()) return "Enter a name. Your previous name has been restored.";
  if (Array.from(name.trim()).length > MAX_DINER_NAME_LENGTH) {
    return "Use 80 characters or fewer. Your previous name has been restored.";
  }
  if (diners.some((diner) => diner.id !== exceptId && nameKey(diner.name) === nameKey(name))) {
    return "This name is already in use. Enter a distinct nickname.";
  }
  return "";
}
