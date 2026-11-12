export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 80;

export function passwordOk(password: string): boolean {
  return password.length >= MIN_PASSWORD && password.length <= MAX_PASSWORD;
}
