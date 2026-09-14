/** id สั้นๆ ที่ไม่ชนกัน ใช้ crypto ถ้ามี */
export function newId(prefix = ''): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && 'randomUUID' in globalCrypto) {
    return `${prefix}${globalCrypto.randomUUID()}`;
  }
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function todayISO(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
