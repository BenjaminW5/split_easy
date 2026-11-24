import { apiFetch } from "./client";

export interface User {
  id: number;
  name: string;
  email: string;
}

export function listUsers(): Promise<User[]> {
  return apiFetch<User[]>("/users");
}
