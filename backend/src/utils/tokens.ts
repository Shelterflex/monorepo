import { randomBytes, randomUUID } from "node:crypto"

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export function generateToken(): string {
  return randomBytes(32).toString("hex")
}

export function generateId(): string {
  return randomUUID()
}