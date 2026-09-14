import { describe, expect, it } from 'vitest';
import { avatarColor, formatDate, initials } from '../format';

describe('initials', () => {
  it('พาสระหน้าและวรรณยุกต์มาด้วยให้อ่านออก', () => {
    expect(initials('โอ๊ค')).toBe('โอ๊');
    expect(initials('แมน')).toBe('แม');
    expect(initials('อู๋')).toBe('อู๋');
    expect(initials('เบียร์')).toBe('เบี');
    expect(initials('กิ๊ฟ')).toBe('กิ๊');
  });

  it('ภาษาอังกฤษเอาตัวแรกพอ', () => {
    expect(initials('Oak')).toBe('O');
  });

  it('ชื่อว่างไม่พัง', () => {
    expect(initials('   ')).toBe('?');
  });
});

describe('formatDate', () => {
  it('แปลงเป็นวันที่ไทยแบบสั้น', () => {
    expect(formatDate('2025-01-05')).toBe('5 ม.ค. 68');
    expect(formatDate('2026-09-14')).toBe('14 ก.ย. 69');
  });
});

describe('avatarColor', () => {
  it('สีคงที่ต่อ seed เดิมเสมอ', () => {
    expect(avatarColor(3)).toBe(avatarColor(3));
    expect(avatarColor(0)).not.toBe(avatarColor(1));
  });
});
