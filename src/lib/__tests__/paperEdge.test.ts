import { describe, expect, it } from 'vitest';
import { SEARCH_EDGE, detectPaper, searchSize, worthCropping } from '../paperEdge';

/**
 * paperEdge.test.ts — หาขอบกระดาษในรูปถ่าย
 *
 * ค่าสีในเทสชุดนี้วัดมาจากรูปใบเสร็จจริงที่ผู้ใช้ถ่ายมา ไม่ได้ตั้งเอง
 * กระดาษ rgb(178,177,173) ความต่างสี 5 — มือคน rgb(195,145,121) ความต่างสี 74
 * โต๊ะไม้ rgb(114,88,58) ความต่างสี 56
 * มือคนสว่างกว่ากระดาษที่อยู่ในเงาเสียอีก ดูแต่ความสว่างจึงแยกไม่ออก
 */

interface Paint {
  left: number;
  top: number;
  right: number;
  bottom: number;
  color: [number, number, number];
}

const PAPER: [number, number, number] = [178, 177, 173];
const PAPER_SHADOW: [number, number, number] = [202, 192, 187];
const SKIN: [number, number, number] = [195, 145, 121];
const WOOD: [number, number, number] = [114, 88, 58];

function canvas(width: number, height: number, background: [number, number, number], paints: Paint[]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let color = background;
      for (const paint of paints) {
        if (x >= paint.left && x < paint.right && y >= paint.top && y < paint.bottom) color = paint.color;
      }
      const at = (y * width + x) * 4;
      rgba[at] = color[0];
      rgba[at + 1] = color[1];
      rgba[at + 2] = color[2];
      rgba[at + 3] = 255;
    }
  }
  return rgba;
}

describe('detectPaper', () => {
  it('หากระดาษบนโต๊ะไม้เจอ', () => {
    const rgba = canvas(100, 100, WOOD, [{ left: 20, top: 10, right: 80, bottom: 90, color: PAPER }]);
    const rect = detectPaper(rgba, 100, 100);
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeCloseTo(0.2, 2);
    expect(rect!.y).toBeCloseTo(0.1, 2);
    expect(rect!.width).toBeCloseTo(0.6, 2);
    expect(rect!.height).toBeCloseTo(0.8, 2);
  });

  /** นี่คือเหตุผลที่ต้องดูความต่างสี ไม่ใช่ความสว่างอย่างเดียว */
  it('ไม่เอามือคนมาเป็นกระดาษ ทั้งที่มือสว่างกว่า', () => {
    const rgba = canvas(100, 100, WOOD, [
      { left: 0, top: 0, right: 45, bottom: 100, color: SKIN },
      { left: 50, top: 20, right: 95, bottom: 80, color: PAPER },
    ]);
    const rect = detectPaper(rgba, 100, 100);
    expect(rect).not.toBeNull();
    // ต้องได้เฉพาะฝั่งกระดาษ ไม่กินฝั่งมือเข้ามา
    expect(rect!.x).toBeCloseTo(0.5, 1);
    expect(rect!.width).toBeCloseTo(0.45, 1);
  });

  it('กระดาษที่อยู่ในเงาก็ยังหาเจอ', () => {
    const rgba = canvas(100, 100, WOOD, [
      { left: 20, top: 10, right: 80, bottom: 90, color: PAPER },
      { left: 20, top: 60, right: 80, bottom: 90, color: PAPER_SHADOW },
    ]);
    const rect = detectPaper(rgba, 100, 100);
    expect(rect!.height).toBeCloseTo(0.8, 2);
  });

  it('ไม่มีอะไรสว่างพอ ก็บอกว่าหาไม่เจอ', () => {
    expect(detectPaper(canvas(60, 60, WOOD, []), 60, 60)).toBeNull();
  });

  it('เจอแค่จุดเล็กๆ ไม่เสนอกรอบ ดีกว่าเดามั่ว', () => {
    const rgba = canvas(100, 100, WOOD, [{ left: 45, top: 45, right: 55, bottom: 55, color: PAPER }]);
    expect(detectPaper(rgba, 100, 100)).toBeNull();
  });

  it('กระดาษเต็มรูปอยู่แล้ว ไม่ต้องเสนอกรอบ', () => {
    expect(detectPaper(canvas(60, 60, PAPER, []), 60, 60)).toBeNull();
  });

  it('รูปว่างเปล่าไม่ทำให้พัง', () => {
    expect(detectPaper(new Uint8ClampedArray(0), 0, 0)).toBeNull();
  });

  /** กระดาษสองแผ่นวางแยกกัน เอาแผ่นใหญ่ ไม่ใช่กรอบที่คร่อมทั้งคู่ */
  it('เลือกผืนที่ใหญ่ที่สุด ไม่ใช่คร่อมทุกผืน', () => {
    const rgba = canvas(100, 100, WOOD, [
      { left: 5, top: 5, right: 20, bottom: 20, color: PAPER },
      { left: 40, top: 20, right: 95, bottom: 90, color: PAPER },
    ]);
    const rect = detectPaper(rgba, 100, 100);
    expect(rect!.x).toBeCloseTo(0.4, 1);
    expect(rect!.y).toBeCloseTo(0.2, 1);
  });
});

describe('searchSize', () => {
  it('ย่อด้านยาวลงมาที่ขนาดค้นหา', () => {
    expect(searchSize(1200, 1600)).toEqual({ width: 150, height: SEARCH_EDGE });
    expect(searchSize(1600, 1200)).toEqual({ width: SEARCH_EDGE, height: 150 });
  });

  it('รูปที่เล็กอยู่แล้วไม่ต้องขยาย', () => {
    expect(searchSize(120, 160)).toEqual({ width: 120, height: 160 });
  });

  it('ขนาดศูนย์ไม่ทำให้พัง', () => {
    expect(searchSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('worthCropping', () => {
  it('กรอบที่เล็กกว่าทั้งรูปพอควร ถึงจะคุ้มเปลี่ยนให้', () => {
    expect(worthCropping({ x: 0.2, y: 0.1, width: 0.6, height: 0.8 })).toBe(true);
  });

  it('กรอบที่เกือบเท่าทั้งรูป ไม่ต้องไปยุ่ง', () => {
    expect(worthCropping({ x: 0, y: 0, width: 0.99, height: 0.99 })).toBe(false);
    expect(worthCropping(null)).toBe(false);
  });
});
