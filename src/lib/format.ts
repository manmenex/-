import type { Category } from '../core/types';

export const CATEGORY_LABEL: Record<Category, string> = {
  food: 'อาหาร',
  drink: 'เครื่องดื่ม',
  transport: 'เดินทาง',
  lodging: 'ที่พัก',
  ticket: 'ตั๋ว/ค่าเข้า',
  shopping: 'ช้อปปิ้ง',
  other: 'อื่นๆ',
};

export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

export const METHOD_LABEL: Record<string, string> = {
  promptpay: 'พร้อมเพย์',
  transfer: 'โอนธนาคาร',
  cash: 'เงินสด',
  card: 'บัตร',
  offset: 'หักลบกัน',
  other: 'อื่นๆ',
};

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** 2025-01-05 -> "5 ม.ค. 68" */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return iso;
  const buddhistYear = (year + 543) % 100;
  return `${day} ${THAI_MONTHS[month - 1]} ${String(buddhistYear).padStart(2, '0')}`;
}

/** สีของ avatar ให้คงที่ต่อคน ไม่สุ่มใหม่ทุกครั้งที่ render */
const AVATAR_COLORS = [
  '#7C2D12',
  '#3F6212',
  '#1E3A5F',
  '#B45309',
  '#4C1D95',
  '#0F5257',
  '#7E1D4A',
  '#44403C',
];

export function avatarColor(colorSeed: number): string {
  return AVATAR_COLORS[Math.abs(colorSeed) % AVATAR_COLORS.length];
}

/** สระหน้าในภาษาไทย ยืนเดี่ยวแล้วอ่านไม่รู้เรื่อง ต้องพาพยัญชนะตัวถัดไปมาด้วย */
const THAI_LEADING_VOWELS = new Set(['เ', 'แ', 'โ', 'ใ', 'ไ']);
/** วรรณยุกต์และสระบนล่าง ต้องติดไปกับพยัญชนะที่มันเกาะอยู่ */
const THAI_COMBINING = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;

/** ตัวย่อสำหรับ avatar — รองรับภาษาไทยให้อ่านออก เช่น "โอ๊ค" -> "โอ๊" ไม่ใช่ "โ" */
export function initials(name: string): string {
  const characters = [...name.trim()];
  if (characters.length === 0) return '?';

  let result = characters[0];
  let index = 1;

  if (THAI_LEADING_VOWELS.has(result) && characters[index]) {
    result += characters[index];
    index += 1;
  }
  while (characters[index] && THAI_COMBINING.test(characters[index])) {
    result += characters[index];
    index += 1;
  }
  return result;
}
